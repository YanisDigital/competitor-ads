#!/usr/bin/env python3
"""CLI collector for TikTok ads, driven by Playwright.

Two sources (scripts/collector.js holds all parsing and report logic; this
script only drives a browser and calls window.__tti):

  library  TikTok Ad Library, library.tiktok.com (EU/EEA, GB, CH, TR only).
           Keyword search, advertisers, first/last shown dates.
  cc       TikTok Creative Center Top Ads (UA, US and other countries):
           a curated sample of top auction ads, no advertiser names.
           TikTok refuses headless browsers there, so this source always
           opens a visible browser window (nothing is disguised).

Requires Playwright + Chromium, installed explicitly (never by this script):
    pip install playwright
    python -m playwright install chromium

Examples:
    python scrape.py --preset fitness --country PL --city Warszawa
    python scrape.py --keywords "siłownia" "klub fitness" --country PL
    python scrape.py --source cc --country UA --industry 14 --keywords "манікюр"

Policy: no login, no cookie reuse, no captcha bypass, no proxies, no
fingerprint spoofing, at most MAX_KEYWORDS searches per run. A login wall or
captcha stops the run with a clear message.
"""

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).parent
COLLECTOR_JS = HERE / "collector.js"
PRESETS_DIR = HERE.parent / "presets"
MAX_KEYWORDS = 15
MAX_ADS_PER_QUERY = 240
DEFAULT_DELAY = 3.0
EXPRESS_QUERIES = 3
ALL_LABEL = "(весь топ)"  # the label of a Creative Center run without a keyword
DEFAULT_LONG_DAYS = 60

BLOCK_MARKERS = {
    "captcha": ["verify to continue", "drag the slider", "drag the puzzle", "captcha", "security check", "too many requests"],
    "login": ["log in to continue", "please log in to view"],
}


class BlockedError(RuntimeError):
    """TikTok showed a captcha or a login wall."""


_CYR = {"а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie", "ё": "io", "ж": "zh", "з": "z", "и": "y", "і": "i",
        "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
        "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "iu", "я": "ia", "ł": "l"}


def slugify(text: str) -> str:
    text = "".join(_CYR.get(ch, ch) for ch in text.lower())
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "niche"


def default_out_dir(name: str) -> Path:
    base = Path("out") / name
    day = datetime.now().strftime("%Y-%m-%d")
    candidate, n = base / day, 2
    while (candidate / "ads.csv").exists():
        candidate = base / f"{day}-{n}"
        n += 1
    return candidate


def validate_country(value: str) -> str:
    code = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", code):
        sys.exit(f"Bad country {value!r}: use a two-letter code such as PL, DE or UA.")
    return code


def load_preset(preset_id: str) -> dict:
    if not re.fullmatch(r"[a-z0-9-]+", preset_id or ""):
        sys.exit(f"Bad preset id {preset_id!r}.")
    path = PRESETS_DIR / f"{preset_id}.json"
    if not path.is_file():
        available = ", ".join(sorted(p.stem for p in PRESETS_DIR.glob("*.json")))
        sys.exit(f"Unknown preset '{preset_id}'. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def library_url(country: str, period_days: int) -> str:
    now = int(time.time() * 1000)
    start = now - period_days * 86400 * 1000
    return ("https://library.tiktok.com/ads"
            f"?region={country}&start_time={start}&end_time={now}&adv_name=&adv_biz_ids=&query_type=1"
            "&sort_type=last_shown_date,desc&ad_type=0&ad_status=1&ages=all&ad_reach=all&gender=ALL&lang=en")


def cc_url(country: str, period: int, industry: str | None) -> str:
    url = f"https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period={period}&region={country}"
    if industry:
        url += f"&industry={industry}"
    return url


async def detect_block(page) -> None:
    text = (await page.evaluate("document.body ? document.body.innerText.slice(0, 4000) : ''")).lower()
    if any(m in text for m in BLOCK_MARKERS["captcha"]):
        raise BlockedError("TikTok showed a captcha / verification. Stopping: this tool never solves or bypasses captchas.")
    if any(m in text for m in BLOCK_MARKERS["login"]):
        raise BlockedError("TikTok asked to log in. Stopping: this tool never logs in.")


async def ensure_installed(page) -> None:
    if not await page.evaluate("typeof window.__tti !== 'undefined' && window.__tti.source !== null"):
        sys.exit("window.__tti did not install on the page. The page structure may have changed (see references/troubleshooting.md).")


async def search_library(page, query: str) -> dict:
    """In-page search (same code path as browser mode); falls back to real typing."""
    res = await page.evaluate("(q) => window.__tti.search(q)", query)
    if isinstance(res, dict) and res.get("total") is not None:
        return res
    inp = page.locator('input[placeholder="Search by name or keyword"]').first
    await inp.fill(query)
    await page.wait_for_timeout(600)
    await page.locator('button:has-text("Search")').first.click()
    await page.wait_for_timeout(4000)
    return {"query": query, "total": await page.evaluate("window.__tti.lastTotal")}


async def search_cc(page, query: str) -> dict:
    await page.evaluate("() => { window.__tti.ads = {}; window.__tti.lastTotal = null; }")
    inp = page.locator('input[placeholder*="Search"]').first
    await inp.click()
    await inp.fill(query)
    await page.keyboard.press("Enter")
    for _ in range(20):
        await page.wait_for_timeout(500)
        if await page.evaluate("window.__tti.lastTotal !== null"):
            break
    return {"query": query, "total": await page.evaluate("window.__tti.lastTotal")}


async def run(args) -> None:
    from playwright.async_api import async_playwright  # lazy: argument errors need no Playwright

    collector_src = COLLECTOR_JS.read_text(encoding="utf-8")
    preset = load_preset(args.preset) if args.preset else None
    country = validate_country(args.country or (preset or {}).get("country") or "PL")

    async with async_playwright() as p:
        # Query building and the source choice stay in collector.js.
        probe = await p.chromium.launch(headless=True)
        pp = await probe.new_page()
        await pp.add_init_script(script=collector_src)
        await pp.goto("about:blank")
        source = args.source or await pp.evaluate("(c) => window.__tti.sourceForCountry(c)", country)
        langs = args.lang or await pp.evaluate("(c) => window.__tti.langsForCountry(c)", country)
        queries = [{"q": k, "lang": (args.lang or langs)[0]} for k in (args.keywords or [])]
        if not queries and preset:
            queries = await pp.evaluate("([p, l, m]) => window.__tti.buildQueries(p, l, '', m)", [preset, langs, args.max_queries])
        await probe.close()

        if source == "library" and country not in LIBRARY_COUNTRIES:
            sys.exit(f"The TikTok Ad Library does not cover {country} (EU/EEA, GB, CH and TR only). Use --source cc for this country.")
        if source == "cc" and not queries:
            queries = [{"q": "", "lang": "", "label": ALL_LABEL}]  # the whole Top Ads list of the country (and industry)
        if args.express:
            queries = queries[:EXPRESS_QUERIES]
        if not queries:
            sys.exit('No queries. Pass --keywords "..." or --preset <id> (or --industry for --source cc).')
        if len(queries) > MAX_KEYWORDS:
            sys.exit(f"Too many queries ({len(queries)}); the limit is {MAX_KEYWORDS} per run.")
        if args.exact and source == "library":
            queries = [{**q, "q": '"' + q["q"].strip('"') + '"'} for q in queries]

        name = (args.preset or slugify(queries[0]["q"] or (args.industry or "top-ads"))) + "-" + country.lower() + ("-cc" if source == "cc" else "")
        out_dir = Path(args.out) if args.out else default_out_dir(name)
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"Source: {source}, country {country}. Queries ({len(queries)}): " + " | ".join(q.get("label") or q["q"] for q in queries))

        headed = args.headed or source == "cc"
        if source == "cc" and not args.headed:
            print("Creative Center refuses headless browsers: a browser window will open (do not close it).")
        browser = await p.chromium.launch(headless=not headed)
        context = await browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
        await context.add_init_script(script=collector_src)
        page = await context.new_page()
        totals, capped = {}, []
        try:
            if source == "library":
                await page.goto(library_url(country, args.period), wait_until="domcontentloaded")
            else:
                await page.goto(cc_url(country, args.cc_period, args.industry), wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
            except Exception:
                pass
            await page.wait_for_timeout(3000)
            await detect_block(page)
            await ensure_installed(page)
            if source == "cc":
                await page.keyboard.press("Escape")  # promo pop-up

            for i, q in enumerate(queries):
                label = q.get("label") or q["q"]
                print(f"[{i + 1}/{len(queries)}] {label}")
                if q["q"]:
                    res = await (search_library(page, q["q"]) if source == "library" else search_cc(page, q["q"]))
                if source == "cc" and (args.order != "For You" or not q["q"] and i > 0):
                    res = await page.evaluate("(o) => window.__tti.sort(o)", args.order)
                    if isinstance(res, str):
                        print("    " + res)
                await detect_block(page)
                await page.evaluate("(n) => window.__tti.more(n)", args.max_ads)
                summary = await page.evaluate("(kw) => window.__tti.collect(kw)", label)
                totals[label] = summary.get("total_says")
                if summary.get("capped"):
                    capped.append(label)
                print(f"    captured={summary['captured']} total={summary.get('total_says')} unique={summary['total_unique']}"
                      + ("  [only the top of the list]" if summary.get("capped") else ""))
                if i < len(queries) - 1:
                    await asyncio.sleep(args.delay)
            csv_text = await page.evaluate("() => window.__tti.csv()")
        except BlockedError as e:
            await browser.close()
            sys.exit(f"Stopped: {e}")
        await browser.close()

    (out_dir / "ads.csv").write_text(csv_text, encoding="utf-8")
    run_meta = {
        "date": datetime.now(timezone.utc).isoformat(), "source": source, "country": country,
        "queries": [q.get("label") or q["q"] for q in queries], "query_langs": {q["q"]: q["lang"] for q in queries if q["q"]},
        "preset": args.preset, "totals": totals, "capped_queries": capped, "exact": bool(args.exact),
        "long_days": args.long_days, "cities": [c for c in (args.city or []) if c],
        **({"period_days": args.period} if source == "library" else {"cc_period": args.cc_period, "industry": args.industry, "order": args.order}),
        "max_ads_per_query": args.max_ads, "headed": headed,
    }
    (out_dir / "run.json").write_text(json.dumps(run_meta, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.details:
        sys.stdout.flush()  # keep the collection log before details.py's
        subprocess.run([sys.executable, str(HERE / "details.py"), str(out_dir), "--limit", str(args.details)], check=False)

    rep = subprocess.run(["node", str(HERE / "report.js"), str(out_dir)], capture_output=True, encoding="utf-8")
    if rep.returncode != 0:
        sys.exit("report.js failed: " + rep.stderr.strip()[:500])
    data = json.loads(rep.stdout)
    (out_dir / "report.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    r = data["report"]
    print()
    if source == "library":
        print(f"Ads: {r['ads']} from {r['advertisers']} advertisers ({r['single_ad_advertisers']} with one ad); long-running (>= {args.long_days} days shown): {r['hypothesis_inputs']['long_running_ads']}.")
    else:
        print(f"Top ads: {r['ads']} (top-20% CTR: {r['ctr']['top20']}, with a landing page: {r['with_landing']}).")
    for w in data["warnings"]:
        print(f"  [{w['severity']}] {w['message']}")
    if r["ads"] == 0:
        print("Nothing captured. If unexpected, retry with --headed and see what the page shows.")
    print(f"Saved: {out_dir / 'ads.csv'}")
    print(f"Saved: {out_dir / 'report.json'}")


LIBRARY_COUNTRIES = {"AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI",
                     "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "TR"}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Collect TikTok ads (Ad Library or Creative Center Top Ads) for a niche.")
    ap.add_argument("--source", choices=("library", "cc"), help="library (EU/EEA, GB, CH, TR) or cc (Creative Center); default: by country")
    ap.add_argument("--country", help="Two-letter country code (default: the preset's, else PL)")
    ap.add_argument("--keywords", nargs="+", help='Search queries; for the Ad Library prefer one service word per query (it matches ANY of the words)')
    ap.add_argument("--keywords-file", dest="keywords_file", help="Text file, one query per line")
    ap.add_argument("--preset", help="Niche preset id from presets/ (queries from its services in the country's languages)")
    ap.add_argument("--lang", nargs="+", help="Query languages for a preset (default: the country's languages)")
    ap.add_argument("--city", nargs="*", help="City spellings to mark local ads (text mentions and targeted cities); not added to the queries")
    ap.add_argument("--max-queries", type=int, default=10, dest="max_queries", help="Max preset queries (default 10)")
    ap.add_argument("--exact", action="store_true", help="Library: exact-phrase search (less noise, fewer ads)")
    ap.add_argument("--period", type=int, default=30, help="Library: ads last shown within this many days (default 30, max 365)")
    ap.add_argument("--cc-period", type=int, default=180, dest="cc_period", choices=(7, 30, 180), help="Creative Center period in days (default 180)")
    ap.add_argument("--order", default="For You", choices=("For You", "Reach", "CTR"), help="Creative Center list order (default 'For You'; 'CTR' puts the best CTR first, but then the sample holds almost only winners)")
    ap.add_argument("--industry", help="Creative Center top-level industry code, e.g. 14 (Beauty & Personal Care); see references/field-mapping.md")
    ap.add_argument("--max-ads", type=int, default=96, dest="max_ads", help=f"Max ads per query (default 96, cap {MAX_ADS_PER_QUERY})")
    ap.add_argument("--details", type=int, default=0, help="After collecting, open details of this many ads (details.py; default 0)")
    ap.add_argument("--long-days", type=int, default=DEFAULT_LONG_DAYS, dest="long_days", help=f"Long-running threshold, days shown (default {DEFAULT_LONG_DAYS})")
    ap.add_argument("--out", help="Output folder (default out/<preset or slug>-<country>/<date>/)")
    ap.add_argument("--headed", action="store_true", help="Visible browser window (always on for --source cc)")
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Seconds between queries (default {DEFAULT_DELAY})")
    ap.add_argument("--express", action="store_true", help=f"Quick look: first {EXPRESS_QUERIES} queries only")
    ap.add_argument("--list-presets", action="store_true", dest="list_presets")
    args = ap.parse_args()
    if args.list_presets:
        for path in sorted(PRESETS_DIR.glob("*.json")):
            d = json.loads(path.read_text(encoding="utf-8"))
            print(f"{d['id']}: {d['title']} ({len(d.get('services', []))} services; Creative Center industry {d.get('cc_industry', '-')})")
        return
    if args.keywords_file:
        args.keywords = [l.strip() for l in Path(args.keywords_file).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.keywords and len(args.keywords) > MAX_KEYWORDS:
        sys.exit(f"Too many keywords ({len(args.keywords)}); limit is {MAX_KEYWORDS} per run.")
    if not 1 <= args.period <= 365:
        sys.exit("--period must be between 1 and 365 days.")
    if not 12 <= args.max_ads <= MAX_ADS_PER_QUERY:
        sys.exit(f"--max-ads must be between 12 and {MAX_ADS_PER_QUERY}.")
    if args.max_queries > MAX_KEYWORDS:
        sys.exit(f"--max-queries above {MAX_KEYWORDS} is not allowed.")
    if args.delay < 1:
        sys.exit("--delay below 1 second is not allowed.")
    if args.industry and not re.fullmatch(r"\d{1,11}", args.industry):
        sys.exit("--industry must be a number such as 14.")
    if args.industry and len(args.industry) > 2:
        sys.exit("--industry takes the top-level code (two digits, e.g. 14); sub-industries are not addressable by link, use --keywords instead.")
    if args.preset and not args.industry:
        code = load_preset(args.preset).get("cc_industry")
        args.industry = str(code) if code else None
    if not args.keywords and not args.preset and args.source != "cc":
        sys.exit('No keywords: pass --keywords "..." or --preset <id>.')
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
