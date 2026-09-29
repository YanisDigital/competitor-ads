#!/usr/bin/env python3
"""CLI collector for the Meta Ads Library, driven by Playwright.

Requires Playwright + a Chromium browser, installed explicitly (never
silently by this script):

    pip install playwright
    python -m playwright install chromium

Usage:
    python scrape.py --keywords "nail salon odesa" "manicure odesa" --country UA

Queries can be in any language/script (Ukrainian, Russian, etc.) -- only
this script's own --help text is kept ASCII, since Windows consoles
default to a codepage that can't render Cyrillic in argparse's output.

collector.js (in this same directory) is the single source of truth for
scraping/aggregation logic: this script only drives a browser and calls
window.__mai's public API (scroll, collect, report, csv) via
page.evaluate. It does not reimplement any of that logic in Python.

Policy (see CLAUDE.md): no login, no cookie reuse, no captcha bypass, no
proxy rotation, no stealth/fingerprint spoofing, no more than
MAX_KEYWORDS searches per run. If Meta shows a login wall or a
checkpoint/captcha, this script stops with a clear error instead of
working around it.
"""

import argparse
import asyncio
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import quote

MAX_KEYWORDS = 15
DEFAULT_DELAY = 3.0
DEFAULT_LONG_DAYS = 90
COLLECTOR_JS = Path(__file__).parent / "collector.js"
PRESETS_DIR = Path(__file__).parent.parent / "presets"
EXPRESS_QUERIES = 3

SEARCH_INPUT_SELECTORS = [
    'input[type="search"]',  # live placeholder: "Search by keyword or advertiser", no aria-label
    'input[placeholder*="Search by keyword"]',
    'input[aria-label="Search by keyword"]',
]

LOGIN_MARKERS = ["log in to continue", "log into facebook", "войдите", "увійдіть"]
CAPTCHA_MARKERS = ["security check", "checkpoint", "captcha", "перевірка безпеки", "проверка безопасности"]


class BlockedError(RuntimeError):
    """Raised when Meta shows a login wall or a captcha/checkpoint."""


# Cyrillic keywords are the common case for this tool (UA/RU niches), and
# NFKD+ascii alone drops every Cyrillic letter (they have no ASCII
# decomposition), which turned every such query into the same "niche"
# slug. Transliterate first so --out defaults stay distinct per query.
_CYRILLIC_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie",
    "ё": "io", "ж": "zh", "з": "z", "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "iu", "я": "ia",
}


def slugify(text: str) -> str:
    text = "".join(_CYRILLIC_TRANSLIT.get(ch, ch) for ch in text.lower())
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "niche"


def library_url(country: str, query: str) -> str:
    return (
        "https://www.facebook.com/ads/library/"
        f"?active_status=active&ad_type=all&country={country}"
        f"&q={quote(query, safe='')}&search_type=keyword_unordered&media_type=all"
    )


def read_keywords(args) -> list[str]:
    if args.keywords_file:
        lines = Path(args.keywords_file).read_text(encoding="utf-8").splitlines()
        kws = [line.strip() for line in lines if line.strip()]
    else:
        kws = list(args.keywords or [])
    if not kws and args.preset:
        return []  # queries are built from the preset inside run(), by collector.js
    if not kws:
        sys.exit('No keywords given. Pass --keywords "query 1" "query 2", --keywords-file <path>, or --preset <id> --city-uk ... --city-ru ...')
    if len(kws) > MAX_KEYWORDS:
        sys.exit(f"Too many keywords ({len(kws)}); limit is {MAX_KEYWORDS} per run to stay polite to Meta.")
    return kws


def load_preset(preset_id: str) -> dict:
    path = PRESETS_DIR / f"{preset_id}.json"
    if not path.is_file():
        available = ", ".join(sorted(p.stem for p in PRESETS_DIR.glob("*.json")))
        sys.exit(f"Unknown preset '{preset_id}'. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


async def detect_block(page) -> None:
    """Raise BlockedError if the page shows a login wall or a captcha/checkpoint."""
    text = await page.evaluate("document.body.innerText.slice(0, 3000)")
    lowered = text.lower()
    if any(marker in lowered for marker in LOGIN_MARKERS):
        raise BlockedError("Meta showed a login wall. Stopping: this tool never logs in or reuses cookies.")
    if any(marker in lowered for marker in CAPTCHA_MARKERS):
        raise BlockedError("Meta showed a captcha/checkpoint. Stopping: this tool never bypasses captchas.")


async def type_query(page, keyword: str) -> None:
    for selector in SEARCH_INPUT_SELECTORS:
        field = await page.query_selector(selector)
        if field:
            await field.click()
            await field.fill("")
            await field.fill(keyword)
            await page.keyboard.press("Enter")
            return
    raise RuntimeError(
        "Could not find the Ads Library search field (tried: "
        f"{', '.join(SEARCH_INPUT_SELECTORS)}). The page layout may have "
        "changed; try --headed to see what loaded, and update "
        "SEARCH_INPUT_SELECTORS in scrape.py if needed."
    )


async def run(args, keywords: list[str]) -> None:
    from playwright.async_api import async_playwright  # imported lazily so arg validation works without playwright installed

    collector_src = COLLECTOR_JS.read_text(encoding="utf-8")
    preset = load_preset(args.preset) if args.preset else None
    country = args.country or (preset or {}).get("country") or "UA"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.headed)
        page = await browser.new_page()
        # Installed before any page script runs, so the fetch/XHR
        # interceptor is in place for the very first GraphQL request.
        await page.add_init_script(script=collector_src)

        try:
            if not keywords:
                cities = {"uk": args.city_uk, "ru": args.city_ru}
                await page.goto("about:blank")  # collector.js is installed here too; query building stays in JS
                keywords = await page.evaluate(
                    "([p, c, m]) => window.__mai.buildQueries(p, c, m)", [preset, cities, args.max_queries]
                )
            if args.express:
                keywords = keywords[:EXPRESS_QUERIES]
            if not keywords:
                sys.exit("No queries to run.")
            out_dir = Path(args.out) if args.out else Path("out") / slugify(keywords[0])
            out_dir.mkdir(parents=True, exist_ok=True)
            print(f"Queries ({len(keywords)}): " + " | ".join(keywords))

            print(f"[1/{len(keywords)}] opening Ads Library for: {keywords[0]}")
            await page.goto(library_url(country, keywords[0]), wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass  # the Ads Library may never go fully idle; the fixed wait below covers it
            await page.wait_for_timeout(3000)
            await detect_block(page)

            installed = await page.evaluate("typeof window.__mai !== 'undefined'")
            if not installed:
                sys.exit("window.__mai did not install. The Ads Library page structure may have changed.")

            for i, kw in enumerate(keywords):
                if i > 0:
                    print(f"[{i + 1}/{len(keywords)}] searching: {kw}")
                    await type_query(page, kw)
                    await page.wait_for_timeout(4000)
                    await detect_block(page)

                await page.evaluate("window.__mai.scroll()")
                summary = await page.evaluate("(kw) => window.__mai.collect(kw)", kw)
                print(
                    f"    captured={summary['captured']} "
                    f"library_says={summary['library_says']} "
                    f"total_unique={summary['total_unique']}"
                )

                if i < len(keywords) - 1:
                    await asyncio.sleep(args.delay)

            report_opts = {"longDays": args.long_days}
            if preset:
                report_opts["extraHooks"] = preset.get("extra_hooks", {})
                report_opts["noise"] = preset.get("noise", [])
                if preset.get("online_only"):
                    report_opts["onlineOnly"] = True
                if preset.get("base_hooks") is False:
                    report_opts["baseHooks"] = False
                if preset.get("currency"):
                    report_opts["currency"] = preset["currency"]
            report = await page.evaluate("(opts) => window.__mai.report(opts)", report_opts)
            csv_text = await page.evaluate("() => window.__mai.csv()")
        except BlockedError as e:
            sys.exit(f"Stopped: {e}")
        finally:
            await browser.close()

    report_path = out_dir / "report.json"
    csv_path = out_dir / "ads.csv"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path.write_text(csv_text, encoding="utf-8")

    print()
    print(
        f"Ads collected: {report['ads']} from {report['advertisers']} advertisers "
        f"({report['single_ad_advertisers']} with a single ad)"
    )
    if report["ads"] == 0:
        print("No ads captured. If this is unexpected, retry with --headed to see what the browser actually loaded.")
    print(f"Saved: {report_path}")
    print(f"Saved: {csv_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect active ads from the Meta Ads Library for a niche + city.")
    parser.add_argument("--keywords", nargs="+", help='Search queries, e.g. --keywords "nail salon odesa" "manicure odesa" (any language works, just avoid non-ASCII in --help)')
    parser.add_argument("--keywords-file", help="Path to a text file with one query per line")
    parser.add_argument("--country", default=None, help="Ads Library country code (default: the preset's country, else UA)")
    parser.add_argument("--long-days", type=int, default=DEFAULT_LONG_DAYS, dest="long_days", help=f"Longrun threshold in days (default: {DEFAULT_LONG_DAYS})")
    parser.add_argument("--out", help="Output directory (default: out/<slug of first keyword>/)")
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser window (use this if headless returns empty results or a login wall)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Seconds to wait between searches (default: {DEFAULT_DELAY})")
    parser.add_argument("--preset", help="Niche preset id from presets/ (beauty, dentistry, fitness, auto-service); builds queries from services x languages")
    parser.add_argument("--city-uk", default="", dest="city_uk", help="City name in Ukrainian for preset queries")
    parser.add_argument("--city-ru", default="", dest="city_ru", help="City name in Russian for preset queries")
    parser.add_argument("--max-queries", type=int, default=12, dest="max_queries", help="Max preset-built queries (default: 12)")
    parser.add_argument("--express", action="store_true", help=f"Quick look: run only the first {EXPRESS_QUERIES} queries")
    parser.add_argument("--list-presets", action="store_true", dest="list_presets", help="List available niche presets and exit")
    args = parser.parse_args()
    if args.list_presets:
        for path in sorted(PRESETS_DIR.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            print(f"{data['id']}: {data['title']} ({len(data['services'])} services)")
        return
    if args.max_queries > MAX_KEYWORDS:
        sys.exit(f"--max-queries above {MAX_KEYWORDS} is not allowed.")
    keywords = read_keywords(args)  # validated before importing/launching Playwright

    asyncio.run(run(args, keywords))


if __name__ == "__main__":
    main()
