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
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).parent
MAX_KEYWORDS = 15
DEFAULT_DELAY = 3.0
DEFAULT_LONG_DAYS = 90
COLLECTOR_JS = Path(__file__).parent / "collector.js"
PRESETS_DIR = Path(__file__).parent.parent / "presets"
EXPRESS_QUERIES = 3

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


def default_out_dir(name: str) -> Path:
    """out/<preset or slug>/<YYYY-MM-DD>; a second run on the same day gets -2, -3, ...
    so repeated runs are separate snapshots that compare.js can diff."""
    base = Path("out") / name
    day = datetime.now().strftime("%Y-%m-%d")
    candidate, n = base / day, 2
    while (candidate / "ads.csv").exists():
        candidate = base / f"{day}-{n}"
        n += 1
    return candidate


VALID_STATUSES = ("active", "inactive", "all")
# media filter: the Library's plain "image" value returns nothing, "image_and_meme" returns image ads
MEDIA_PARAM = {"all": "all", "video": "video", "image": "image_and_meme", "meme": "meme"}
VALID_SORTS = ("impressions", "relevancy")  # impressions is the Library's default order


def validate_country(value: str) -> str:
    """Two-letter country code, upper-cased: the value goes into a URL (it may come from --country or a run.json)."""
    code = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", code):
        sys.exit(f"Bad country {value!r}: use a two-letter code such as UA, KZ or US.")
    return code


def validate_date(value: str) -> str:
    """YYYY-MM-DD only: the value goes into a URL."""
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else sys.exit(f"Bad date {value!r}: use YYYY-MM-DD.")
    except ValueError:
        sys.exit(f"Bad date {value!r}: use YYYY-MM-DD.")


def validate_language(value: str) -> str:
    """Two-letter ad language code, lower-cased: the value goes into a URL."""
    code = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-z]{2}", code):
        sys.exit(f"Bad language {value!r}: use a two-letter code such as uk, ru or kk.")
    return code


def window_params(status: str = "active", date_from: str | None = None, date_to: str | None = None,
                  language: list | None = None, media: str = "all", sort: str = "impressions") -> str:
    """Status, delivery period, ad language, media type and sort order of a Library
    URL. The Library filters the period by delivery (ads that ran in it), not by
    the day an ad started; the language is the language of the ad text."""
    if status not in VALID_STATUSES:
        sys.exit(f"Bad --status {status!r}: use one of {', '.join(VALID_STATUSES)}.")
    if media not in MEDIA_PARAM:
        sys.exit(f"Bad --media {media!r}: use one of {', '.join(MEDIA_PARAM)}.")
    if sort not in VALID_SORTS:
        sys.exit(f"Bad --sort {sort!r}: use one of {', '.join(VALID_SORTS)}.")
    out = f"&active_status={status}&media_type={MEDIA_PARAM[media]}"
    for i, code in enumerate(dict.fromkeys(validate_language(x) for x in (language or []))):
        out += f"&content_languages[{i}]={code}"
    if sort == "relevancy":
        out += "&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped"
    if date_from:
        out += f"&start_date[min]={validate_date(date_from)}"
    if date_to:
        out += f"&start_date[max]={validate_date(date_to)}"
    return out


def library_url(country: str, query: str, exact: bool = False, status: str = "active", date_from: str | None = None, date_to: str | None = None,
                language: list | None = None, media: str = "all", sort: str = "impressions") -> str:
    # keyword_unordered matches the words anywhere in the ad text (more noise);
    # keyword_exact_phrase only ads that contain the phrase as written.
    search_type = "keyword_exact_phrase" if exact else "keyword_unordered"
    country = validate_country(country)
    return (
        "https://www.facebook.com/ads/library/"
        f"?ad_type=all&country={country}"
        f"&q={quote(query, safe='')}&search_type={search_type}"
        + window_params(status, date_from, date_to, language, media, sort)
    )


def page_library_url(country: str, page_id: str, status: str = "active", date_from: str | None = None, date_to: str | None = None,
                     language: list | None = None, media: str = "all", sort: str = "impressions") -> str:
    """Every ad of one page (the Library's "view all ads" link)."""
    country = validate_country(country)
    return (
        "https://www.facebook.com/ads/library/"
        f"?ad_type=all&country={country}"
        f"&view_all_page_id={page_id}&search_type=page"
        + window_params(status, date_from, date_to, language, media, sort)
    )


def pages_from_snapshot(folder) -> list[dict]:
    """The advertisers that count in a snapshot (after its curation.json), with their page ids.

    The selection is collector.js's (applyCuration, via report.js), not
    re-implemented here. Page ids come from third-party data, so only digits
    are accepted before they go into a URL."""
    code = (
        "const {loadSnapshot}=require(process.argv[1]);const s=loadSnapshot(process.argv[2]);const m=new Map();"
        "for(const r of s.rows) if(!m.has(r.page)) m.set(r.page,r.page_id||'');"
        "console.log(JSON.stringify([...m].map(([name,page_id])=>({page_id,name}))))"
    )
    try:
        res = subprocess.run(["node", "-e", code, str(HERE / "report.js"), str(folder)], capture_output=True, encoding="utf-8", timeout=120)
    except FileNotFoundError:
        sys.exit("Node.js is required to read the snapshot.")
    if res.returncode != 0:
        sys.exit("Could not read the snapshot: " + res.stderr.strip()[:300])
    pages = json.loads(res.stdout)
    if not pages:
        sys.exit("No advertisers left in that snapshot (check its curation.json).")
    if any(not p["page_id"] for p in pages):
        sys.exit("This snapshot has no page_id column (collected by an older version). Collect it again, then curate and retry.")
    bad = [p["name"] for p in pages if not re.fullmatch(r"\d{1,25}", p["page_id"])]
    if bad:
        print("Skipping pages with an unexpected page_id: " + ", ".join(bad), file=sys.stderr)
    return [p for p in pages if re.fullmatch(r"\d{1,25}", p["page_id"])]


def read_keywords(args) -> list[str]:
    if args.pages_of:
        return []  # targets come from the snapshot inside run()
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


async def open_query(page, country: str, keyword: str, exact: bool = False, url: str | None = None, window: tuple = ("active", None, None, None, "all", "impressions")) -> None:
    """Open the Library URL for one query. Each query gets its own page load:
    in headless Chromium the in-page search box returned "no ads match" for
    queries that have results, and crashed the page by the third search."""
    await page.goto(url or library_url(country, keyword, exact, *window), wait_until="domcontentloaded")
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass  # the Ads Library may never go fully idle; the fixed wait below covers it
    await page.wait_for_timeout(3000)
    await detect_block(page)
    if not await page.evaluate("typeof window.__mai !== 'undefined'"):
        sys.exit("window.__mai did not install. The Ads Library page structure may have changed.")


async def run(args, keywords: list[str]) -> None:
    from playwright.async_api import async_playwright  # imported lazily so arg validation works without playwright installed

    collector_src = COLLECTOR_JS.read_text(encoding="utf-8")
    preset = load_preset(args.preset) if args.preset else None
    country = validate_country(args.country or (preset or {}).get("country") or "UA")
    window = (args.status, args.date_from, args.date_to, args.language, args.media, args.sort)
    window_params(*window)  # validates status, dates, language, media and sort before any browser starts
    page_urls = {}  # label -> link, for --pages-of
    if args.pages_of:
        src_run = Path(args.pages_of) / "run.json"
        if not args.country and src_run.exists():
            country = validate_country(json.loads(src_run.read_text(encoding="utf-8")).get("country") or country)
        pages = pages_from_snapshot(args.pages_of)[:MAX_KEYWORDS]
        keywords = [f"page: {p['name']}" for p in pages]
        page_urls = {f"page: {p['name']}": page_library_url(country, p["page_id"], *window) for p in pages}

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
            out_dir = Path(args.out) if args.out else default_out_dir(args.preset or slugify(keywords[0]))
            out_dir.mkdir(parents=True, exist_ok=True)
            print(f"Queries ({len(keywords)}): " + " | ".join(keywords))

            store = {}  # records so far; every page load starts a fresh window.__mai
            rate_limited = []  # queries where Meta refused "load more" (see collector.js)
            for i, kw in enumerate(keywords):
                print(f"[{i + 1}/{len(keywords)}] opening Ads Library for: {kw}")
                await open_query(page, country, kw, args.exact, page_urls.get(kw), window)
                if store:
                    await page.evaluate("(s) => window.__mai.load(s)", store)

                await page.evaluate("window.__mai.scroll()")
                summary = await page.evaluate("(kw) => window.__mai.collect(kw)", kw)
                store = await page.evaluate("() => window.__mai.store")
                print(
                    f"    captured={summary['captured']} "
                    f"library_says={summary['library_says']} "
                    f"total_unique={summary['total_unique']}"
                    + ("  [rate-limited: first batch only]" if summary.get("rate_limited") else "")
                )
                if summary.get("rate_limited"):
                    rate_limited.append(kw)

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
            if "currency" not in report_opts:  # no preset currency: use the country's (KZ: tenge)
                country_currency = await page.evaluate("(c) => window.__mai.currencyForCountry(c)", country)
                if country_currency:
                    report_opts["currency"] = country_currency
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
    (out_dir / "run.json").write_text(
        json.dumps({"date": datetime.now(timezone.utc).isoformat(), "country": country, "queries": keywords,
                    "preset": args.preset, "rate_limited_queries": rate_limited,
                    "search_type": "exact_phrase" if args.exact else "any_words", "headed": bool(args.headed), "status": args.status,
                    **({"language": args.language} if args.language else {}), **({"media": args.media} if args.media != "all" else {}),
                    **({"sort": args.sort} if args.sort != "impressions" else {}),
                    **({"date_from": args.date_from} if args.date_from else {}), **({"date_to": args.date_to} if args.date_to else {}),
                    **({"pages_of": str(args.pages_of)} if args.pages_of else {})}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print()
    print(
        f"Ads collected: {report['ads']} from {report['advertisers']} advertisers "
        f"({report['single_ad_advertisers']} with a single ad)"
    )
    if report["ads"] == 0:
        print("No ads captured. If this is unexpected, retry with --headed to see what the browser actually loaded.")
    if rate_limited:
        print(
            f"Meta rate-limited 'load more' on {len(rate_limited)} of {len(keywords)} queries: they hold only "
            "the first batch (~30 top ads), not the full count the Library shows. Not worked around; "
            "rerun later or use browser mode for fuller results (listed in run.json)."
        )
    print(f"Saved: {report_path}")
    print(f"Saved: {csv_path}")
    if args.creatives and report["ads"]:
        print()
        if creatives_step(out_dir) == "fetch":
            # Picture links expire within days: download the creatives now (fetch_creatives.py picks and fetches them).
            subprocess.run([sys.executable, str(HERE / "fetch_creatives.py"), str(out_dir), "--videos", "20"], check=False)
        else:
            print("Creatives: not downloaded yet. Searches match ad text, so the snapshot holds advertisers that are not competitors; "
                  "pick the competitors first (curation.json next to ads.csv), then run: "
                  f"python fetch_creatives.py {out_dir} --videos 20 (the picture links stay valid for a few days).")


def creatives_step(out_dir: Path) -> str:
    """'fetch' when the competitors are already chosen (curation.json next to ads.csv), else 'curate_first':
    the creative sample is picked from the curated advertisers, so downloading before that wastes it on non-competitors."""
    return "fetch" if (out_dir / "curation.json").exists() else "curate_first"


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect active ads from the Meta Ads Library for a niche + city.")
    parser.add_argument("--keywords", nargs="+", help='Search queries, e.g. --keywords "nail salon odesa" "manicure odesa" (any language works, just avoid non-ASCII in --help)')
    parser.add_argument("--keywords-file", help="Path to a text file with one query per line")
    parser.add_argument("--country", default=None, help="Ads Library country code (default: the preset's country, else UA)")
    parser.add_argument("--long-days", type=int, default=DEFAULT_LONG_DAYS, dest="long_days", help=f"Longrun threshold in days (default: {DEFAULT_LONG_DAYS})")
    parser.add_argument("--out", help="Output directory (default: out/<preset or slug of first keyword>/<date>/)")
    parser.add_argument("--headed", action="store_true", help="Run with a visible browser window (use this if headless returns empty results or a login wall)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Seconds to wait between searches (default: {DEFAULT_DELAY})")
    parser.add_argument("--preset", help="Niche preset id from presets/ (beauty, dentistry, fitness, auto-service); builds queries from services x languages")
    parser.add_argument("--city-uk", default="", dest="city_uk", help="City name in Ukrainian for preset queries")
    parser.add_argument("--city-ru", default="", dest="city_ru", help="City name in Russian for preset queries")
    parser.add_argument("--max-queries", type=int, default=12, dest="max_queries", help="Max preset-built queries (default: 12)")
    parser.add_argument("--pages-of", dest="pages_of", help="Snapshot folder: collect ALL active ads of the advertisers that count there (curation.json applied), instead of keyword searches. Needs a snapshot with page ids (collected by v0.12.4 or newer)")
    parser.add_argument("--status", choices=VALID_STATUSES, default="active", help="active (default), inactive (stopped ads only) or all. Stopped ads show what competitors tried and switched off")
    parser.add_argument("--date-from", dest="date_from", help="YYYY-MM-DD: only ads that were delivered on or after this day")
    parser.add_argument("--date-to", dest="date_to", help="YYYY-MM-DD: only ads that were delivered on or before this day")
    parser.add_argument("--language", nargs="+", metavar="CODE", help="Language of the ad text, one or more two-letter codes (uk ru kk ...); default: any")
    parser.add_argument("--media", choices=tuple(MEDIA_PARAM), default="all", help="Media type: all (default), video, image (image and meme ads) or meme")
    parser.add_argument("--sort", choices=VALID_SORTS, default="impressions", help="impressions (default, the Library's order) or relevancy")
    parser.add_argument("--exact", action="store_true", help="Exact-phrase search (fewer off-niche ads); default matches the words anywhere in the ad")
    parser.add_argument("--creatives", action="store_true", help="After collecting, download the pictures of up to 60 creatives and cut up to 20 videos into frames for analysis (fetch_creatives.py; Meta's links expire within days). Only when curation.json (the chosen competitors) is already next to ads.csv; otherwise it prints the command to run after choosing them")
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
    if args.pages_of and not args.out:
        sys.exit("--pages-of needs --out (a new snapshot folder), so the full page collection does not mix with the original snapshot.")
    keywords = read_keywords(args)  # validated before importing/launching Playwright

    asyncio.run(run(args, keywords))


if __name__ == "__main__":
    main()
