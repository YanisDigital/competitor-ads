#!/usr/bin/env node
// A list of the ads of a snapshot as a file (CSV for Excel, or HTML cards), after curation.json, optionally narrowed by the
// type of the advertiser written there. For "give me a file with the ads, without the schools and the shops".
//
//   node export_ads.js <snapshot-folder> [--types "Type" ...] [--exclude-types "Type" ...] [--format csv|html] [--out file]
//
// Default: csv, <folder>/ads_list.csv (or .html). The same ad found in several snapshots counts once per id. Ad texts and page
// names are third-party data: in HTML they are escaped and links are http(s) only, in CSV a value starting with = + - @ is
// written as text. Nothing is downloaded.
const fs = require('fs');
const path = require('path');
const { classifyDoor } = require('./collector.js');
const { loadSnapshot } = require('./report.js');
const { esc, cleanUrl } = require('./export_html.js');

const argv = process.argv.slice(2);
const dir = argv[0];
const values = n => { const i = argv.indexOf(n); const out = []; if (i < 0) return out; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]); return out; };
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const key = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function selectAds(snap, types, exclude) {
  const typeOf = (snap.meta.curation && snap.meta.curation.types) || {};
  const want = new Set(types.map(key)), skip = new Set(exclude.map(key));
  return snap.rows.filter(r => {
    const t = key(typeOf[r.page]);
    return (!want.size || want.has(t)) && !skip.has(t);
  });
}

const iso = ts => (Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : '');
function toRecords(snap, ads) {
  const typeOf = (snap.meta.curation && snap.meta.curation.types) || {};
  return ads.map(r => ({
    page: r.page, type: typeOf[r.page] || '', id: r.id, url: 'https://www.facebook.com/ads/library/?id=' + r.id, start: iso(r.start), active: r.active === false || r.active === 'false' ? 'no' : 'yes',
    format: r.fmt || '', cta: r.cta || '', door: classifyDoor(r), site: cleanUrl(r.link), queries: (r.kws || []).join('; '), title: r.title || '', body: r.body || ''
  }));
}
const COLS = [['page', 'Page'], ['type', 'Type'], ['id', 'Ad id'], ['url', 'Ad link'], ['start', 'Start'], ['active', 'Active'], ['format', 'Format'], ['cta', 'Button'], ['door', 'Leads to'], ['site', 'Site'], ['queries', 'Found by queries'], ['title', 'Title'], ['body', 'Text']];

function csvOf(recs) {
  const cell = v => { let s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return '﻿' + [COLS.map(c => cell(c[1])).join(','), ...recs.map(r => COLS.map(c => cell(r[c[0]])).join(','))].join('\r\n') + '\r\n';
}

function htmlOf(recs, title) {
  const link = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  const cards = recs.map(r => `<article><header><b>${esc(r.page)}</b>${r.type ? `<span class="tag">${esc(r.type)}</span>` : ''}</header>
<p class="meta">${esc(r.start)} · ${esc(r.format)} · ${esc(r.door)}${r.cta ? ' · ' + esc(r.cta) : ''} · ${link(r.url, 'ad ' + r.id)}${r.site ? ' · ' + link(r.site, r.site) : ''}</p>
${r.title ? `<h3>${esc(r.title)}</h3>` : ''}<p>${esc(r.body)}</p></article>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:0 auto;padding:16px;color:#1c2330;background:#f6f7f9}article{background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:12px 14px;margin:10px 0}header{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.tag{border:1px solid #dfe3ea;border-radius:999px;padding:0 8px;font-size:.78rem}.meta{color:#5b6577;font-size:.85rem;margin:.3em 0}h3{margin:.4em 0;font-size:1rem}p{margin:.3em 0;overflow-wrap:anywhere;white-space:pre-line}a{color:#2456d6}</style></head><body><h1>${esc(title)}</h1><p class="meta">${recs.length} ads from ${new Set(recs.map(r => r.page)).size} advertisers</p>
${cards}</body></html>`;
}

module.exports = { selectAds, toRecords, csvOf, htmlOf };

if (require.main === module) {
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node export_ads.js <snapshot-folder> [--types "Type" ...] [--exclude-types "Type" ...] [--format csv|html] [--out file]');
    process.exit(2);
  }
  const format = flag('--format', 'csv');
  if (!['csv', 'html'].includes(format)) { console.error('--format must be csv or html'); process.exit(2); }
  const snap = loadSnapshot(dir);
  const known = new Set(Object.values((snap.meta.curation && snap.meta.curation.types) || {}).map(key));
  const unknown = [...values('--types'), ...values('--exclude-types')].filter(t => !known.has(key(t)));
  if (unknown.length) { console.error('Unknown type(s): ' + unknown.join(', ') + '. Types in curation.json: ' + ([...new Set(Object.values((snap.meta.curation && snap.meta.curation.types) || {}))].join(', ') || 'none')); process.exit(2); }
  const ads = selectAds(snap, values('--types'), values('--exclude-types'));
  const recs = toRecords(snap, ads);
  const out = flag('--out', path.join(dir, 'ads_list.' + format));
  fs.writeFileSync(out, format === 'csv' ? csvOf(recs) : htmlOf(recs, 'Ads: ' + (snap.meta.preset_title || path.basename(path.resolve(dir)))), 'utf8');
  console.log(`${recs.length} ads from ${new Set(recs.map(r => r.page)).size} advertisers. Saved: ${out}`);
}
