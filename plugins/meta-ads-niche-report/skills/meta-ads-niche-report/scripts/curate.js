#!/usr/bin/env node
// A reading list for cleaning a snapshot by meaning: every advertiser with its ad counts, the main door and
// site, the button and the start of the text, and what curation.json already says about it.
//
//   node curate.js list <snapshot-folder> [--undecided] [--min-ads N] [--limit N] [--json]
//
// Decide by reading the text, not by keywords; write the decision to curation.json:
//   { "include": { "Page": "type" }, "exclude": ["Page"], "disputed": { "Page": "why unclear" }, "notes": "..." }
// Nothing here changes any file.
const fs = require('fs');
const path = require('path');
const { parseCsv, classifyDoor, domainOf } = require('./collector.js');

const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const top = arr => {
  const c = {};
  for (const x of arr.filter(Boolean)) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
};

function listAdvertisers(dir) {
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
  const run = readJson(path.join(dir, 'run.json')) || {};
  const cur = readJson(path.join(dir, 'curation.json'));
  const now = (run.date ? Date.parse(run.date) : Date.now()) / 1000;
  const include = (cur && cur.include) || null;
  const exclude = new Set((cur && cur.exclude) || []);
  const disputed = (cur && cur.disputed) || {};
  const types = (cur && cur.types) || {};
  const pages = new Map();
  for (const r of rows) (pages.get(r.page) || pages.set(r.page, []).get(r.page)).push(r);
  const out = [...pages].map(([page, ads]) => {
    const live = ads.filter(a => !(a.active === false || a.active === 'false'));
    const sample = [...ads].sort((a, b) => a.start - b.start)[0];
    let status = '';
    if (page in disputed) status = 'спорный: ' + (typeof disputed[page] === 'string' ? disputed[page] : disputed[page].why || '');
    else if (exclude.has(page)) status = 'исключён';
    else if (include && page in include) status = 'конкурент: ' + include[page];
    else if (page in types) status = 'тип: ' + types[page];
    else if (include) status = 'не включён (белый список)';
    return {
      page, ads: ads.length, active: live.length, oldest_days: live.length ? Math.round((now - Math.min(...live.map(a => a.start))) / 86400) : null,
      door: top(ads.map(classifyDoor)), site: top(ads.map(a => domainOf(a.link || ''))), cta: top(ads.map(a => a.cta)),
      text: ((sample.title ? sample.title + ' | ' : '') + (sample.body || '')).replace(/\s+/g, ' ').slice(0, 110),
      decided: page in disputed || exclude.has(page) || (include ? page in include : false) || page in types, status
    };
  });
  return out.sort((a, b) => b.ads - a.ads || a.page.localeCompare(b.page));
}

module.exports = { listAdvertisers };

if (require.main === module) {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
  if (cmd !== 'list' || !dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node curate.js list <snapshot-folder> [--undecided] [--min-ads N] [--limit N] [--json]');
    process.exit(1);
  }
  let list = listAdvertisers(dir);
  const total = list.length;
  if (rest.includes('--undecided')) list = list.filter(x => !x.decided);
  const min = +flag('--min-ads', 1);
  list = list.filter(x => x.ads >= min);
  const limit = +flag('--limit', 60);
  const shown = list.slice(0, limit);
  if (rest.includes('--json')) {
    process.stdout.write(JSON.stringify({ total, matching: list.length, advertisers: shown }));
  } else {
    console.log(`${total} advertisers, ${list.length} match, showing ${shown.length}. Format: ads/active | page | door | site | button | start of the text | decision`);
    shown.forEach((x, i) => console.log(`${i + 1}. ${x.ads}/${x.active} | ${x.page} | ${x.door} | ${x.site || '-'} | ${x.cta || '-'} | ${x.text} | ${x.status || '-'}`));
    if (list.length > shown.length) console.log(`... and ${list.length - shown.length} more (--limit N, --min-ads N).`);
  }
}
