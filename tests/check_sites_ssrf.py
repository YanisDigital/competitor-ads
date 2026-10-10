#!/usr/bin/env python3
"""Network check of a plugin's check_sites.py against SSRF through redirects.

    python tests/check_sites_ssrf.py <scripts folder of a plugin>

A local server on 127.0.0.1 counts the requests it receives. Public pages that
redirect to it (and to a router, a cloud metadata address, a decimal IP, a chain
of redirects, a sub-resource and an iframe) must never reach it; a legitimate
redirect must still work. Uses the plugin's own guard_requests / safe_goto.
Exit codes: 0 passed, 1 failed, 77 skipped (no Playwright browser or no internet:
the redirects come from httpbin.org).
"""
import asyncio
import http.server
import sys
import threading
import urllib.request
from urllib.parse import quote

HITS = []
PORT = 8767
R = "https://httpbin.org/redirect-to?url="


def q(u: str) -> str:
    return R + quote(u, safe="")


def skip(why: str) -> None:
    print("skipped:", why)
    sys.exit(77)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        HITS.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"internal")

    def log_message(self, *a):
        pass


async def check(cs) -> int:
    from playwright.async_api import async_playwright
    bad = 0
    async with async_playwright() as pw:
        try:
            b = await pw.chromium.launch()
        except Exception as e:
            skip(f"cannot launch Chromium ({str(e)[:80]})")
        ctx = await b.new_context(java_script_enabled=False, accept_downloads=False)
        await ctx.route("**/*", cs.guard_requests)
        await ctx.route_web_socket("**", cs.refuse_websocket)
        pg = await ctx.new_page()
        must_block = {
            "redirect to 127.0.0.1": q(f"http://127.0.0.1:{PORT}/nav"),
            "redirect to a router": q("http://192.168.1.1/"),
            "redirect to the metadata address": q("http://169.254.169.254/latest/"),
            "redirect to a decimal IP": q(f"http://2130706433:{PORT}/nav"),
            "chain of redirects ending at 127.0.0.1": q(q(f"http://127.0.0.1:{PORT}/chain")),
            "credentials in the URL": "https://user:pw@example.com/",
        }
        for name, url in must_block.items():
            try:
                await cs.safe_goto(pg, url)
                print(f"FAIL {name}: opened {pg.url}")
                bad += 1
            except ValueError:
                pass
        try:
            await cs.safe_goto(pg, q("https://example.com/"))
            if "example.com" not in pg.url:
                print("FAIL legitimate redirect ended at", pg.url)
                bad += 1
        except Exception as e:
            print("FAIL legitimate redirect:", e)
            bad += 1
        await pg.set_content(f'<img src="{q(f"http://127.0.0.1:{PORT}/img")}"><iframe src="{q(f"http://127.0.0.1:{PORT}/iframe")}"></iframe>')
        await pg.wait_for_timeout(5000)
        await b.close()
    return bad


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python tests/check_sites_ssrf.py <plugin scripts folder>")
    sys.path.insert(0, sys.argv[1])
    try:
        import playwright  # noqa: F401
    except ImportError:
        skip("Playwright is not installed")
    try:
        urllib.request.urlopen("https://httpbin.org/status/200", timeout=10).read()
    except Exception:
        skip("httpbin.org is not reachable")
    import check_sites as cs
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bad = asyncio.run(check(cs))
    server.shutdown()
    if HITS:
        print("FAIL: the local server received", HITS)
        bad += 1
    print("ssrf check:", "FAILED" if bad else "all passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
