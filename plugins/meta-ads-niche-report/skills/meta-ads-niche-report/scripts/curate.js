#!/usr/bin/env node
// A reading list for cleaning a snapshot by meaning: every advertiser with its ad counts, the main door and
// site, the button and the start of the text, and what curation.json already says about it.
//
//   node curate.js list <snapshot-folder> [--undecided] [--min-ads N] [--limit N] [--json]
//
// Decide by reading the text, not by keywords; write the decision to curation.json:
//   { "criterion": "sells <the client's product>", "confirmed": false, "include": { "Page": "type" }, "exclude": ["Page"],
//     "disputed": { "Page": "why unclear" }, "context": { "Page": "substitute or supplier" }, "notes": "..." }
// Show the criterion and the list to the user; set "confirmed": true only on their word (the report warns until then).
// Nothing in `list` changes any file. `set` writes curation.json without hand-made scripts (a heredoc with Cyrillic and
// apostrophes breaks, a script rewrites the file badly):
//
//   node curate.js set <snapshot-folder> [--include "Page=Type" ...] [--exclude "Page" ...] [--disputed "Page=why" ...]
//        [--context "Page=why" ...] [--forget "Page" ...] [--criterion "sells <the client's product>"] [--note "text"]
//        [--confirm | --unconfirm]
//
// Page names are matched to ads.csv without case and extra spaces and written exactly as in ads.csv. A page gets one decision:
// a new one replaces the old. A name that matches no advertiser is reported and not written. --confirm sets "confirmed": true:
// do it only on the user's word, after they have seen the criterion and the list.
const fs = require('fs');
const path = require('path');
const { parseCsv, classifyDoor, domainOf } = require('./collector.js');
const pageKey = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

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

// Applies decisions to curation.json. ops: { include: [[page, type]], exclude: [page], disputed: [[page, why]], context: [[page, why]],
// forget: [page], criterion, note, confirm }. Returns { curation, not_found, changed }.
function setCuration(dir, ops = {}) {
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
  const names = new Map();
  for (const r of rows) if (!names.has(pageKey(r.page))) names.set(pageKey(r.page), r.page);
  const file = path.join(dir, 'curation.json');
  const cur = readJson(file) || {};
  const exclude = new Set(Array.isArray(cur.exclude) ? cur.exclude : []);
  const include = { ...(cur.include || {}) };
  const disputed = { ...(cur.disputed || {}) };
  const context = { ...(cur.context || {}) };
  const notFound = [];
  const resolve = n => { const real = names.get(pageKey(n)); if (!real) notFound.push(n); return real; };
  const drop = real => { exclude.delete(real); delete include[real]; delete disputed[real]; delete context[real]; };
  for (const [n, type] of ops.include || []) { const p = resolve(n); if (p) { drop(p); include[p] = type; } }
  for (const n of ops.exclude || []) { const p = resolve(n); if (p) { drop(p); exclude.add(p); } }
  for (const [n, why] of ops.disputed || []) { const p = resolve(n); if (p) { drop(p); disputed[p] = why; } }
  for (const [n, why] of ops.context || []) { const p = resolve(n); if (p) { drop(p); context[p] = why; } }
  for (const n of ops.forget || []) { const p = resolve(n); if (p) drop(p); }
  const out = { ...cur };
  if (ops.criterion !== undefined) out.criterion = ops.criterion;
  if (ops.note !== undefined) out.notes = ops.note;
  const set = (k, v, empty) => { if (empty) delete out[k]; else out[k] = v; };
  set('include', include, !Object.keys(include).length); // an empty whitelist would keep nobody: no key instead
  set('exclude', [...exclude], !exclude.size);
  set('disputed', disputed, !Object.keys(disputed).length);
  set('context', context, !Object.keys(context).length);
  if (ops.confirm !== undefined) out.confirmed = !!ops.confirm;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return { curation: out, not_found: notFound, file };
}

module.exports = { listAdvertisers, setCuration };

if (require.main === module) {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
  const values = n => { const i = rest.indexOf(n); const out = []; if (i < 0) return out; for (let j = i + 1; j < rest.length && !rest[j].startsWith('--'); j++) out.push(rest[j]); return out; };
  const pairs = n => values(n).map(v => { const k = v.lastIndexOf('='); return k > 0 ? [v.slice(0, k), v.slice(k + 1)] : [v, '']; });
  if (!['list', 'set'].includes(cmd) || !dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node curate.js list <snapshot-folder> [--undecided] [--min-ads N] [--limit N] [--json]\n       node curate.js set <snapshot-folder> [--include "Page=Type" ...] [--exclude "Page" ...] [--disputed "Page=why" ...] [--context "Page=why" ...] [--forget "Page" ...] [--criterion "..."] [--note "..."] [--confirm | --unconfirm]');
    process.exit(1);
  }
  if (cmd === 'set') {
    const res = setCuration(dir, {
      include: pairs('--include'), exclude: values('--exclude'), disputed: pairs('--disputed'), context: pairs('--context'), forget: values('--forget'),
      criterion: rest.includes('--criterion') ? flag('--criterion', '') : undefined, note: rest.includes('--note') ? flag('--note', '') : undefined,
      confirm: rest.includes('--confirm') ? true : rest.includes('--unconfirm') ? false : undefined
    });
    const c = res.curation;
    console.log(`Saved: ${res.file}\n  include ${Object.keys(c.include || {}).length}, exclude ${(c.exclude || []).length}, disputed ${Object.keys(c.disputed || {}).length}, context ${Object.keys(c.context || {}).length}; criterion: ${c.criterion || '-'}; confirmed: ${c.confirmed === true}`);
    if (res.not_found.length) { console.error('Not found among the advertisers (not written): ' + res.not_found.join(' | ')); process.exit(3); }
    process.exit(0);
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
