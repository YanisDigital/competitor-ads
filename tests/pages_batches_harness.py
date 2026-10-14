"""Runs scrape.run_in_batches() with a fake batch runner (no browser, no network) but the real node merge.js.

    python pages_batches_harness.py <scripts dir> <csv file> <out dir> <scenario>

csv file: ads of the pages "Page 01" ... "Page 35" (page column). Scenarios:
  ok      three batches (15 + 15 + 5), two pauses
  resume  the second batch is stopped by a captcha after 3 pages; then the same command runs again and finishes
Prints one JSON line."""
import csv
import json
import sys
import types
from pathlib import Path

SCRIPTS, CSV_FILE, OUT, SCENARIO = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, SCRIPTS)
import scrape  # noqa: E402

csv.field_size_limit(10**8)
with open(CSV_FILE, encoding="utf-8", newline="") as fh:
    reader = csv.DictReader(fh)
    HEAD = reader.fieldnames
    ALL = list(reader)
PAGES = [{"page_id": str(1000 + i), "name": f"Page {i:02d}"} for i in range(1, 36)]
SRC = "out/source"
state = {"calls": 0, "block_at_call": 2 if SCENARIO == "resume" else 0, "armed": SCENARIO == "resume"}


def fake_batch(args, tmp: Path, names_file: Path) -> int:
    state["calls"] += 1
    names = json.loads(Path(names_file).read_text(encoding="utf-8"))
    blocked = state["armed"] and state["calls"] == state["block_at_call"]
    got = names[:3] if blocked else names
    tmp.mkdir(parents=True, exist_ok=True)
    with open(tmp / "ads.csv", "w", encoding="utf-8", newline="") as fh:
        fh.write(",".join(HEAD) + "\n")  # the header of toCsv() is not quoted, its rows are
        w = csv.DictWriter(fh, fieldnames=HEAD, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writerows([r for r in ALL if r["page"] in got])
    run = {"date": "2026-10-13T10:00:00+00:00", "country": "US", "queries": [f"page: {n}" for n in got], "pages_of": SRC, "rate_limited_queries": [],
           "search_type": "any_words", "status": "active"}
    if blocked:
        run.update({"blocked": "Meta showed a captcha/checkpoint.", "queries_planned": len(names), "queries_remaining": [f"page: {n}" for n in names[3:]]})
    (tmp / "run.json").write_text(json.dumps(run), encoding="utf-8")
    return 3 if blocked else 0


args = types.SimpleNamespace(out=OUT, pages_of=SRC, batch_pause=30.0, creatives=False)
if SCENARIO == "foreign":  # the folder already holds another snapshot
    Path(OUT).mkdir(parents=True, exist_ok=True)
    (Path(OUT) / "ads.csv").write_text("id\n", encoding="utf-8")
    (Path(OUT) / "run.json").write_text(json.dumps({"queries": ["keyword"], "country": "US"}), encoding="utf-8")
    rc = scrape.run_in_batches(args, PAGES, run_batch=fake_batch, sleep=lambda s: None)
    print(json.dumps({"rc": [rc], "calls": state["calls"], "kept": (Path(OUT) / "ads.csv").read_text(encoding="utf-8")}))
    raise SystemExit(0)
sleeps = []
first = scrape.run_in_batches(args, PAGES, run_batch=fake_batch, sleep=sleeps.append)
result = {"rc": [first]}
if SCENARIO == "resume":
    result["after_first"] = json.loads((Path(OUT) / "run.json").read_text(encoding="utf-8"))
    state["armed"] = False
    second = scrape.run_in_batches(args, PAGES, run_batch=fake_batch, sleep=sleeps.append)
    result["rc"].append(second)
run = json.loads((Path(OUT) / "run.json").read_text(encoding="utf-8"))
with open(Path(OUT) / "ads.csv", encoding="utf-8", newline="") as fh:
    ads = list(csv.DictReader(fh))
result.update({"queries": len(run["queries"]), "ads": len(ads), "pages": len({r["page"] for r in ads}), "state": [k for k in ("blocked", "queries_remaining", "queries_planned") if k in run],
               "sleeps": sleeps, "calls": state["calls"], "leftovers": sorted(p.name for p in Path(OUT).glob("_batch*"))})
print(json.dumps(result))
