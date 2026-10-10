#!/usr/bin/env python3
"""Network test of check_sites.py's protection against SSRF (needs Playwright and internet).

    python tests/security_check.py

Exit codes: 0 passed, 1 failed, 77 skipped (no Playwright browser or no internet,
the redirects come from httpbin.org).

A local server on 127.0.0.1 counts the requests it receives. Public pages that
redirect to it (and to a router, a cloud metadata address, a decimal IP, a chain
of redirects, sub-resources and an iframe) must never reach it, and a legitimate
redirect must still work. Also checks the address classification, including IPv4
wrapped in IPv6. Exit code 1 on failure.
"""
import asyncio
import http.server
import sys
import threading
import urllib.request
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
import check_sites as cs  # noqa: E402

HITS = []
R = "https://httpbin.org/redirect-to?url="
PORT = 8765


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        HITS.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>INTERNAL</h1>")

    def log_message(self, *a):
        pass


def q(u: str) -> str:
    return R + quote(u, safe="")


def check_addresses() -> int:
    bad = 0
    cases = {
        "http://127.0.0.1/": False, "http://2130706433/": False, "http://0x7f.0.0.1/": False, "http://[::1]/": False,
        "http://[::ffff:127.0.0.1]/": False, "http://[64:ff9b::7f00:1]/": False, "http://[2002:7f00:1::]/": False,
        "http://169.254.169.254/": False, "http://10.0.0.1/": False, "http://100.64.0.1/": False, "http://localhost/": False,
        "ftp://example.com/": False, "file:///etc/passwd": False, "http://user:pw@example.com/": False, "https://example.com/": True,
    }
    for url, want in cases.items():
        if cs.is_public_url(url) != want:
            print(f"FAIL address {url}: expected {want}")
            bad += 1
    return bad


async def check_redirects() -> int:
    from playwright.async_api import async_playwright
    bad = 0
    async with async_playwright() as pw:
        try:
            b = await pw.chromium.launch()
        except Exception as e:
            skip(f"cannot launch Chromium ({str(e)[:80]}): python -m playwright install chromium")
        ctx = await b.new_context(java_script_enabled=False, accept_downloads=False)
        await ctx.route("**/*", cs.guard_requests)
        await ctx.route_web_socket("**", cs.refuse_websocket)
        pg = await ctx.new_page()
        must_block = {
            "redirect to 127.0.0.1": q(f"http://127.0.0.1:{PORT}/nav"),
            "redirect to a router": q("http://192.168.1.1/"),
            "redirect to the metadata address": q("http://169.254.169.254/latest/"),
            "redirect to a decimal IP": q(f"http://2130706433:{PORT}/nav"),
            "redirect chain ending at 127.0.0.1": q(q(f"http://127.0.0.1:{PORT}/chain")),
            "credentials in the URL": "https://user:pw@example.com/",
        }
        for name, url in must_block.items():
            try:
                await cs.safe_goto(pg, url)
                print(f"FAIL {name}: was opened ({pg.url})")
                bad += 1
            except ValueError:
                pass
        for name, url in {"legitimate redirect": q("https://example.com/"), "plain public page": "https://example.com/"}.items():
            try:
                await cs.safe_goto(pg, url)
                if "example.com" not in pg.url:
                    print(f"FAIL {name}: ended at {pg.url}")
                    bad += 1
            except Exception as e:
                print(f"FAIL {name}: {e}")
                bad += 1
        await pg.set_content(f'<img src="{q(f"http://127.0.0.1:{PORT}/img")}"><iframe src="{q(f"http://127.0.0.1:{PORT}/iframe")}"></iframe>')
        await pg.wait_for_timeout(5000)
        await b.close()
    return bad


def skip(why: str) -> None:
    print("skipped:", why)
    sys.exit(77)


def preflight() -> None:
    try:
        import playwright  # noqa: F401
    except ImportError:
        skip("Playwright is not installed (pip install playwright)")
    try:
        urllib.request.urlopen("https://httpbin.org/status/200", timeout=10).read()
    except Exception:
        skip("httpbin.org is not reachable (no internet)")


def main() -> None:
    preflight()
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bad = check_addresses() + asyncio.run(check_redirects())
    server.shutdown()
    if HITS:
        print("FAIL: the local server received requests:", HITS)
        bad += 1
    print("security checks:", "FAILED" if bad else "all passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
