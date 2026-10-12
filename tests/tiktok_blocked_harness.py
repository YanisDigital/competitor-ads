"""Runs the TikTok scrape.main() with a fake Playwright (no browser, no network) and a captcha at query BLOCK_AT.

    python tiktok_blocked_harness.py <scripts dir> <csv file> <out dir> <block at (1-based)>

Prints one JSON line: the exit code and the files that were saved."""
import json
import sys
import types
from pathlib import Path

SCRIPTS, CSV_FILE, OUT, BLOCK_AT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
sys.path.insert(0, SCRIPTS)
CSV_TEXT = Path(CSV_FILE).read_text(encoding="utf-8")


class FakePage:
    def __init__(self):
        self.collected = 0
        self.keyboard = types.SimpleNamespace(press=self._noop)

    async def _noop(self, *a, **kw):
        pass

    async def add_init_script(self, script):
        pass

    async def goto(self, url, **kw):
        pass

    async def wait_for_load_state(self, *a, **kw):
        pass

    async def wait_for_timeout(self, ms):
        pass

    async def close(self):
        pass

    async def evaluate(self, expr, arg=None):
        if "sourceForCountry" in expr:
            return "library"
        if "langsForCountry" in expr:
            return ["en"]
        if ".more(" in expr:
            return None
        if "collect(" in expr:
            self.collected += 1
            return {"captured": 5, "total_says": 5, "total_unique": 5 * self.collected}
        if ".csv()" in expr:
            return CSV_TEXT
        raise RuntimeError("the fake page does not know: " + expr)


class FakeContext:
    async def add_init_script(self, script):
        pass

    async def new_page(self):
        return FakePage()


class FakeBrowser:
    async def new_page(self):
        return FakePage()

    async def new_context(self, **kw):
        return FakeContext()

    async def close(self):
        pass


class FakeChromium:
    async def launch(self, **kw):
        return FakeBrowser()


class FakePlaywright:
    chromium = FakeChromium()


class FakeManager:
    async def __aenter__(self):
        return FakePlaywright()

    async def __aexit__(self, *exc):
        return False


api = types.ModuleType("playwright.async_api")
api.async_playwright = lambda: FakeManager()
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.async_api"] = api

import scrape  # noqa: E402

import asyncio  # noqa: E402
_sleep = asyncio.sleep


async def _fast_sleep(seconds, *a, **kw):  # the 1 s minimum pause is enforced by the arguments; the test need not wait for it
    await _sleep(0)


scrape.asyncio.sleep = _fast_sleep

calls = {"n": 0}


async def fake_detect_block(page):
    pass


async def fake_ensure_installed(page):
    pass


async def fake_search_library(page, query):
    calls["n"] += 1
    if calls["n"] == BLOCK_AT:
        raise scrape.BlockedError("TikTok showed a captcha / verification. Stopping: this tool never solves or bypasses captchas.")
    return {}


scrape.detect_block = fake_detect_block
scrape.ensure_installed = fake_ensure_installed
scrape.search_library = fake_search_library
sys.argv = ["scrape.py", "--source", "library", "--keywords", "q1", "q2", "q3", "q4", "--country", "PL", "--out", OUT, "--delay", "1"]
code = 0
try:
    scrape.main()
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
    if not isinstance(e.code, int):
        print(e.code, file=sys.stderr)
print(json.dumps({"code": code, "files": sorted(p.name for p in Path(OUT).glob("*")), "calls": calls["n"]}))
