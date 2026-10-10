#!/usr/bin/env python3
"""Open the details of a snapshot's ads: CTA, link, objective, targeting.

    python details.py out/<name>/<date> [--limit 40] [--delay 2] [--ids 123 456]

Ad Library: the search list has no CTA, link, objective or targeting; each ad's
details page has them (one request per ad, as a person clicking it). Which ads:
collector.js decides (pickForDetails: ads of the advertisers kept by
curation.json, the longest-running ad of every advertiser first, advertisers
take turns). Creative Center: the details card adds the landing page,
comments and shares (a visible browser window, as for scrape.py --source cc).

Result: details.json next to ads.csv ({"ads": {id: fields}}); report.js,
Excel and HTML merge it over ads.csv. Stops on a captcha or a login wall.
"""
import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
MAX_LIMIT = 60
MIN_DELAY = 1.0
MARKERS = ["verify to continue", "drag the slider", "drag the puzzle", "captcha", "log in to continue"]


def pick_ids(folder: Path, limit: int, source: str) -> list:
    code = (
        "const C=require(process.argv[1]);const {loadSnapshot}=require(process.argv[2]);const s=loadSnapshot(process.argv[3]);"
        "const lim=+process.argv[4];"
        "const ids=s.meta.source==='cc'?s.rows.filter(r=>!r.details).sort((a,b)=>(a.ctr_top??1)-(b.ctr_top??1)).slice(0,lim).map(r=>r.id):C.pickForDetails(s.rows,lim);"
        "console.log(JSON.stringify(ids))"
    )
    res = subprocess.run(["node", "-e", code, str(HERE / "collector.js"), str(HERE / "report.js"), str(folder), str(limit)],
                         capture_output=True, encoding="utf-8", timeout=120)
    if res.returncode != 0:
        sys.exit("Could not read the snapshot: " + res.stderr.strip()[:300])
    return [i for i in json.loads(res.stdout) if re.fullmatch(r"\d{1,25}", str(i))]


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Open ad details (CTA, link, objective, targeting) for a TikTok snapshot.")
    ap.add_argument("folder")
    ap.add_argument("--limit", type=int, default=40, help=f"how many ads (default 40, cap {MAX_LIMIT})")
    ap.add_argument("--delay", type=float, default=2.0, help=f"seconds between ads (default 2, minimum {MIN_DELAY:g})")
    ap.add_argument("--ids", nargs="+", help="these ad ids instead of the automatic pick")
    args = ap.parse_args()
    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    if not 1 <= args.limit <= MAX_LIMIT:
        sys.exit(f"--limit must be between 1 and {MAX_LIMIT}.")
    if args.delay < MIN_DELAY:
        sys.exit(f"--delay below {MIN_DELAY:g} s is not allowed.")
    meta = json.loads((folder / "run.json").read_text(encoding="utf-8")) if (folder / "run.json").exists() else {}
    source = meta.get("source", "library")
    country = str(meta.get("country", "")).upper()
    if not re.fullmatch(r"[A-Z]{2}|", country):
        sys.exit("Bad country in run.json.")
    ids = [i for i in (args.ids or []) if re.fullmatch(r"\d{1,25}", i)] or pick_ids(folder, args.limit, source)
    ids = ids[:args.limit]
    if not ids:
        print("Nothing to open: every ad already has its details.")
        return
    out_path = folder / "details.json"
    store = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"ads": {}}

    from playwright.sync_api import sync_playwright  # lazy
    collector = (HERE / "collector.js").read_text(encoding="utf-8")
    got = {}

    def on_resp(r):
        u = r.url
        m = re.search(r"/api/v1/items/(\d+)/details", u) or (re.search(r"top_ads/v2/detail\?material_id=(\d+)", u))
        if m:
            try:
                got[m.group(1)] = r.json()
            except Exception:
                pass

    ok = failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=(source == "library"))
        ctx = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
        ctx.add_init_script(script=collector)
        page = ctx.new_page()
        page.on("response", on_resp)
        try:
            for k, ad_id in enumerate(ids, 1):
                url = (f"https://library.tiktok.com/ads/detail/?ad_id={ad_id}&lang=en" if source == "library"
                       else f"https://ads.tiktok.com/business/creativecenter/topads/{ad_id}/pc/en?countryCode={country}&period=180")
                page.goto(url, wait_until="domcontentloaded")
                for _ in range(24):
                    if ad_id in got:
                        break
                    page.wait_for_timeout(500)
                text = page.evaluate("document.body ? document.body.innerText.slice(0, 3000).toLowerCase() : ''")
                if any(m in text for m in MARKERS):
                    print("Stopped: TikTok showed a captcha or a login wall. Nothing is bypassed; try later.")
                    break
                raw = got.get(ad_id)
                if raw is None:
                    failed += 1
                    print(f"[{k}/{len(ids)}] {ad_id} no details")
                elif source == "library":
                    store["ads"][ad_id] = page.evaluate("(j) => window.__tti.detailsFromJson(j)", raw)
                    ok += 1
                    d = store["ads"][ad_id]
                    print(f"[{k}/{len(ids)}] {ad_id} {d.get('objective') or '-'} | {d.get('cta') or '-'} | {(d.get('link') or '-')[:60]}")
                else:
                    d = (raw or {}).get("data") or {}
                    store["ads"][ad_id] = {k2: v for k2, v in {"link": d.get("landing_page") or "", "comments": d.get("comment"), "shares": d.get("share"), "likes": d.get("like")}.items() if v not in (None, "")}
                    ok += 1
                    print(f"[{k}/{len(ids)}] {ad_id} {(d.get('landing_page') or '-')[:70]}")
                store["date"] = datetime.now(timezone.utc).isoformat()
                out_path.write_text(json.dumps(store, ensure_ascii=False, indent=1), encoding="utf-8")
                time.sleep(args.delay)
        finally:
            browser.close()
    print(f"Details: {ok} opened, {failed} without data. Saved: {out_path}")


if __name__ == "__main__":
    main()
