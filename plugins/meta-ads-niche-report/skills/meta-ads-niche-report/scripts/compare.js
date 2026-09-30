#!/usr/bin/env node
// Compares two scrape.py snapshots and writes diff.json into the newer one.
// Logic lives in collector.js (diffSnapshots); this file only finds the
// folders, reads them and prints a summary.
//
//   node compare.js out/ecom-dropship-us            # two latest snapshots inside
//   node compare.js out/week1 out/week2 [--cap 90]  # two explicit folders
//
// Snapshots should use the same queries (same --preset / --keywords);
// otherwise few stops can be called confident.
const fs = require('fs');
const path = require('path');
const { parseCsv, diffSnapshots } = require('./collector.js');

const args = process.argv.slice(2);
const capIdx = args.indexOf('--cap');
const cap = capIdx >= 0 ? +args.splice(capIdx, 2)[1] : 90;

function tsOf(dir) {
  const meta = path.join(dir, 'run.json');
  if (fs.existsSync(meta)) return Date.parse(JSON.parse(fs.readFileSync(meta, 'utf8')).date) / 1000;
  return fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;
}
const hasSnapshot = dir => fs.existsSync(path.join(dir, 'ads.csv'));

let older, newer;
if (args.length === 1 && !hasSnapshot(args[0])) {
  const snaps = fs.readdirSync(args[0], { withFileTypes: true })
    .filter(d => d.isDirectory() && hasSnapshot(path.join(args[0], d.name)))
    .map(d => path.join(args[0], d.name))
    .sort((a, b) => tsOf(a) - tsOf(b));
  if (snaps.length < 2) { console.error(`Need at least 2 snapshots in ${args[0]}, found ${snaps.length}.`); process.exit(1); }
  [older, newer] = snaps.slice(-2);
} else if (args.length === 2) {
  [older, newer] = args;
} else {
  console.error('Usage: node compare.js <folder-with-snapshots>  |  node compare.js <older> <newer>  [--cap N]');
  process.exit(1);
}
for (const d of [older, newer]) if (!hasSnapshot(d)) { console.error('No ads.csv in ' + d); process.exit(1); }

const [tsA, tsB] = [tsOf(older), tsOf(newer)];
if (tsB <= tsA) { console.error('The second folder must be the newer snapshot.'); process.exit(1); }

const queries = d => {
  const m = path.join(d, 'run.json');
  return fs.existsSync(m) ? JSON.parse(fs.readFileSync(m, 'utf8')).queries || null : null;
};
const [qa, qb] = [queries(older), queries(newer)];
if (qa && qb) {
  const shared = qa.filter(q => qb.includes(q));
  if (shared.length < Math.max(qa.length, qb.length)) console.log(`Note: only ${shared.length} of ${qa.length}/${qb.length} queries are the same in both snapshots; stops can be confirmed only for those.`);
}

const d = diffSnapshots(parseCsv(fs.readFileSync(path.join(older, 'ads.csv'), 'utf8')), parseCsv(fs.readFileSync(path.join(newer, 'ads.csv'), 'utf8')), { prevTs: tsA, currTs: tsB, cap });
const out = path.join(newer, 'diff.json');
fs.writeFileSync(out, JSON.stringify(d, null, 2), 'utf8');

console.log(`Compared ${older} -> ${newer}`);
console.log(`Interval: ${d.interval_days} days. Ads: ${d.prev_ads} -> ${d.curr_ads}. Survived: ${d.survived}.`);
console.log(`New ads: ${d.new_ads.count}. Stopped: ${d.stopped.count} (${d.stopped.high_confidence} high confidence, the rest may just have dropped out of the top of the results).`);
if (d.young_tests.ads) console.log(`Young tests (<30 days old at the first snapshot): ${d.young_tests.gone} of ${d.young_tests.ads} are gone (${Math.round(d.young_tests.gone_share * 100)}%).`);
console.log(`Scaling (more creative variants): ${d.scaling.length}. New pages: ${d.pages.new.length}. Pages gone: ${d.pages.gone.length}. Pages that grew by 3+ ads: ${d.pages.grew.length}.`);
console.log('Saved: ' + out);
