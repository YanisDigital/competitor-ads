#!/usr/bin/env node
// Merges snapshot folders into one: the ads of every folder (one row per ad id; the later folder wins the
// fields, the queries that found an ad are joined), the queries of every run.json, and a fresh report.json.
//
//   node merge.js <out-folder> <folder> [more folders...] [--force]
//
// If <out-folder> already holds a snapshot it is the first source, so `node merge.js out/x out/x/_batch2`
// adds a batch to a snapshot. The folders must be comparable (same country, status, language, media, sort,
// search type and dates) unless --force. curation.json and niche.json are copied from the first folder that
// has one when <out-folder> has none. The blocked / queries_remaining state is the last folder's, so a
// complete last batch clears the state of an earlier partial one.
const fs = require('fs');
const path = require('path');
const { parseCsv, toCsv, buildReport } = require('./collector.js');

const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const SAME = ['country', 'status', 'language', 'media', 'sort', 'search_type', 'date_from', 'date_to'];
const STATE = ['blocked', 'queries_planned', 'queries_remaining'];
const uniq = a => [...new Set(a)];

function mergeSlices(outDir, srcDirs, opts = {}) {
  const sources = uniq([...(fs.existsSync(path.join(outDir, 'ads.csv')) ? [outDir] : []), ...srcDirs].map(d => path.resolve(d)));
  if (sources.length < 1) throw new Error('Nothing to merge: no folder with ads.csv.');
  for (const d of sources) if (!fs.existsSync(path.join(d, 'ads.csv'))) throw new Error('No ads.csv in ' + d);
  const metas = sources.map(d => readJson(path.join(d, 'run.json')) || {});
  if (!opts.force) {
    for (const k of SAME) {
      const vals = uniq(metas.map(m => JSON.stringify(m[k] === undefined ? null : m[k])));
      if (vals.length > 1) throw new Error(`The slices are not comparable: "${k}" differs (${vals.join(' vs ')}). Use --force to merge anyway.`);
    }
  }
  const byId = new Map();
  for (const d of sources) {
    for (const r of parseCsv(fs.readFileSync(path.join(d, 'ads.csv'), 'utf8'))) {
      const old = byId.get(r.id);
      byId.set(r.id, old ? { ...old, ...r, kws: uniq([...(old.kws || []), ...(r.kws || [])]) } : r);
    }
  }
  const rows = [...byId.values()];
  const last = metas[metas.length - 1];
  const merged = { ...metas[0] };
  merged.date = metas.map(m => m.date).filter(Boolean).sort().pop() || merged.date;
  merged.queries = uniq(metas.flatMap(m => m.queries || []));
  merged.rate_limited_queries = uniq(metas.flatMap(m => m.rate_limited_queries || []));
  for (const k of STATE) delete merged[k];
  for (const k of STATE) if (last[k] !== undefined) merged[k] = last[k];
  merged.merged_from = sources.map(d => path.relative(process.cwd(), d) || '.');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ads.csv'), toCsv(rows), 'utf8');
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(merged, null, 2), 'utf8');
  const now = merged.date ? Date.parse(merged.date) / 1000 : Date.now() / 1000;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(buildReport(rows, { longDays: 90, now }), null, 2), 'utf8');
  for (const f of ['curation.json', 'niche.json']) {
    if (fs.existsSync(path.join(outDir, f))) continue;
    const src = sources.find(d => fs.existsSync(path.join(d, f)));
    if (src) fs.copyFileSync(path.join(src, f), path.join(outDir, f));
  }
  return { rows: rows.length, sources: sources.length, queries: merged.queries.length, advertisers: new Set(rows.map(r => r.page)).size };
}

module.exports = { mergeSlices };

if (require.main === module) {
  const args = process.argv.slice(2).filter(a => a !== '--force');
  const force = process.argv.includes('--force');
  if (args.length < 2) {
    console.error('Usage: node merge.js <out-folder> <folder> [more folders...] [--force]');
    process.exit(1);
  }
  try {
    const r = mergeSlices(args[0], args.slice(1), { force });
    console.log(`Merged ${r.sources} folders into ${args[0]}: ${r.rows} ads, ${r.advertisers} advertisers, ${r.queries} queries.`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
