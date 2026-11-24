#!/usr/bin/env python3
"""The report of a snapshot as a PDF: everything the HTML report holds, laid out for A4 paper.

    python export_pdf.py out/<name>/<date> [--out report.pdf] [--lang ru|uk] [--landscape] [--no-images] [--with-budget]

A plain "print to PDF" of report.html used to lose part of it: wide tables were cut at their right edge (on screen they
scroll sideways) and closed blocks (hypotheses, site checks) were not printed. Here the HTML is built by export_html.js with
every block open (--expand), its print styles wrap every table cell to the page width, and Chromium (Playwright, the same
browser as the collection) prints it with page numbers. No network: the page has no external resources and every request
other than the file itself is refused; JavaScript is off.

Needs Node.js and Playwright with Chromium, like scrape.py. Nothing is installed by this script.
"""
import argparse
import asyncio
import html
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def build_html(folder: Path, out_html: Path, args) -> None:
    cmd = ["node", str(HERE / "export_html.js"), str(folder), "--expand", "--out", str(out_html), "--lang", args.lang]
    if args.no_images:
        cmd.append("--no-images")
    if args.with_budget:
        cmd.append("--with-budget")
    try:
        res = subprocess.run(cmd, capture_output=True, encoding="utf-8", timeout=300)
    except FileNotFoundError:
        sys.exit("Node.js is required (export_html.js builds the report).")
    if res.returncode != 0:
        sys.exit("export_html.js failed: " + (res.stderr or res.stdout).strip()[:400])


async def print_pdf(page_html: Path, out_pdf: Path, landscape: bool, title: str) -> int:
    from playwright.async_api import async_playwright  # lazy: argument errors do not need Playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            ctx = await browser.new_context(java_script_enabled=False, accept_downloads=False)

            async def only_the_file(route):
                url = route.request.url
                if url.startswith(("file:", "data:")):
                    await route.continue_()
                else:
                    await route.abort()

            await ctx.route("**/*", only_the_file)
            page = await ctx.new_page()
            await page.goto(page_html.as_uri(), wait_until="load")
            await page.emulate_media(media="print")
            footer = ('<div style="width:100%;font:8px Arial,sans-serif;color:#777;padding:0 10mm;display:flex;justify-content:space-between">'
                      f'<span>{html.escape(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')
            await page.pdf(path=str(out_pdf), format="A4", landscape=landscape, print_background=True, prefer_css_page_size=False,
                           display_header_footer=True, header_template="<div></div>", footer_template=footer,
                           margin={"top": "12mm", "bottom": "16mm", "left": "10mm", "right": "10mm"}, outline=True, tagged=True)
        finally:
            await browser.close()
    return out_pdf.stat().st_size


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Export a snapshot's report to PDF (everything in the HTML report, for A4).")
    ap.add_argument("folder", help="snapshot folder with ads.csv")
    ap.add_argument("--out", help="output .pdf (default: <folder>/report.pdf)")
    ap.add_argument("--lang", choices=("ru", "uk"), default="ru", help="language of the report's own text (ru by default)")
    ap.add_argument("--landscape", action="store_true", help="A4 landscape: wide tables get more room")
    ap.add_argument("--no-images", action="store_true", dest="no_images", help="without creative thumbnails and site screenshots (a lighter file to send)")
    ap.add_argument("--with-budget", action="store_true", dest="with_budget", help="include the test plan budget and the client's target CPA")
    args = ap.parse_args()
    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    out_pdf = Path(args.out) if args.out else folder / "report.pdf"
    try:
        import playwright  # noqa: F401
    except ImportError:
        sys.exit("Playwright is required (pip install playwright; python -m playwright install chromium); this script installs nothing.")
    with tempfile.TemporaryDirectory() as tmp:
        page_html = Path(tmp) / "report.html"
        build_html(folder, page_html, args)
        title = folder.resolve().parent.name + " · " + folder.resolve().name
        try:
            size = asyncio.run(print_pdf(page_html, out_pdf, args.landscape, title))
        except PermissionError:
            sys.exit(f"{out_pdf} is open in another program: close it or pass --out <other name>.")
    print(f"Saved: {out_pdf} ({round(size / 1024)} KB)")


if __name__ == "__main__":
    main()
