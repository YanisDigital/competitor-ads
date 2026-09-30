#!/usr/bin/env node
// Compares two scrape.py output folders (older, newer) and writes diff.json
// into the newer one. Logic lives in collector.js (diffSnapshots); this file
// only reads the folders and prints a summary.
//
//   node compare.js out/week1 out/week2 [--cap 90]
//
// Run both snapshots with the same queries (same --preset/--keywords) or the
// comparison covers only the queries present in both.
const fs = require('fs');
const path = require('path');
const { parseCsv, diffSnapshots } = require('./collector.js');

const args = process.argv.slice(2);
const capIdx = args.indexOf('--cap');
const cap = capIdx >= 0 ? +args.splice(capIdx, 2)[1] : 90;
if (args.length !== 2) {
  console.error('Usage: node compare.js <older-dir> <newer-dir> [--cap N]');
  process.exit(1);
}

function load(dir) {
  const csv = path.join(dir, 'ads.csv');
  if (!fs.existsSync(csv)) { console.error('No ads.csv in ' + dir); process.exit(1); }
  const metaPath = path.join(dir, 'run.json');
  const ts = fs.existsSync(metaPath)
    ? Date.parse(JSON.parse(fs.readFileSync(metaPath, 'utf8')).date) / 1000
    : fs.statSync(csv).mtimeMs / 1000;
  return { rows: parseCsv(fs.readFileSync(csv, 'utf8')), ts };
}

const [a, b] = [load(args[0]), load(args[1])];
if (b.ts <= a.ts) { console.error('The second folder must be the newer snapshot.'); process.exit(1); }
const d = diffSnapshots(a.rows, b.rows, { prevTs: a.ts, currTs: b.ts, cap });
const out = path.join(args[1], 'diff.json');
fs.writeFileSync(out, JSON.stringify(d, null, 2), 'utf8');

console.log(`Interval: ${d.interval_days} days. Ads: ${d.prev_ads} -> ${d.curr_ads}. Survived: ${d.survived}.`);
console.log(`New ads: ${d.new_ads.count}. Stopped: ${d.stopped.count} (${d.stopped.high_confidence} high confidence, the rest may just have dropped out of the top of the results).`);
if (d.young_tests.ads) console.log(`Young tests (<30 days old at the first snapshot): ${d.young_tests.gone} of ${d.young_tests.ads} are gone (${Math.round(d.young_tests.gone_share * 100)}%).`);
console.log(`Scaling (more creative variants): ${d.scaling.length}. New pages: ${d.pages.new.length}. Pages gone: ${d.pages.gone.length}. Pages that grew by 3+ ads: ${d.pages.grew.length}.`);
console.log('Saved: ' + out);
