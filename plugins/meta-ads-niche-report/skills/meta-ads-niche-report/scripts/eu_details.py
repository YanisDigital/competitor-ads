#!/usr/bin/env python3
"""EU transparency data (reach and audience) for the ads of a snapshot.

    python eu_details.py out/<name>/<date> [--limit 20] [--delay 6] [--headed]

Meta publishes, for ads delivered in the EU, the total reach, the targeting
(age, gender, places) and the age/gender split of who was actually reached. It
is not in the search results: the Library sends it when "See ad details" is
opened on an ad, one request per ad. This script does exactly that, like a
person clicking, for the ads that count in the snapshot (curation.json
applied, collector.js's choice), at most --limit of them (default 20, cap 50),
the longest-running ad of every advertiser first, with a pause between ads.
Result: <folder>/eu.json; report.js, Excel and HTML pick it up from there.

Only for snapshots collected for an EU country: for any other country the
Library has no such data and the script stops. Policy as everywhere in this
project: no login, no captcha bypass, no proxies, no stealth; a login wall or a
checkpoint stops the run. Parsing lives in collector.js (parseEuDetails).
"""
import argparse
import asyncio
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import scrape  # noqa: E402  (BlockedError, detect_block, validate_country)

COLLECTOR_JS = HERE / "collector.js"
MAX_ADS = 50
DEFAULT_ADS = 20
MIN_DELAY = 4.0
BUTTONS = ("See ad details", "Переглянути деталі реклами")  # the Library UI language follows the browser locale; we ask for English


def node_json(code: str, *args: str):
    try:
        res = subprocess.run(["node", "-e", code, *args], capture_output=True, encoding="utf-8", timeout=120)
    except FileNotFoundError:
        sys.exit("Node.js is required (collector.js does the work).")
    if res.returncode != 0:
        sys.exit("Could not read the snapshot: " + res.stderr.strip()[:300])
    return json.loads(res.stdout)


def plan(folder: Path, limit: int) -> tuple[str, list[dict]]:
    """(country, [{id, page}]): the snapshot's country and the ads to open."""
    code = (
        "const c=require(process.argv[1]);const {loadSnapshot}=require(process.argv[2]);"
        "const s=loadSnapshot(process.argv[3]);const ids=c.pickEuAds(s.rows,Number(process.argv[4]));"
        "const by=new Map(s.rows.map(r=>[r.id,r.page]));"
        "console.log(JSON.stringify({country:s.meta.country||'',eu:c.isEuCountry(s.meta.country),ads:ids.map(id=>({id,page:by.get(id)}))}))"
    )
    out = node_json(code, str(COLLECTOR_JS), str(HERE / "report.js"), str(folder), str(limit))
    if not out["eu"]:
        sys.exit(f"This snapshot was collected for {out['country'] or 'an unknown country'}, which is not an EU country: "
                 "the Library has EU reach and audience data only for ads delivered in the EU.")
    ads = [a for a in out["ads"] if re.fullmatch(r"\d{1,25}", str(a.get("id", "")))]  # the id goes into the Library URL
    if not ads:
        sys.exit("No ads left in that snapshot (check its curation.json).")
    return out["country"], ads


def save(done: dict, country: str, path: Path) -> None:
    done.update({"date": datetime.now(timezone.utc).isoformat(), "country": country,
                 "note": "Reach is per ad; summing the ads of one advertiser counts overlapping people twice."})
    path.write_text(json.dumps(done, ensure_ascii=False, indent=2), encoding="utf-8")


async def run(args) -> None:
    from playwright.async_api import async_playwright  # lazy: argument errors do not need Playwright

    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    country, ads = plan(folder, args.limit)
    collector_src = COLLECTOR_JS.read_text(encoding="utf-8")
    eu_path = folder / "eu.json"
    done = json.loads(eu_path.read_text(encoding="utf-8")) if eu_path.exists() else {"ads": {}, "no_data": []}
    todo = [a for a in ads if a["id"] not in done["ads"] and a["id"] not in done.get("no_data", [])]
    print(f"Country {country}: {len(ads)} ads picked, {len(todo)} not collected yet.")
    failed = []
    if not todo:
        print("Nothing to do.")
        return

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.headed)
        context = await browser.new_context(locale="en-US")
        blank = await context.new_page()
        await blank.add_init_script(script=collector_src)
        await blank.goto("about:blank")  # collector.js is installed here; parsing stays in JS
        try:
            for i, ad in enumerate(todo, 1):
                print(f"[{i}/{len(todo)}] ad {ad['id']} ({ad['page']})")
                page = await context.new_page()
                captured = []

                async def on_response(resp, captured=captured):
                    if "graphql" in resp.url:
                        try:
                            text = await resp.text()
                        except Exception:
                            return
                        if "eu_total_reach" in text:
                            captured.append(text)

                page.on("response", on_response)
                try:
                    await page.goto(f"https://www.facebook.com/ads/library/?id={ad['id']}", wait_until="domcontentloaded")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    await page.wait_for_timeout(2500)
                    await scrape.detect_block(page)
                    for label in BUTTONS:
                        button = page.get_by_text(label, exact=True)
                        if await button.count():
                            try:
                                await button.first.click(timeout=8000)
                            except Exception:
                                # an invisible layer can sit over the button: the same click, sent to the element itself
                                await button.first.dispatch_event("click")
                            await page.wait_for_timeout(5000)
                            break
                    details = None
                    for text in captured:
                        details = await blank.evaluate("(t) => window.__mai.parseEuDetails(t)", text)
                        if details:
                            break
                    if details:
                        done["ads"][ad["id"]] = details
                        print(f"    reach {details['eu_total_reach']}, age {details['age_min']}-{details['age_max']}, {details['gender']}")
                    else:
                        done.setdefault("no_data", []).append(ad["id"])
                        print("    no EU data for this ad")
                except scrape.BlockedError:
                    raise
                except Exception as e:  # one broken ad must not lose the others; it stays "not collected" and can be retried
                    failed.append(ad["id"])
                    print(f"    failed ({type(e).__name__}), skipped")
                finally:
                    await page.close()
                save(done, country, eu_path)  # keep what is collected so far
                if i < len(todo):
                    await asyncio.sleep(args.delay)
        except scrape.BlockedError as e:
            print(f"Stopped: {e}")
        finally:
            await browser.close()

    save(done, country, eu_path)
    print(f"Saved: {eu_path} ({len(done['ads'])} ads with data, {len(done.get('no_data', []))} without"
          + (f", {len(failed)} failed: run again to retry them" if failed else "") + ")")


def main() -> None:
    ap = argparse.ArgumentParser(description="Collect EU reach and audience data for the ads of a snapshot.")
    ap.add_argument("folder", help="snapshot folder with ads.csv (collected for an EU country)")
    ap.add_argument("--limit", type=int, default=DEFAULT_ADS, help=f"how many ads to open (default {DEFAULT_ADS}, cap {MAX_ADS})")
    ap.add_argument("--delay", type=float, default=6.0, help=f"seconds between ads (default 6, minimum {MIN_DELAY:g})")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    args = ap.parse_args()
    if not 1 <= args.limit <= MAX_ADS:
        sys.exit(f"--limit must be between 1 and {MAX_ADS} to stay polite to Meta.")
    if args.delay < MIN_DELAY:
        sys.exit(f"--delay below {MIN_DELAY:g} seconds is not allowed.")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
