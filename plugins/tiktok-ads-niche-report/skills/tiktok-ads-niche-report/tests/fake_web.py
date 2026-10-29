"""A tiny pretend Internet for the SSRF checks of check_sites.py: no network, no httpbin.org.

Hosts ending in ".test" look public to the guard (their name resolves to a public address) and are answered here:
  https://redirector.test/redirect-to?url=<target>   302 to <target>, like httpbin's /redirect-to
  https://example.test/                              a page
Any other host is answered by the real network (the local server of the check, 127.0.0.1): a guard that wrongly
follows a redirect would reach it, and the request counter of the check sees it.

    import fake_web as fw
    fw.install()                                  # names ending in .test resolve to a public address
    await ctx.route("**/*", fw.wrap(cs.guard_requests))
"""
import socket
from urllib.parse import parse_qs, quote, urlparse

PUBLIC_IP = "93.184.216.34"  # a globally routable address; nothing is ever sent to it
REDIRECTOR = "https://redirector.test/redirect-to?url="
_real_getaddrinfo = socket.getaddrinfo


def q(url: str) -> str:
    return REDIRECTOR + quote(url, safe="")


def install() -> None:
    def fake(host, *a, **k):
        if isinstance(host, str) and host.endswith(".test"):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLIC_IP, 0))]
        return _real_getaddrinfo(host, *a, **k)

    socket.getaddrinfo = fake


class FakeResponse:
    def __init__(self, status: int, headers: dict, body: bytes = b""):
        self.status, self.headers, self.body = status, headers, body


class FakeRoute:
    """Passes everything to the real route, but answers the .test hosts itself (as route.fetch would)."""

    def __init__(self, route):
        self._r = route

    def __getattr__(self, name):
        return getattr(self._r, name)

    async def fetch(self, **kw):
        u = urlparse(self._r.request.url)
        if u.hostname == "redirector.test":
            target = parse_qs(u.query).get("url", [""])[0]
            return FakeResponse(302, {"location": target})
        if u.hostname == "example.test":
            return FakeResponse(200, {"content-type": "text/html"}, b"<h1>example</h1>")
        return await self._r.fetch(**kw)

    async def fulfill(self, **kw):
        resp = kw.get("response")
        if isinstance(resp, FakeResponse):
            await self._r.fulfill(status=resp.status, headers={"content-type": "text/html"}, body=resp.body)
        else:
            await self._r.fulfill(**kw)


def wrap(handler):
    async def run(route):
        await handler(FakeRoute(route))

    return run
