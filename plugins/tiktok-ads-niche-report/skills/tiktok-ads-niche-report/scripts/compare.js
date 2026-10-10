#!/usr/bin/env node
// Compares two snapshots of the same niche and writes diff.json into the
// newer one. Logic lives in collector.js (diffSnapshots); this file finds the
// folders, reads them (ads.csv + details.json + curation.json, through
// report.js) and prints a summary.
//
//   node compare.js out/fitness-pl              # two latest snapshots inside
//   node compare.js out/a out/b                 # two explicit folders (older, newer)
//
// Comparable only with the same source, country and queries (same --preset or
// --keywords); otherwise "gone from the results" says little.
const fs = require('fs');
const path = require('path');
const { diffSnapshots } = require('./collector.js');
const { loadSnapshot, loadNicheConfig } = require('./report.js');

const args = process.argv.slice(2);
const hasSnapshot = dir => fs.existsSync(path.join(dir, 'ads.csv'));
const runOf = dir => { const f = path.join(dir, 'run.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const tsOf = dir => { const m = runOf(dir); return m.date ? Date.parse(m.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000; };

let older, newer;
if (args.length === 1 && !hasSnapshot(args[0])) {
  const snaps = fs.readdirSync(args[0], { withFileTypes: true })
    .filter(d => d.isDirectory() && hasSnapshot(path.join(args[0], d.name)))
    .map(d => path.join(args[0], d.name)).sort((a, b) => tsOf(a) - tsOf(b));
  if (snaps.length < 2) { console.error(`Need at least 2 snapshots in ${args[0]}, found ${snaps.length}. Repeat the same run in 2–4 weeks.`); process.exit(1); }
  [older, newer] = snaps.slice(-2);
} else if (args.length === 2) {
  [older, newer] = args;
} else {
  console.error('Usage: node compare.js <niche-folder-with-snapshots>  |  node compare.js <older> <newer>');
  process.exit(1);
}
for (const d of [older, newer]) if (!hasSnapshot(d)) { console.error('No ads.csv in ' + d); process.exit(1); }
const [ra, rb] = [runOf(older), runOf(newer)];
const [tsA, tsB] = [tsOf(older), tsOf(newer)];
if (tsB <= tsA) { console.error('The second folder must be the newer snapshot.'); process.exit(1); }
if ((ra.source || 'library') !== (rb.source || 'library') || (ra.country && rb.country && ra.country !== rb.country)) {
  console.error('The snapshots differ in source or country: nothing to compare.');
  process.exit(1);
}
if (ra.queries && rb.queries) {
  const shared = ra.queries.filter(q => rb.queries.includes(q));
  if (shared.length < Math.max(ra.queries.length, rb.queries.length)) console.log(`Note: only ${shared.length} of ${ra.queries.length}/${rb.queries.length} queries are the same; "gone from the results" is confident only for ads of shared, uncut queries.`);
}

const curOf = dir => (fs.existsSync(path.join(dir, 'curation.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'curation.json'), 'utf8')) : null);
let curB = curOf(newer);
if (!curB && curOf(older)) {
  curB = curOf(older);
  console.log('Note: the newer snapshot has no curation.json; the older one is applied to both (copy it there and review new advertisers).');
}
const A = loadSnapshot(older), B = loadSnapshot(newer, undefined, { curation: curB }); // details.json of each folder applied
const preset = loadNicheConfig(newer).config || {};
const d = diffSnapshots(A.rows, B.rows, {
  prevTs: tsA, currTs: tsB, source: rb.source || 'library', country: rb.country,
  cappedPrev: ra.capped_queries, cappedCurr: rb.capped_queries,
  hookOpts: { extraHooks: preset.extra_hooks || {}, baseHooks: preset.base_hooks === false ? false : undefined }
});
d.older = older; d.newer = newer;
// Advertisers of the newer snapshot that no curation names yet: with an "include"
// whitelist they are left out of the comparison, so list them for review.
if (curB) {
  const named = new Set([...Object.keys(curB.include || {}), ...(curB.exclude || []), ...Object.keys(curB.types || {})]);
  const raw = loadSnapshot(newer, undefined, { curation: null }).rows;
  const seenBefore = new Set(loadSnapshot(older, undefined, { curation: null }).rows.map(r => r.page)); // reviewed at the first curation
  const counts = {};
  for (const r of raw) if (r.page && !named.has(r.page) && !seenBefore.has(r.page)) counts[r.page] = (counts[r.page] || 0) + 1;
  d.unreviewed_pages = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([page, ads]) => ({ page, ads, example: (raw.find(r => r.page === page).title || '').slice(0, 120) }));
}
const out = path.join(newer, 'diff.json');
fs.writeFileSync(out, JSON.stringify(d, null, 2), 'utf8');

console.log(`Compared ${older} -> ${newer} (${d.interval_days} days)`);
if (d.source === 'cc') {
  console.log(`Top ads: ${d.prev_ads} -> ${d.curr_ads}; stayed ${d.kept}, entered ${d.entered.count}, dropped out of the collected part ${d.dropped.count}.`);
  console.log('Hooks more common among new top ads: ' + (d.dynamics.hooks_new_vs_dropped.map(h => h.hook).join(', ') || 'none'));
} else {
  console.log(`Ads: ${d.prev_ads} -> ${d.curr_ads}; unique creatives: ${d.prev_creatives} -> ${d.curr_creatives}. New creatives: ${d.new_creatives.count}.`);
  console.log(`Stopped (last show older than 7 days, seen in the newer list): ${d.stops.confirmed_ads} ads, ${d.stops.stopped_creatives.length} creatives. Gone from the results: ${d.stops.missing_ads} ads (${d.stops.missing_high_confidence} confidently).`);
  if (d.young_tests.creatives) console.log(`Young tests (creatives < 30 days old at the first snapshot): ${d.young_tests.gone} of ${d.young_tests.creatives} stopped or gone.`);
  console.log(`Scaling (2+ more copies): ${d.scaling.length}. New advertisers: ${d.pages.new.length}. Advertisers that stopped: ${d.pages.gone.length}; dropped out of the results (not sure they stopped): ${d.pages.missing.length}.`);
  const dy = d.dynamics;
  console.log(dy.failed_hooks_enough_data ? 'Hooks over-represented among stopped young tests: ' + (dy.failed_hooks.map(h => h.hook + ' (' + h.strength + ')').join(', ') || 'none') : 'Failed-test hooks: too few young tests to say anything (need 12+, 4+ stopped).');
}
if ((d.unreviewed_pages || []).length) console.log(`New advertisers not reviewed yet (not in curation.json and absent from the older snapshot; left out if curation is a whitelist): ${d.unreviewed_pages.length} advertisers, e.g. ` + d.unreviewed_pages.slice(0, 5).map(p => p.page).join(', '));
console.log('Saved: ' + out);
