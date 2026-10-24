#!/usr/bin/env node
// Checks the hooks of a snapshot's niche.json (and the preset it names) on the snapshot's own ads, so a wrong hook is seen at once
// instead of after the report: how many ads and advertisers each hook catches, an example, and what looks wrong.
//
//   node niche_check.js <snapshot-folder> [--json]
//
// Looks for: a hook that catches nothing (a typo, or a word the niche does not use), a hook that catches over 70% of the ads (too
// broad to tell anything), \b next to Cyrillic (JavaScript's \b knows only Latin letters: "\bспа\b" never matches), a regular
// expression that is not valid JSON-escaped text (\d must be written \\d in JSON), and a hook whose words are the search
// queries themselves (circular: it will be found everywhere). The text is matched lowercased, like the report does.
const fs = require('fs');
const path = require('path');
const { loadSnapshot, loadNicheConfig } = require('./report.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
  console.error('Usage: node niche_check.js <snapshot-folder> [--json]');
  process.exit(2);
}
const json = process.argv.includes('--json');

function check(dirPath) {
  const nicheFile = path.join(dirPath, 'niche.json');
  let rawNiche = null;
  if (fs.existsSync(nicheFile)) {
    const txt = fs.readFileSync(nicheFile, 'utf8');
    try { rawNiche = JSON.parse(txt); } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const around = m ? txt.slice(Math.max(0, +m[1] - 30), +m[1] + 30).replace(/\s+/g, ' ') : '';
      return { fatal: 'niche.json is not valid JSON: ' + e.message + (around ? ' (near: ' + around + '). A backslash in a regular expression is written twice in JSON: \\\\d, \\\\S.' : '') };
    }
  }
  const snap = loadSnapshot(dirPath);
  const cfg = loadNicheConfig(dirPath).config || {};
  const rows = snap.rows;
  const text = r => ((r.title || '') + ' ' + (r.body || '')).toLowerCase();
  const kws = [...new Set(rows.flatMap(r => r.kws || []))].map(k => k.toLowerCase());
  const out = [];
  for (const [name, src] of Object.entries(cfg.extra_hooks || {})) {
    const issues = [];
    let re = null;
    try { re = new RegExp(src); } catch (e) { issues.push('not a valid regular expression: ' + e.message); }
    if (/\\b/.test(src) && /[а-яіїєґё]/i.test(src)) issues.push('\\b with Cyrillic: JavaScript word boundaries know only Latin letters, so it never matches next to a Cyrillic letter. Use (^|[^а-яіїєґё]) before and ([^а-яіїєґё]|$) after.');
    if (/[А-ЯІЇЄҐ]/.test(src)) issues.push('capital Cyrillic letters in the pattern: the text is lowercased before matching, write the pattern in lowercase.');
    let ads = 0, advertisers = 0, example = '';
    if (re) {
      const m = rows.filter(r => re.test(text(r)));
      ads = m.length; advertisers = new Set(m.map(r => r.page)).size;
      if (m[0]) { const t = text(m[0]); const k = t.search(re); example = (k > 40 ? '…' : '') + t.slice(Math.max(0, k - 40), k + 80).replace(/\s+/g, ' '); }
      if (!ads) issues.push('catches no ad of this snapshot: a typo, or the niche does not say it');
      else if (rows.length >= 10 && ads / rows.length > 0.7) issues.push('catches ' + Math.round(100 * ads / rows.length) + '% of the ads: too broad to tell anything');
      if (kws.some(k => re.test(k))) issues.push('its words are in your own search queries: circular, it will be found everywhere');
    }
    out.push({ hook: name, source: 'niche', ads, advertisers, example, issues });
  }
  const base = Object.entries(snap.report.hook_freq || {}).map(([hook, ads]) => ({ hook, source: 'base/preset', ads, advertisers: null, example: '', issues: [] }));
  return { total_ads: rows.length, total_advertisers: snap.report.advertisers, niche_json: !!rawNiche, hooks: out, base };
}

const res = check(dir);
if (json) { process.stdout.write(JSON.stringify(res)); process.exit(res.fatal || res.hooks.some(h => h.issues.length) ? 1 : 0); }
if (res.fatal) { console.error(res.fatal); process.exit(1); }
console.log(`${res.total_ads} ads from ${res.total_advertisers} advertisers; niche.json: ${res.niche_json ? 'yes' : 'no'}`);
let bad = 0;
for (const h of res.hooks) {
  console.log(`\n${h.issues.length ? '!' : ' '} ${h.hook}: ${h.ads} ads, ${h.advertisers} advertisers${h.example ? '\n    e.g. ' + h.example : ''}`);
  for (const i of h.issues) { console.log('    - ' + i); bad++; }
}
if (!res.hooks.length) console.log('\nNo niche hooks (extra_hooks) in niche.json or the preset.');
console.log('\nBase and preset hooks (ads): ' + res.base.filter(b => b.ads > 0).map(b => `${b.hook} ${b.ads}`).join(', '));
process.exit(bad ? 1 : 0);
