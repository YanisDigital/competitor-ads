#!/usr/bin/env node
// Rebuilds the full report for a snapshot folder from its ads.csv with the
// collector's logic and the snapshot's niche settings: the preset named in
// run.json (presets/<id>.json) plus the folder's own niche.json. With a
// curation.json the report covers the kept advertisers / ads only. As a CLI
// it prints {report, meta, query_stats, warnings, visuals, next_steps} as
// JSON; as a module it exports loadSnapshot() and loadNicheConfig(). Used by
// export_xlsx.py, export_html.js and the other scripts, so exports always
// follow the current report logic.
//
//   node report.js out/fitness-pl/2026-10-09 [preset-id]
const fs = require('fs');
const path = require('path');
const C = require('./collector.js');

const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

function loadNicheConfig(dir, presetId) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const id = presetId || meta.preset;
  if (id && !/^[a-z0-9-]+$/.test(id)) throw new Error('Bad preset id: ' + id);
  const preset = id ? readJson(path.join(__dirname, '..', 'presets', id + '.json')) : null;
  const niche = readJson(path.join(dir, 'niche.json'));
  for (const [k, src] of Object.entries((niche && niche.extra_hooks) || {})) {
    try { new RegExp(src, 'u'); } catch (e) { throw new Error('niche.json: hook "' + k + '" is not a valid regular expression: ' + e.message); }
  }
  const config = preset || niche ? { ...(preset || {}), ...(niche || {}), extra_hooks: { ...((preset && preset.extra_hooks) || {}), ...((niche && niche.extra_hooks) || {}) } } : null;
  return { config, preset_id: preset ? id : null, niche_file: !!niche };
}

// opts0.now (unix seconds) pins "today" for the snapshot age in next_steps.
function loadSnapshot(dir, presetOverride, opts0 = {}) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const ts = meta.date ? Date.parse(meta.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;
  const niche = loadNicheConfig(dir, presetOverride);
  const preset = niche.config;
  // details.json (details.py): { ads: { id: fields from the ad's details page } }, merged over ads.csv.
  const det = readJson(path.join(dir, 'details.json'));
  const allRows = C.parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'))
    .map(r => (det && det.ads && det.ads[r.id] ? C.mergeDetails(r, det.ads[r.id]) : r));
  const source = meta.source || (allRows[0] && allRows[0].source) || 'library';
  // opts0.curation: another snapshot's curation (compare.js applies the older one to a newer snapshot without its own).
  const curation = opts0.curation !== undefined ? opts0.curation : readJson(path.join(dir, 'curation.json'));
  const cur = C.applyCuration(allRows, curation);
  const rows = cur.rows;
  const opts = { longDays: meta.long_days || 60, now: ts, country: meta.country || '', source };
  if (preset) {
    opts.extraHooks = preset.extra_hooks || {};
    opts.noise = preset.noise || [];
    if (preset.currency) opts.currency = preset.currency;
    if (preset.base_hooks === false) opts.baseHooks = false;
  }
  if (meta.cities && meta.cities.length) opts.cities = meta.cities;
  const stats = C.queryStats(allRows, rows, { queries: meta.queries, limited: meta.capped_queries, totals: meta.totals, curated: !!curation });
  const curationMeta = curation ? { curation: { excluded_ads: cur.excluded_ads, excluded_pages: cur.excluded_pages, kept_pages: new Set(rows.map(r => r.page)).size, types: cur.types, not_found: cur.not_found, notes: curation.notes || '' } } : {};
  const manifest = readJson(path.join(dir, 'creatives', 'manifest.json'));
  const visuals = manifest ? C.creativesSummary(rows, readJson(path.join(dir, 'creatives.json')), manifest, { longDays: opts.longDays, country: opts.country }) : null;
  const report = C.buildReport(rows, opts);
  // Details are counted per unique creative: copies of one video share them.
  const creatives = C.uniqueTexts(rows.filter(r => r.source === 'library')).uniqRows;
  const unchecked = creatives.filter(r => !r.details).length;
  const warnings = C.snapshotWarnings({ source, advertisers: report.advertisers, ads: report.ads, creatives: creatives.length, unchecked, queryStats: stats, ts, preset })
    .concat(visuals ? visuals.warnings : []);
  const has = f => fs.existsSync(path.join(dir, f));
  const now = opts0.now || Date.now() / 1000;
  const next_steps = C.nextSteps({
    source, curated: !!curation, unchecked, age_days: Math.max(0, (now - ts) / 86400),
    manifest: !!manifest, downloaded: visuals ? visuals.downloaded : 0, labeled: visuals ? visuals.labeled : 0,
    client: has('client.json') || fs.existsSync(path.join(path.dirname(path.resolve(dir)), 'client.json')),
    hypotheses: has('hypotheses.json'), lint: has('hypotheses_lint.json'), plan: has('test_plan.json'), sites: has('sites.json'), diff: has('diff.json'), preset: !!niche.preset_id, niche: niche.niche_file,
    cc_details: source === 'cc' && rows.some(r => r.details), library_country: C.isLibraryCountry(meta.country)
  });
  return { report, rows, query_stats: stats, warnings, visuals, next_steps,
    meta: { ...meta, source, ts, preset_title: preset && preset.title, niche_file: niche.niche_file, niche: preset, ...curationMeta } };
}

module.exports = { loadSnapshot, loadNicheConfig, readJson };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node report.js <snapshot-folder-with-ads.csv> [preset-id]');
    process.exit(1);
  }
  let snap;
  try {
    snap = loadSnapshot(dir, process.argv[3]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { report, meta, query_stats, warnings, visuals, next_steps } = snap;
  process.stdout.write(JSON.stringify({ report, meta, query_stats, warnings, visuals, next_steps }));
}
