#!/usr/bin/env python3
"""Download a TikTok snapshot's creatives (covers and videos) for analysis.

    python fetch_creatives.py out/<name>/<date> [--limit 30] [--per-advertiser 3] [--delay 0.5] [--videos 15]

Which creatives: collector.js decides (creatives.js select: ads of the
advertisers that count after curation.json; per advertiser the longest-running
(Ad Library) or best-CTR (Creative Center) first, advertisers take turns, each
video once). This script only downloads them, one at a time with a pause, and
only from TikTok's media hosts over https (*.tiktokcdn.com, *.tiktokcdn-eu.com,
*.tiktokcdn-us.com, *.ibyteimg.com, *.byteimg.com and the Ad Library's own
media proxy library.tiktok.com/api/v1/cdn/), at most 8 MB per picture. TikTok
signs these links and they expire within hours to days: run this right after
collecting and curating.

Result: <folder>/creatives/<id>-<n>.jpg, small copies in creatives/thumbs/ (with
Pillow; without it the original file is kept and there are no thumbnails) and
creatives/manifest.json (status per creative: ok, duplicate, expired, blocked,
too_big, error).

With --videos N the first N video creatives are also downloaded (mp4, up to
60 MB, same CDN rule) and cut into frames by headless Chromium (Playwright,
no ffmpeg): the hook seconds 0-3, the quarters and the end (videoFramePlan in
collector.js), saved in creatives/frames/ with a 4 x 2 storyboard
creatives/<id>-story.jpg; the video file is deleted afterwards. The manifest
gets item['video'] (status ok, expired, blocked, too_big, undecodable, error;
duration, size, orientation, frames, storyboard). Then Claude looks at the pictures and writes creatives.json;
`node creatives.js lint <folder>` checks it, report.js, Excel and HTML pick it up.
Nothing here logs in or works around any protection.
"""
import argparse
import base64
import hashlib
import io
import json
import re
import subprocess
import warnings
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).parent
ALLOWED_SUFFIXES = (".tiktokcdn.com", ".tiktokcdn-eu.com", ".tiktokcdn-us.com", ".ibyteimg.com", ".byteimg.com")
LIBRARY_PROXY = ("library.tiktok.com", "/api/v1/cdn/")  # the Ad Library serves its videos through this path
MAX_BYTES = 8 * 1024 * 1024
MAX_LIMIT = 100
DEFAULT_LIMIT = 30
MAX_CARDS = 5
MIN_DELAY = 0.2
TIMEOUT = 20
FULL_SIDE, THUMB_SIDE = 1080, 320
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
IMAGE_FORMATS = ["JPEG", "PNG", "WEBP", "GIF"]
MAX_PIXELS = 40_000_000  # far above any ad picture (1080 x 1920 is 2 Mpx)
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
MAX_VIDEO_BYTES = 60 * 1024 * 1024
MAX_VIDEOS = 30
VIDEO_TIMEOUT = 90
FRAME_SIDE = 720  # longest side of a saved frame
STORY_THUMB_SIDE = 480
FRAMES_ORIGIN = "http://frames.local"  # the extractor page's own made-up origin; nothing goes to the network
USER_AGENT = "tiktok-ads-niche-report (creative analysis)"


class FetchError(Exception):
    """A picture that could not be taken; .status goes into the manifest."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def is_ad_id(value) -> bool:
    """Ad ids from the Library are numbers; the id becomes a file name, so nothing else is accepted (no '../')."""
    return isinstance(value, str) and re.fullmatch(r"\d{1,25}", value) is not None


def content_length(value) -> int:
    """Content-Length as a number; a missing or malformed header counts as unknown (0), it must not stop the run."""
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def is_allowed_url(url: str) -> bool:
    """https on TikTok's media hosts only: no other host, no port, no credentials in the link."""
    try:
        x = urlparse(url or "")
        port = x.port
    except ValueError:
        return False
    host = (x.hostname or "").lower()
    ok_host = host.endswith(ALLOWED_SUFFIXES) or (host == LIBRARY_PROXY[0] and x.path.startswith(LIBRARY_PROXY[1]))
    return x.scheme == "https" and port in (None, 443) and not x.username and ok_host


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_allowed_url(newurl):
            raise FetchError("blocked")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, kinds: dict = EXT, max_bytes: int = MAX_BYTES) -> tuple[bytes, str]:
    """(bytes, content type) of one picture (or, with VIDEO_TYPES, one video), or FetchError."""
    if not is_allowed_url(url):
        raise FetchError("blocked")
    opener = urllib.request.build_opener(_CheckedRedirects)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(req, timeout=TIMEOUT if kinds is EXT else VIDEO_TIMEOUT) as resp:
            ctype = resp.headers.get_content_type()
            if ctype not in kinds:
                raise FetchError("blocked")
            if content_length(resp.headers.get("Content-Length")) > max_bytes:
                raise FetchError("too_big")
            data = resp.read(max_bytes + 1)
    except urllib.error.HTTPError as e:
        raise FetchError("expired" if e.code in (403, 404, 410) else "error") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise FetchError("error") from None
    if len(data) > max_bytes:
        raise FetchError("too_big")
    return data, ctype


# Runs in the extractor page: plays the clip from a blob (same origin, so the
# canvas may be read and seeking works), takes the frames collector.js plans.
EXTRACT_JS = """async (maxSide) => {
  const blob = await (await fetch('/clip')).blob();
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true;
  v.src = URL.createObjectURL(blob);
  const wait = (ev, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms);
    v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); rej(new Error('decode')); }, { once: true });
  });
  await wait('loadeddata', 20000);
  let d = v.duration;
  if (!Number.isFinite(d)) { // some webm files learn their length only after a seek to the end
    const s = wait('seeked', 10000); v.currentTime = 1e7; await s;
    d = Number.isFinite(v.duration) ? v.duration : v.currentTime;
  }
  const plan = window.__tti.videoFramePlan(d);
  const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
  const x = c.getContext('2d');
  const frames = [];
  for (const p of plan) {
    if (Math.abs(v.currentTime - p.t) > 0.01) { const s = wait('seeked', 10000); v.currentTime = p.t; await s; }
    x.drawImage(v, 0, 0, c.width, c.height);
    frames.push({ t: p.t, label: p.label, data: c.toDataURL('image/jpeg', 0.85) });
  }
  URL.revokeObjectURL(v.src);
  return { duration: d, width: v.videoWidth, height: v.videoHeight, aspect: window.__tti.aspectOf(v.videoWidth, v.videoHeight), frames };
}"""


class FrameExtractor:
    """Cuts a local video file into frames with headless Chromium (Playwright): no
    ffmpeg needed. One browser for all videos; the page reaches nothing but the clip."""

    def __enter__(self):
        from playwright.sync_api import sync_playwright  # lazy: only needed for videos
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._context = self._browser.new_context()
        self._context.add_init_script(path=str(HERE / "collector.js"))  # frame plan and orientation stay in collector.js
        self._context.route("**/*", self._serve)
        self._clip = None
        return self

    def _serve(self, route) -> None:
        url = route.request.url
        if not url.startswith(FRAMES_ORIGIN):
            route.abort()  # the extractor page goes nowhere else
        elif url == FRAMES_ORIGIN + "/clip" and self._clip:
            route.fulfill(path=str(self._clip), content_type="application/octet-stream")
        else:
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>frames</title>")

    def __call__(self, path: Path) -> dict:
        self._clip = path
        page = self._context.new_page()
        try:
            page.goto(FRAMES_ORIGIN + "/")
            out = page.evaluate(EXTRACT_JS, FRAME_SIDE)
        except Exception:
            raise FetchError("undecodable") from None
        finally:
            page.close()
            self._clip = None
        frames = [{"t": f["t"], "label": f["label"], "jpeg": base64.b64decode(f["data"].split(",", 1)[1])} for f in out["frames"]]
        return {"duration": out["duration"], "width": out["width"], "height": out["height"], "aspect": out.get("aspect", ""), "frames": frames}

    def __exit__(self, *exc):
        self._browser.close()
        self._pw.stop()


def make_storyboard(frames: list, dest: Path, thumb: Path) -> bool:
    """4 x 2 grid of the frames with their time under each; False without Pillow."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    imgs = [Image.open(io.BytesIO(f["jpeg"])).convert("RGB") for f in frames]
    cw = 270
    ch = max(round(cw * im.height / max(1, im.width)) for im in imgs)
    cols, bar = 4, 22
    rows = (len(imgs) + cols - 1) // cols
    board = Image.new("RGB", (cols * cw, rows * (ch + bar)), "white")
    draw = ImageDraw.Draw(board)
    for k, (im, f) in enumerate(zip(imgs, frames)):
        x, y = (k % cols) * cw, (k // cols) * (ch + bar)
        im.thumbnail((cw, ch))
        board.paste(im, (x + (cw - im.width) // 2, y))
        draw.rectangle([x, y + ch, x + cw, y + ch + bar], fill="black")
        draw.text((x + 6, y + ch + 5), f"{f['label']}  ({f['t']:.1f} s)", fill="yellow")
    board.save(dest, "JPEG", quality=85)
    small = board.copy()
    small.thumbnail((STORY_THUMB_SIDE, STORY_THUMB_SIDE))
    small.save(thumb, "JPEG", quality=80)
    return True


def save_frames(out: dict, folder: Path, ad_id: str) -> dict:
    fdir = folder / "creatives" / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    frames = []
    for n, f in enumerate(out["frames"], 1):
        (fdir / f"{ad_id}-f{n}.jpg").write_bytes(f["jpeg"])
        frames.append({"t": f["t"], "label": f["label"], "file": f"creatives/frames/{ad_id}-f{n}.jpg"})
    board, thumb = f"creatives/{ad_id}-story.jpg", f"creatives/thumbs/{ad_id}-story.jpg"
    made = make_storyboard(out["frames"], folder / board, folder / thumb) if out["frames"] else False
    return {"status": "ok", "duration": round(float(out["duration"]), 2), "width": out["width"], "height": out["height"], "aspect": out.get("aspect", ""),
            "frames": frames, "storyboard": board if made else "", "storyboard_thumb": thumb if made else ""}


def fetch_videos(items: list, folder: Path, fetch=download, extract=None, sleep=time.sleep, delay: float = 0.5, log=lambda s: None) -> list:
    """Downloads the videos marked want_video, cuts each into frames and a storyboard
    and deletes the video file; the result goes into item['video']."""
    targets = [i for i in items if i.get("want_video") and i.get("status") == "ok"]
    if not targets:
        return items
    (folder / "creatives" / "thumbs").mkdir(parents=True, exist_ok=True)
    own = extract is None
    cm = FrameExtractor() if own else None
    ex = cm.__enter__() if own else extract
    try:
        for k, it in enumerate(targets, 1):
            prev = it.get("video") or {}
            if prev.get("status") == "ok" and prev.get("storyboard") and (folder / prev["storyboard"]).exists():
                continue  # cut on an earlier run
            url = it.get("video_url", "")
            if not is_allowed_url(url) or not is_ad_id(it.get("id")):
                it["video"] = {"status": "blocked"}
                continue
            clip = folder / "creatives" / f"{it['id']}.mp4"
            try:
                data, _ = fetch(url, VIDEO_TYPES, MAX_VIDEO_BYTES)
                clip.write_bytes(data)
                it["video"] = save_frames(ex(clip), folder, it["id"])
            except FetchError as e:
                it["video"] = {"status": e.status}
            finally:
                clip.unlink(missing_ok=True)  # keep the frames, not the video
                sleep(delay)
            v = it["video"]
            log(f"[video {k}/{len(targets)}] {it['id']} {v['status']}" + (f" ({v['duration']} s, {len(v['frames'])} frames)" if v["status"] == "ok" else ""))
    finally:
        if own:
            cm.__exit__(None, None, None)
    return items


def save_image(data: bytes, ctype: str, folder: Path, name: str) -> tuple[str, str | None]:
    """Writes the picture (and a thumbnail when Pillow is there); returns their paths relative to the snapshot folder."""
    cdir, tdir = folder / "creatives", folder / "creatives" / "thumbs"
    try:
        from PIL import Image
    except ImportError:
        (cdir / (name + EXT[ctype])).write_bytes(data)
        return f"creatives/{name}{EXT[ctype]}", None
    # A small file can still decode into a huge picture: refuse anything above MAX_PIXELS
    # (Pillow on its own only warns up to twice its 89 Mpx limit), and only the four web
    # formats are parsed, whatever else the bytes claim to be.
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=IMAGE_FORMATS)
            img.load()
            img = img.convert("RGB")
    except Exception:  # not a picture after all, another format, or a decompression bomb
        raise FetchError("error") from None
    full = img.copy()
    full.thumbnail((FULL_SIDE, FULL_SIDE))
    full.save(cdir / f"{name}.jpg", "JPEG", quality=85)
    img.thumbnail((THUMB_SIDE, THUMB_SIDE))
    img.save(tdir / f"{name}.jpg", "JPEG", quality=80)
    return f"creatives/{name}.jpg", f"creatives/thumbs/{name}.jpg"


def write_manifest(folder: Path, items: list) -> dict:
    manifest = {"date": datetime.now(timezone.utc).isoformat(), "note": "TikTok's links expire within hours to days; the files here stay.", "items": items}
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
        video_keys = {k: item[k] for k in ("want_video", "video_url") if k in item}
        if prev and prev.get("status") == "ok" and prev.get("files") and all((folder / f).exists() for f in prev["files"]):
            prev.update(video_keys)
            out.append(prev)  # already downloaded on an earlier run
            if prev.get("sha256"):
                seen.setdefault(prev["sha256"], item["id"])
            continue
        rec = {"id": item["id"], "page": item.get("page", ""), "kind": item.get("kind", "image"), "fmt": item.get("fmt", ""),
               "status": "", "files": [], "thumbs": [], "errors": [], **video_keys}
        if not is_ad_id(item["id"]):  # the id names the files: only plain numbers
            rec["status"] = "blocked"
            out.append(rec)
            continue
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


def select(folder: Path, limit: int, per_advertiser: int, videos: int = 0, top_advertisers: int = 0) -> list:
    try:
        res = subprocess.run(["node", str(HERE / "creatives.js"), "select", str(folder), "--limit", str(limit), "--per-advertiser", str(per_advertiser),
                              "--videos", str(videos), "--top-advertisers", str(top_advertisers)],
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
    ap = argparse.ArgumentParser(description="Download a TikTok snapshot's creatives (TikTok media hosts only) for analysis.")
    ap.add_argument("folder", help="snapshot folder with ads.csv")
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"how many creatives (default {DEFAULT_LIMIT}, cap {MAX_LIMIT})")
    ap.add_argument("--per-advertiser", type=int, default=3, dest="per_advertiser", help="at most this many per advertiser (default 3)")
    ap.add_argument("--delay", type=float, default=0.5, help=f"seconds between downloads (default 0.5, minimum {MIN_DELAY:g})")
    ap.add_argument("--videos", type=int, default=15, help=f"cut this many videos into frames (default 15, cap {MAX_VIDEOS}; needs Playwright)")
    ap.add_argument("--top-advertisers", type=int, default=0, dest="top_advertisers", help="only the N advertisers with the most ads, the leaders (default 0 = all); the usual run uses 10 with --limit 30 --videos 15")
    args = ap.parse_args()
    if args.top_advertisers < 0:
        sys.exit("--top-advertisers must be 0 (all) or more.")
    if not 1 <= args.limit <= MAX_LIMIT:
        sys.exit(f"--limit must be between 1 and {MAX_LIMIT}.")
    if not 0 <= args.videos <= MAX_VIDEOS:
        sys.exit(f"--videos must be between 0 and {MAX_VIDEOS}.")
    if args.per_advertiser < 1:
        sys.exit("--per-advertiser must be at least 1.")
    if args.delay < MIN_DELAY:
        sys.exit(f"--delay below {MIN_DELAY:g} seconds is not allowed.")
    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    items = select(folder, args.limit, args.per_advertiser, args.videos, args.top_advertisers)
    if not items:
        sys.exit("Nothing to download: no ads with media links in this snapshot.")
    manifest = fetch_all(items, folder, delay=args.delay, log=print)
    count = lambda s: sum(1 for i in manifest["items"] if i["status"] == s)
    print(f"Downloaded {count('ok')}, duplicates {count('duplicate')}, expired links {count('expired')}, "
          f"refused {count('blocked') + count('too_big')}, failed {count('error')}.")
    if args.videos:
        try:
            fetch_videos(manifest["items"], folder, delay=args.delay, log=print)
        except ImportError:
            print("Videos skipped: Playwright is not installed (pip install playwright; python -m playwright install chromium).")
        manifest = write_manifest(folder, manifest["items"])
        vids = [i["video"] for i in manifest["items"] if i.get("video")]
        print(f"Videos cut into frames: {sum(1 for v in vids if v['status'] == 'ok')} of {len(vids)}"
              + (f" (failed: {', '.join(sorted({v['status'] for v in vids if v['status'] != 'ok'}))})" if any(v["status"] != "ok" for v in vids) else "") + ".")
    if count("expired") and not count("ok"):
        print("All links have expired: collect the snapshot again and run this right after.")
    print(f"Saved: {folder / 'creatives' / 'manifest.json'}")
    print("Next: look at the storyboards, write creatives.json (references/creatives.md), then: node scripts/creatives.js lint " + str(folder))


if __name__ == "__main__":
    main()
