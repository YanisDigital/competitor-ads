"""Runs scrape.main() with a fake Playwright (no browser, no network) and a captcha at query BLOCK_AT.

    python scrape_blocked_harness.py <scripts dir> <csv file> <out dir> <block at (1-based)>

Prints one JSON line: the exit code and the files that were saved."""
import json
import sys
import types
from pathlib import Path

SCRIPTS, CSV_FILE, OUT, BLOCK_AT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
sys.path.insert(0, SCRIPTS)
CSV_TEXT = Path(CSV_FILE).read_text(encoding="utf-8")
STORE = {"1": {"id": "1"}}


class FakePage:
    def __init__(self):
        self.collected = 0

    async def add_init_script(self, script):
        pass

    async def goto(self, url, **kw):
        pass

    async def evaluate(self, expr, arg=None):
        if "load(" in expr or "scroll()" in expr:
            return None
        if "collect(" in expr:
            self.collected += 1
            return {"captured": 5, "library_says": 5, "total_unique": 5 * self.collected}
        if "currencyForCountry" in expr:
            return "USD"
        if ".report(" in expr:
            return {"ads": 3, "advertisers": 2, "single_ad_advertisers": 1}
        if ".csv()" in expr:
            return CSV_TEXT
        if expr.strip().endswith(".store"):
            return STORE
        raise RuntimeError("the fake page does not know: " + expr)


class FakeBrowser:
    async def new_page(self):
        return FakePage()

    async def close(self):
        pass


class FakeChromium:
    async def launch(self, **kw):
        return FakeBrowser()


class FakePlaywright:
    chromium = FakeChromium()


class FakeContext:
    async def __aenter__(self):
        return FakePlaywright()

    async def __aexit__(self, *exc):
        return False


api = types.ModuleType("playwright.async_api")
api.async_playwright = lambda: FakeContext()
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.async_api"] = api

import scrape  # noqa: E402

calls = {"n": 0}


async def fake_open_query(page, country, keyword, *a, **kw):
    calls["n"] += 1
    if calls["n"] == BLOCK_AT:
        raise scrape.BlockedError("Meta showed a captcha/checkpoint. Stopping: this tool never bypasses captchas.")


scrape.open_query = fake_open_query
sys.argv = ["scrape.py", "--keywords", "q1", "q2", "q3", "q4", "--country", "US", "--out", OUT, "--delay", "0"]
code = 0
try:
    scrape.main()
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
print(json.dumps({"code": code, "files": sorted(p.name for p in Path(OUT).glob("*")), "calls": calls["n"]}))
