#!/usr/bin/env python3
"""Google Trends for a niche: demand, season and rising queries (no login, no unofficial library).

For a snapshot folder it takes the niche phrases (the preset's services in one language, or the words of
run.json's queries, or --phrases), opens trends.google.com Explore in Playwright for each one, keeps the
page's own data responses and saves <folder>/trends/raw.json. Everything that is computed (status of the
curve, season, rising queries) is scripts/trends.js, which this script runs at the end: <folder>/trends.json,
used by report.js, the HTML report and the Excel table.

    python trends.py out/dentistry/2026-10-14                       # preset services, geo = run.json country
    python trends.py out/dentistry/2026-10-14 --geo UA-51           # a region of Ukraine (Odesa oblast)
    python trends.py out/x/2026-10-14 --phrases "ремонт iphone" "заміна екрана" --lang uk

Requires Playwright (see scrape.py); the installed Chrome is used with --chrome.

Policy: no login, no cookie reuse, no captcha solving, no proxies. Measured live (October 2026): a first-time
visitor gets an "unusual traffic" page once, and quick successive loads get HTTP 429 on the data calls. So: a
warm-up visit, one page load per phrase, a pause between phrases (default 15 s, never under 10), one retry
after 60 s, at most MAX_LOADS page loads per run, raw answers cached for 3 days in <folder>/trends/cache/.
Two failures in a row stop the run: what was fetched is kept (exit code 3), nothing is worked around.
A narrow local phrase often has no measurable demand ("insufficient"): that is an answer, not an error.
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
PRESETS_DIR = HERE.parent / "presets"
MAX_LOADS = 20
MAX_PHRASES = 15
DEFAULT_DELAY = 15.0
CACHE_DAYS = 3
PERIODS = ("today 12-m", "today 5-y")
BLOCK_MARKERS = ["unusual traffic", "too many requests", "429. that", "sorry, but you have sent", "незвичайний трафік", "необычный трафик"]
# interface language of the Explore page by country (the phrase itself decides what is measured)
DEFAULT_HL = {"UA": "uk", "PL": "pl", "KZ": "ru", "CZ": "cs", "DE": "de", "US": "en-US", "GB": "en-GB"}


class Blocked(RuntimeError):
    """Google Trends throttled the run (429 or an "unusual traffic" page)."""


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text).lower())
    text = re.sub(r"[^\w]+", "-", text, flags=re.U).strip("-")
    return text[:60] or "x"


def validate_geo(value: str) -> str:
    """A country (UA) or a region (UA-51): the value goes into a URL."""
    code = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}(-[A-Z0-9]{1,3})?", code):
        sys.exit(f"Bad --geo {value!r}: use a country code such as UA, or a region such as UA-51 (Odesa oblast), UA-30 (Kyiv).")
    return code


def validate_hl(value: str) -> str:
    code = str(value or "").strip()
    if not re.fullmatch(r"[a-z]{2}(-[A-Z]{2})?", code):
        sys.exit(f"Bad --lang {value!r}: use a code such as uk, ru, pl or en-US.")
    return code


def load_preset(preset_id):
    if not preset_id:
        return None
    if not re.fullmatch(r"[a-z0-9-]+", preset_id):  # the id becomes a file name: no '..' or slashes
        sys.exit(f"Bad preset id {preset_id!r}.")
    path = PRESETS_DIR / f"{preset_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def pick_phrases(preset, run: dict, lang: str, limit: int) -> list[str]:
    """Niche phrases without a city: the preset's services in the language `lang` (else the first language of the
    service), or, with no preset, the queries of run.json (as searched)."""
    out: list[str] = []
    base = lang.split("-")[0]
    if preset and preset.get("services"):
        for s in preset["services"]:
            phrase = s.get(base) or s.get(lang) or next(iter(s.values()), "")
            if phrase and phrase not in out:
                out.append(phrase)
    else:
        for q in run.get("queries") or []:
            q = re.sub(r"\s+", " ", str(q)).strip()
            if q and not q.startswith("page:") and q not in out:
                out.append(q)
    return out[:limit]


class Client:
    def __init__(self, cache_dir: Path, geo: str, hl: str, delay: float, chrome: bool, force: bool):
        self.cache_dir, self.geo, self.hl, self.delay, self.chrome, self.force = cache_dir, geo, hl, delay, chrome, force
        self.loads, self.fails_in_row = 0, 0

    def cache_path(self, phrase: str, period: str) -> Path:
        return self.cache_dir / f"{slug(phrase)}--{self.geo}--{slug(period)}.json"

    def cached(self, phrase: str, period: str):
        f = self.cache_path(phrase, period)
        if self.force or not f.exists():
            return None
        d = json.loads(f.read_text(encoding="utf-8"))
        return d if time.time() - d.get("fetched_ts", 0) < CACHE_DAYS * 86400 else None

    async def __aenter__(self):
        from playwright.async_api import async_playwright  # lazy: argument errors need no Playwright
        self._pw = await async_playwright().start()
        kw = {"channel": "chrome"} if self.chrome else {}
        self.browser = await self._pw.chromium.launch(headless=True, **kw)
        self.ctx = await self.browser.new_context(locale="en-US", viewport={"width": 1300, "height": 900})
        warm = await self.ctx.new_page()  # the cookies a first-time visitor gets
        await warm.goto(f"https://trends.google.com/trends/?geo={self.geo}&hl={self.hl}", wait_until="domcontentloaded")
        await warm.wait_for_timeout(4000)
        await warm.close()
        return self

    async def __aexit__(self, *a):
        await self.browser.close()
        await self._pw.stop()

    async def _load(self, phrase: str, period: str) -> dict:
        page = await self.ctx.new_page()
        got = {"multiline": None, "related": [], "throttled": 0}

        async def on_resp(r):
            u = r.url
            if "/trends/api/" in u and r.status == 429:
                got["throttled"] += 1  # the page itself still looks normal when only the data calls are refused
            try:
                if "/widgetdata/multiline" in u and r.status == 200:
                    got["multiline"] = await r.text()
                elif "/widgetdata/relatedsearches" in u and r.status == 200:
                    got["related"].append(await r.text())
            except Exception:
                pass

        page.on("response", on_resp)
        await page.route("**/trends/api/widgetdata/comparedgeo**", lambda route: route.abort())  # the map is not needed: fewer calls
        url = f"https://trends.google.com/trends/explore?date={quote(period)}&geo={self.geo}&q={quote(phrase)}&hl={self.hl}"
        await page.goto(url, wait_until="domcontentloaded")
        for _ in range(40):
            await page.wait_for_timeout(500)
            if got["multiline"] is not None and len(got["related"]) >= 2:
                break
        text = (await page.evaluate("document.body ? document.body.innerText.slice(0, 600) : ''")).lower()
        await page.close()
        self.loads += 1
        if got["multiline"] is None and (got["throttled"] or any(m in text for m in BLOCK_MARKERS)):
            raise Blocked("Google Trends answered 429 / 'unusual traffic'")
        return got

    async def fetch(self, phrase: str, period: str, parse) -> dict:
        """One phrase: the timeline and the related queries, from the cache or the page (one retry after 60 s)."""
        hit = self.cached(phrase, period)
        if hit:
            return hit
        if self.loads >= MAX_LOADS:
            raise Blocked(f"the page-load limit of {MAX_LOADS} per run is reached")
        got, err = None, ""
        for attempt in (1, 2):
            try:
                got = await self._load(phrase, period)
                if got["multiline"] is not None:
                    break
                err = "no timeline data in the page's answers"
            except Blocked as e:
                err = str(e)
            if attempt == 1:
                print(f"    {phrase!r}: {err}; waiting 60 s and retrying once")
                await asyncio.sleep(60)
        if not got or got["multiline"] is None:
            self.fails_in_row += 1
            if self.fails_in_row >= 2:
                raise Blocked(f"two failures in a row ({err}): stopping, try again in a few hours")
            return {"phrase": phrase, "error": err}
        self.fails_in_row = 0
        rec = parse(phrase, period, got)
        self.cache_path(phrase, period).parent.mkdir(parents=True, exist_ok=True)
        self.cache_path(phrase, period).write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        await asyncio.sleep(self.delay)
        return rec


def make_parser(folder: Path):
    """The page's bodies are parsed by trends.js (the single source of truth): node turns them into points and queries."""
    code = ("const t=require(process.argv[1]);const g=JSON.parse(require('fs').readFileSync(0,'utf8'));"
            "const ml=t.parseWidget(g.multiline);const rel=g.related.map(t.parseWidget).find(t.isQueriesWidget);"
            "const l=rel?t.relatedLists(rel):{top:[],rising:[]};"
            "console.log(JSON.stringify({timeline:t.timelinePoints(ml),related_top:l.top.slice(0,15),related_rising:l.rising.slice(0,15),related_ok:!!rel}))")

    def parse(phrase: str, period: str, got: dict) -> dict:
        res = subprocess.run(["node", "-e", code, str(HERE / "trends.js")], input=json.dumps(got), capture_output=True, encoding="utf-8", timeout=60)  # stdin: a 5-year answer is over the 32k command-line limit of Windows
        if res.returncode != 0:
            raise RuntimeError("trends.js could not read the answers: " + res.stderr.strip()[:300])
        return {"phrase": phrase, "period": period, "fetched_ts": time.time(), **json.loads(res.stdout)}

    return parse


async def run(args, folder: Path, phrases: list[str], geo: str, hl: str) -> int:
    items, code = [], 0
    async with Client(folder / "trends" / "cache", geo, hl, args.delay, args.chrome, args.force) as c:
        parse = make_parser(folder)
        for ph in phrases:
            try:
                rec = await c.fetch(ph, args.period, parse)
            except Blocked as e:
                print(f"Stopped: {e}")
                code = 3
                break
            if rec.get("error"):
                print(f"  {ph!r}: {rec['error']}")
            else:
                nz = sum(1 for p in rec["timeline"] if p["v"] > 0)
                print(f"  {ph!r}: {len(rec['timeline'])} weeks, {nz} with data, {len(rec.get('related_rising', []))} rising queries")
            items.append({k: v for k, v in rec.items() if k not in ("fetched_ts", "period")} if not rec.get("error") else rec)
        loads = c.loads
    (folder / "trends").mkdir(parents=True, exist_ok=True)
    raw = {"geo": geo, "hl": hl, "period": args.period, "fetched_at": datetime.now(timezone.utc).isoformat(), "items": items}
    (folder / "trends" / "raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {folder / 'trends' / 'raw.json'} ({len(items)} phrases, {loads} page loads)")
    if items and not args.no_build:
        subprocess.run(["node", str(HERE / "trends.js"), str(folder)], check=False)
    return code


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Google Trends for a niche: demand, season and rising queries, into a snapshot folder.")
    ap.add_argument("folder", help="Snapshot folder (with run.json); trends/raw.json and trends.json are written into it")
    ap.add_argument("--phrases", nargs="+", help="Niche phrases instead of the preset's services / the queries of run.json (no city names)")
    ap.add_argument("--geo", help="Country or region (default: the country of run.json). Regions of Ukraine: UA-30 Kyiv, UA-51 Odesa oblast, UA-46 Lviv oblast, UA-63 Kharkiv oblast")
    ap.add_argument("--lang", help="Language of the Explore page and of the preset services (default by country: UA uk, PL pl, ...)")
    ap.add_argument("--period", choices=PERIODS, default="today 5-y", help="today 5-y (default: the season needs years) or today 12-m")
    ap.add_argument("--max-phrases", type=int, default=8, dest="max_phrases", help=f"Phrases per run (default 8, max {MAX_PHRASES})")
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Seconds between page loads (default {DEFAULT_DELAY}, never under 10)")
    ap.add_argument("--chrome", action="store_true", help="Use the installed Chrome instead of Playwright's Chromium")
    ap.add_argument("--force", action="store_true", help="Ignore the 3-day cache")
    ap.add_argument("--no-build", action="store_true", dest="no_build", help="Only save trends/raw.json, do not run trends.js")
    args = ap.parse_args()
    if args.delay < 10:
        sys.exit("--delay below 10 seconds is not allowed (Google Trends answers 429 to quick successive loads).")
    if not 1 <= args.max_phrases <= MAX_PHRASES:
        sys.exit(f"--max-phrases must be 1..{MAX_PHRASES}.")
    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"No such folder: {folder}")
    run_json = folder / "run.json"
    meta = json.loads(run_json.read_text(encoding="utf-8")) if run_json.exists() else {}
    geo = validate_geo(args.geo or meta.get("country") or "")
    hl = validate_hl(args.lang or DEFAULT_HL.get(geo.split("-")[0], "en-US"))
    preset = load_preset(meta.get("preset"))
    phrases = [re.sub(r"\s+", " ", p).strip() for p in args.phrases] if args.phrases else pick_phrases(preset, meta, hl, args.max_phrases)
    phrases = [p for p in dict.fromkeys(phrases) if p][: args.max_phrases]
    if not phrases:
        sys.exit('No phrases: give --phrases "..." (the folder has no preset services or queries).')
    print(f"Google Trends, geo {geo}, page language {hl}, {len(phrases)} phrases: " + " | ".join(phrases))
    sys.exit(asyncio.run(run(args, folder, phrases, geo, hl)))


if __name__ == "__main__":
    main()
