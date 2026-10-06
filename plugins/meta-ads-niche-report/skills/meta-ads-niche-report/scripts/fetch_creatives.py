#!/usr/bin/env python3
"""Download the pictures of a snapshot's creatives for analysis.

    python fetch_creatives.py out/<name>/<date> [--limit 60] [--per-advertiser 3] [--delay 0.5]

Which creatives: collector.js decides (creatives.js select: running ads of the
advertisers that count after curation.json, long-running first, advertisers
take turns, each picture once); a carousel brings up to 5 cards, a video its
preview frame. This script only downloads them, one at a time with a pause,
and only from Meta's image CDN over https (*.fbcdn.net, *.cdninstagram.com),
images only, at most 8 MB each. Meta signs these links and they expire within
days, so run this right after collecting (scrape.py --creatives does it).

Result: <folder>/creatives/<id>-<n>.jpg, small copies in creatives/thumbs/ (with
Pillow; without it the original file is kept and there are no thumbnails) and
creatives/manifest.json (status per creative: ok, duplicate, expired, blocked,
too_big, error). Then Claude looks at the pictures and writes creatives.json;
`node creatives.js lint <folder>` checks it, report.js, Excel and HTML pick it up.
Nothing here logs in or works around any protection.
"""
import argparse
import hashlib
import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).parent
ALLOWED_SUFFIXES = (".fbcdn.net", ".cdninstagram.com")
MAX_BYTES = 8 * 1024 * 1024
MAX_LIMIT = 100
DEFAULT_LIMIT = 60
MAX_CARDS = 5
MIN_DELAY = 0.2
TIMEOUT = 20
FULL_SIDE, THUMB_SIDE = 1080, 320
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
USER_AGENT = "meta-ads-niche-report (creative analysis)"


class FetchError(Exception):
    """A picture that could not be taken; .status goes into the manifest."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def is_allowed_url(url: str) -> bool:
    """https on Meta's image CDN only: no other host, no port, no credentials in the link."""
    try:
        x = urlparse(url or "")
        port = x.port
    except ValueError:
        return False
    host = (x.hostname or "").lower()
    return x.scheme == "https" and port in (None, 443) and not x.username and host.endswith(ALLOWED_SUFFIXES)


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_allowed_url(newurl):
            raise FetchError("blocked")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str) -> tuple[bytes, str]:
    """(bytes, content type) of one picture, or FetchError."""
    if not is_allowed_url(url):
        raise FetchError("blocked")
    opener = urllib.request.build_opener(_CheckedRedirects)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            ctype = resp.headers.get_content_type()
            if ctype not in EXT:
                raise FetchError("blocked")
            if int(resp.headers.get("Content-Length") or 0) > MAX_BYTES:
                raise FetchError("too_big")
            data = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise FetchError("expired" if e.code in (403, 404, 410) else "error") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise FetchError("error") from None
    if len(data) > MAX_BYTES:
        raise FetchError("too_big")
    return data, ctype


def save_image(data: bytes, ctype: str, folder: Path, name: str) -> tuple[str, str | None]:
    """Writes the picture (and a thumbnail when Pillow is there); returns their paths relative to the snapshot folder."""
    cdir, tdir = folder / "creatives", folder / "creatives" / "thumbs"
    try:
        from PIL import Image
    except ImportError:
        (cdir / (name + EXT[ctype])).write_bytes(data)
        return f"creatives/{name}{EXT[ctype]}", None
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        img = img.convert("RGB")
    except Exception:  # not a picture after all, or a decompression bomb
        raise FetchError("error") from None
    full = img.copy()
    full.thumbnail((FULL_SIDE, FULL_SIDE))
    full.save(cdir / f"{name}.jpg", "JPEG", quality=85)
    img.thumbnail((THUMB_SIDE, THUMB_SIDE))
    img.save(tdir / f"{name}.jpg", "JPEG", quality=80)
    return f"creatives/{name}.jpg", f"creatives/thumbs/{name}.jpg"


def write_manifest(folder: Path, items: list) -> dict:
    manifest = {"date": datetime.now(timezone.utc).isoformat(), "note": "Meta's links expire within days; the files here stay.", "items": items}
    (folder / "creatives" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def fetch_all(items: list, folder: Path, fetch=download, sleep=time.sleep, delay: float = 0.5, log=lambda s: None) -> dict:
    """Downloads every selected creative; the same picture twice becomes a 'duplicate' of the first."""
    (folder / "creatives" / "thumbs").mkdir(parents=True, exist_ok=True)
    old_path = folder / "creatives" / "manifest.json"
    old = {i["id"]: i for i in json.loads(old_path.read_text(encoding="utf-8")).get("items", [])} if old_path.exists() else {}
    seen, out = {}, []
    for k, item in enumerate(items, 1):
        prev = old.get(item["id"])
        if prev and prev.get("status") == "ok" and prev.get("files") and all((folder / f).exists() for f in prev["files"]):
            out.append(prev)  # already downloaded on an earlier run
            if prev.get("sha256"):
                seen.setdefault(prev["sha256"], item["id"])
            continue
        rec = {"id": item["id"], "page": item.get("page", ""), "kind": item.get("kind", "image"), "fmt": item.get("fmt", ""),
               "status": "", "files": [], "thumbs": [], "errors": []}
        for n, url in enumerate(item.get("urls", [])[:MAX_CARDS], 1):
            if not is_allowed_url(url):
                rec["errors"].append("blocked")
                continue
            try:
                data, ctype = fetch(url)
                if not rec["files"]:
                    sha = hashlib.sha256(data).hexdigest()
                    if sha in seen:
                        rec.update(status="duplicate", dup_of=seen[sha])
                        break
                    rec["sha256"] = sha
                file_rel, thumb_rel = save_image(data, ctype, folder, f"{item['id']}-{n}")
                rec["files"].append(file_rel)
                if thumb_rel:
                    rec["thumbs"].append(thumb_rel)
            except FetchError as e:
                rec["errors"].append(e.status)
            finally:
                sleep(delay)
        if not rec["status"]:
            rec["status"] = "ok" if rec["files"] else (rec["errors"][0] if rec["errors"] else "error")
        if rec["status"] == "ok":
            seen[rec["sha256"]] = item["id"]
        out.append(rec)
        log(f"[{k}/{len(items)}] {item['id']} {rec['status']}" + (f" ({len(rec['files'])} files)" if rec["files"] else ""))
        write_manifest(folder, out)  # keep what is downloaded so far
    return write_manifest(folder, out)


def select(folder: Path, limit: int, per_advertiser: int) -> list:
    try:
        res = subprocess.run(["node", str(HERE / "creatives.js"), "select", str(folder), "--limit", str(limit), "--per-advertiser", str(per_advertiser)],
                             capture_output=True, encoding="utf-8", timeout=120)
    except FileNotFoundError:
        sys.exit("Node.js is required (collector.js picks the creatives).")
    if res.returncode != 0:
        sys.exit("Could not pick the creatives: " + (res.stderr or res.stdout).strip()[:300])
    print(res.stdout.strip())
    return json.loads((folder / "creatives" / "selection.json").read_text(encoding="utf-8"))["items"]


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # page names on a cp1252 console
    ap = argparse.ArgumentParser(description="Download the pictures of a snapshot's creatives (Meta CDN only) for analysis.")
    ap.add_argument("folder", help="snapshot folder with ads.csv")
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"how many creatives (default {DEFAULT_LIMIT}, cap {MAX_LIMIT})")
    ap.add_argument("--per-advertiser", type=int, default=3, dest="per_advertiser", help="at most this many per advertiser (default 3)")
    ap.add_argument("--delay", type=float, default=0.5, help=f"seconds between downloads (default 0.5, minimum {MIN_DELAY:g})")
    args = ap.parse_args()
    if not 1 <= args.limit <= MAX_LIMIT:
        sys.exit(f"--limit must be between 1 and {MAX_LIMIT}.")
    if args.per_advertiser < 1:
        sys.exit("--per-advertiser must be at least 1.")
    if args.delay < MIN_DELAY:
        sys.exit(f"--delay below {MIN_DELAY:g} seconds is not allowed.")
    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    items = select(folder, args.limit, args.per_advertiser)
    if not items:
        sys.exit("Nothing to download: no running ads with picture links (a snapshot collected before v0.13.4 has none; collect it again).")
    manifest = fetch_all(items, folder, delay=args.delay, log=print)
    count = lambda s: sum(1 for i in manifest["items"] if i["status"] == s)
    print(f"Downloaded {count('ok')}, duplicates {count('duplicate')}, expired links {count('expired')}, "
          f"refused {count('blocked') + count('too_big')}, failed {count('error')}.")
    if count("expired") and not count("ok"):
        print("All links have expired: collect the snapshot again and run this right after.")
    print(f"Saved: {folder / 'creatives' / 'manifest.json'}")
    print("Next: look at the pictures, write creatives.json (references/creatives.md), then: node creatives.js lint " + str(folder))


if __name__ == "__main__":
    main()
