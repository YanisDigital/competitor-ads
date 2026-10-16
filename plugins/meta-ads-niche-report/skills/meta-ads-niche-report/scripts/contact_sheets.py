#!/usr/bin/env python3
"""Contact sheets and a labeling template for the creatives of a snapshot.

    python contact_sheets.py out/<name>/<date> [--tile 520]

Looking at 50+ pictures one by one is slow. This puts the downloaded creatives
(creatives/manifest.json, status ok) on sheets of 2 x 2 tiles with a caption
"#n id kind k/N" and the video storyboards two to a sheet, in creatives/sheets/,
and writes creatives.todo.json: every downloaded creative with the empty fields
of the vocabulary (names come from collector.js CREATIVE_TAGS, not from here).
Look at the sheets, fill the template, save it as creatives.json, then run
`node creatives.js lint <folder>`. Existing creatives.json is never touched.
Needs Pillow (the same as fetch_creatives.py); nothing is downloaded.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def tag_fields() -> dict:
    """{field: {carouselOnly, videoOnly}} from collector.js, the single source of the vocabulary."""
    code = "const t=require(process.argv[1]).CREATIVE_TAGS;console.log(JSON.stringify(Object.fromEntries(Object.entries(t).map(([k,v])=>[k,{carousel:!!v.carouselOnly,video:!!v.videoOnly}]))))"
    try:
        res = subprocess.run(["node", "-e", code, str(HERE / "collector.js")], capture_output=True, encoding="utf-8", timeout=60)
    except FileNotFoundError:
        sys.exit("Node.js is required (the vocabulary lives in collector.js).")
    if res.returncode != 0:
        sys.exit("Could not read the vocabulary: " + res.stderr.strip()[:300])
    return json.loads(res.stdout)


def sheet(images: list, captions: list, cols: int, tile_w: int, tile_h: int, dest: Path) -> None:
    from PIL import Image, ImageDraw

    rows = (len(images) + cols - 1) // cols
    cap_h = 22
    canvas = Image.new("RGB", (cols * tile_w, rows * (tile_h + cap_h)), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (path, cap) in enumerate(zip(images, captions)):
        x, y = (i % cols) * tile_w, (i // cols) * (tile_h + cap_h)
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                im.thumbnail((tile_w, tile_h))
                canvas.paste(im, (x + (tile_w - im.width) // 2, y + cap_h + (tile_h - im.height) // 2))
        except Exception:
            draw.text((x + 4, y + cap_h + 4), "unreadable", fill="red")
        draw.text((x + 4, y + 4), cap, fill="black")
    canvas.save(dest, "JPEG", quality=85)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Contact sheets and a labeling template for downloaded creatives.")
    ap.add_argument("folder", help="snapshot folder with creatives/manifest.json")
    ap.add_argument("--tile", type=int, default=520, help="tile width in pixels (default 520)")
    args = ap.parse_args()
    folder = Path(args.folder)
    manifest_path = folder / "creatives" / "manifest.json"
    if not manifest_path.exists():
        sys.exit("No creatives/manifest.json: run fetch_creatives.py first.")
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("Pillow is required for the sheets (pip install pillow); it is not installed here and nothing installs it for you.")
    items = [i for i in json.loads(manifest_path.read_text(encoding="utf-8")).get("items", []) if i.get("status") == "ok"]
    if not items:
        sys.exit("No downloaded creatives with status ok.")
    out = folder / "creatives" / "sheets"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.jpg"):
        old.unlink()

    pics, caps = [], []
    for n, it in enumerate(items, 1):
        files = it.get("files") or []
        if not files:
            continue
        for k, f in enumerate(files, 1):
            pics.append(folder / f)
            caps.append(f"#{n} {it['id']} {it.get('kind', '')} {k}/{len(files)}")
    tile_h = int(args.tile * 1.0)
    sheets = 0
    for s in range(0, len(pics), 4):
        sheets += 1
        sheet(pics[s:s + 4], caps[s:s + 4], 2, args.tile, tile_h, out / f"sheet-{sheets:02d}.jpg")
    boards = [(it, folder / it["video"]["storyboard"]) for it in items if isinstance(it.get("video"), dict) and it["video"].get("storyboard") and (folder / it["video"]["storyboard"]).exists()]
    vsheets = 0
    for s in range(0, len(boards), 2):
        vsheets += 1
        chunk = boards[s:s + 2]
        sheet([b for _, b in chunk], [f"video {it['id']}" for it, _ in chunk], 1, 1000, 520, out / f"video-{vsheets:02d}.jpg")

    fields = tag_fields()
    todo = []
    for it in items:
        is_carousel = it.get("kind") == "carousel"
        has_video = isinstance(it.get("video"), dict) and it["video"].get("status") == "ok"
        rec = {"id": it["id"]}
        for name, flags in fields.items():
            if flags["carousel"] and not is_carousel:
                continue
            if flags["video"] and not has_video:
                continue
            rec[name] = None
        rec["notes"] = ""
        todo.append(rec)
    todo_path = folder / "creatives.todo.json"
    todo_path.write_text(json.dumps(todo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{sheets} picture sheets and {vsheets} video sheets in {out}")
    print(f"Template with {len(todo)} creatives: {todo_path} (fill it, save as creatives.json, then: node creatives.js lint {folder})")


if __name__ == "__main__":
    main()
