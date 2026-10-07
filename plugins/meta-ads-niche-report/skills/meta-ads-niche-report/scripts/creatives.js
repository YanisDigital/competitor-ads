#!/usr/bin/env node
// Creative analysis of a snapshot folder, the parts that need no network.
//
//   node creatives.js select <folder> [--limit 60] [--per-advertiser 3] [--videos 0] [--top-advertisers 0]
//     Picks which pictures to look at (collector.js selectCreatives, curation.json
//     applied; --top-advertisers N keeps the N advertisers with the most ads, the
//     leaders) and writes <folder>/creatives/selection.json; --videos N marks the
//     first N video creatives to be cut into frames. fetch_creatives.py calls
//     this and then downloads the pictures (and the marked videos).
//   node creatives.js lint <folder>
//     Checks <folder>/creatives.json (the tags Claude wrote after looking at the
//     pictures) against the vocabulary and creatives/manifest.json, writes
//     <folder>/creatives_lint.json and exits 1 if there are errors.
const fs = require('fs');
const path = require('path');
const { selectCreatives, lintCreatives, CREATIVE_TAGS } = require('./collector.js');
const { loadSnapshot } = require('./report.js');

const MAX_LIMIT = 100;
const MAX_VIDEOS = 30;
const [cmd, dir, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? Number(rest[i + 1]) : def; };
const usage = () => {
  console.error('Usage: node creatives.js select <snapshot-folder> [--limit 60] [--per-advertiser 3] [--videos 0] [--top-advertisers 0]\n       node creatives.js lint <snapshot-folder>');
  process.exit(2);
};
if (!['select', 'lint'].includes(cmd) || !dir || !fs.existsSync(path.join(dir, 'ads.csv'))) usage();

if (cmd === 'select') {
  const limit = flag('--limit', 60), perAdvertiser = flag('--per-advertiser', 3), videos = flag('--videos', 0), topAdvertisers = flag('--top-advertisers', 0);
  if (!(limit >= 1 && limit <= MAX_LIMIT) || !(perAdvertiser >= 1) || !(videos >= 0 && videos <= MAX_VIDEOS) || !(topAdvertisers >= 0)) {
    console.error(`--limit must be between 1 and ${MAX_LIMIT}, --per-advertiser at least 1, --videos between 0 and ${MAX_VIDEOS}, --top-advertisers 0 (all) or more.`);
    process.exit(2);
  }
  const snap = loadSnapshot(dir);
  const items = selectCreatives(snap.rows, { limit, perAdvertiser, topAdvertisers, now: snap.meta.ts });
  // The first `videos` video creatives, in selection order (long-running first), are cut into frames.
  let left = videos;
  for (const it of items) if (it.video_url && left > 0) { it.want_video = true; left--; }
  fs.mkdirSync(path.join(dir, 'creatives'), { recursive: true });
  const out = path.join(dir, 'creatives', 'selection.json');
  fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), limit, per_advertiser: perAdvertiser, items }, null, 2), 'utf8');
  const pages = new Set(items.map(i => i.page)).size;
  const hasLinks = snap.rows.some(r => r.image_url);
  console.log(`Selected ${items.length} creatives from ${pages} advertisers (${items.filter(i => i.long_running).length} long-running, ${items.filter(i => i.kind === 'carousel').length} carousels, ${items.filter(i => i.want_video).length} videos to cut into frames).`);
  if (!hasLinks) console.log('This snapshot has no picture links (collected before v0.13.4): collect it again to analyse creatives.');
  console.log('Saved: ' + out);
}

if (cmd === 'lint') {
  const read = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const manifest = read(path.join(dir, 'creatives', 'manifest.json'));
  const labels = read(path.join(dir, 'creatives.json'));
  if (!manifest) { console.error('No creatives/manifest.json: run fetch_creatives.py first.'); process.exit(2); }
  if (!labels) { console.error('No creatives.json: label the downloaded pictures first. Fields: ' + Object.keys(CREATIVE_TAGS).join(', ') + ', notes.'); process.exit(2); }
  const res = lintCreatives(labels, manifest);
  const out = path.join(dir, 'creatives_lint.json');
  fs.writeFileSync(out, JSON.stringify(res, null, 2), 'utf8');
  console.log(`${res.errors} errors, ${res.warnings} warnings`);
  for (const x of res.findings.filter(x => x.severity !== 'info')) console.log(`  [${x.severity}] ${x.id} ${x.code} (${x.field}): ${x.message}`);
  const unl = res.findings.filter(x => x.code === 'unlabeled').length;
  if (unl) console.log(`  ${unl} downloaded creatives are not labeled yet.`);
  console.log('Saved: ' + out);
  process.exit(res.errors ? 1 : 0);
}
