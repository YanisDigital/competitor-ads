#!/usr/bin/env node
// Rebuilds the full report for a snapshot folder from its ads.csv, using the
// same code as the collector (collector.js) and the snapshot's niche settings:
// the preset (run.json -> presets/<id>.json) and, on top of it, the folder's own
// niche.json (hooks, noise words, currency... for a niche without a preset). If
// the folder has a curation.json (hand-made list of advertisers to keep or drop,
// see applyCuration in collector.js) the report is built from the kept
// advertisers only. As a CLI it prints
// {report, doors, meta, query_stats, warnings, eu, visuals, next_steps} as
// JSON to stdout; as a module it exports loadSnapshot() and loadNicheConfig().
// Used by export_xlsx.py and export_html.js so exports always reflect the
// current report logic, even for folders scraped with an older version.
//
//   node report.js out/ecom-dropship-us/2026-09-30 [preset-id]
const fs = require('fs');
const path = require('path');
const { parseCsv, buildReport, classifyDoor, applyCuration, queryStats, snapshotWarnings, nextSteps, currencyForCountry, euSummary, creativesSummary, isEuCountry } = require('./collector.js');

const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

// The niche settings of a snapshot: the preset named in run.json (or presetId),
// then the folder's niche.json on top of it (its extra_hooks are added to the
// preset's, its other fields win). config is null when there is neither.
// Every hook must be a valid regular expression; a broken one names itself.
function loadNicheConfig(dir, presetId) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const id = presetId || meta.preset;
  const preset = id ? readJson(path.join(__dirname, '..', 'presets', id + '.json')) : null;
  const niche = readJson(path.join(dir, 'niche.json'));
  for (const [k, src] of Object.entries((niche && niche.extra_hooks) || {})) {
    try { new RegExp(src); } catch (e) { throw new Error('niche.json: hook "' + k + '" is not a valid regular expression: ' + e.message); }
  }
  const config = preset || niche ? { ...(preset || {}), ...(niche || {}), extra_hooks: { ...((preset && preset.extra_hooks) || {}), ...((niche && niche.extra_hooks) || {}) } } : null;
  return { config, preset_id: preset ? id : null, niche_file: !!niche };
}

// opts.now (unix seconds) pins "today" for the age of the snapshot in next_steps.
function loadSnapshot(dir, presetOverride, opts0 = {}) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const ts = meta.date ? Date.parse(meta.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;
  const niche = loadNicheConfig(dir, presetOverride); // override is for snapshots without run.json
  const preset = niche.config;

  const allRows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
  const curation = readJson(path.join(dir, 'curation.json'));
  const cur = applyCuration(allRows, curation);
  const rows = cur.rows;
  const opts = { longDays: 90, now: ts };
  if (preset) {
    opts.extraHooks = preset.extra_hooks || {};
    opts.noise = preset.noise || [];
    if (preset.currency) opts.currency = preset.currency;
    if (preset.base_hooks === false) opts.baseHooks = false;
    if (preset.online_only) opts.onlineOnly = true;
  }
  // No preset currency: price the ads in the currency of the run's country (KZ: tenge).
  if (!opts.currency && currencyForCountry(meta.country)) opts.currency = currencyForCountry(meta.country);
  const doors = Object.fromEntries(rows.map(r => [r.id, classifyDoor(r)]));
  const stats = queryStats(allRows, rows, { queries: meta.queries, rateLimited: meta.rate_limited_queries, curated: !!curation });
  const curationMeta = curation ? { curation: { excluded_ads: cur.excluded_ads, excluded_pages: cur.excluded_pages, kept_pages: new Set(rows.map(r => r.page)).size, types: cur.types, not_found: cur.not_found, notes: curation.notes || '' } } : {};
  const euData = readJson(path.join(dir, 'eu.json')); // EU reach and audience, collected by eu_details.py
  const eu = euData ? euSummary(euData, rows) : null;
  // Pictures downloaded by fetch_creatives.py (creatives/manifest.json) and the
  // tags Claude wrote for them (creatives.json).
  const manifest = readJson(path.join(dir, 'creatives', 'manifest.json'));
  const visuals = manifest ? creativesSummary(rows, readJson(path.join(dir, 'creatives.json')), manifest, { now: ts, longDays: opts.longDays }) : null;
  const report = buildReport(rows, opts);
  const warnings = snapshotWarnings({ advertisers: report.advertisers, queryStats: stats, ts, preset, stoppedAds: report.stopped.ads })
    .concat(visuals ? visuals.warnings : []);
  // What the folder already has, for the "what else can be done" block.
  const has = f => fs.existsSync(path.join(dir, f));
  const now = opts0.now || Date.now() / 1000;
  const next_steps = nextSteps({
    curated: !!curation, has_image_links: allRows.some(r => r.image_url), has_page_id: allRows.some(r => r.page_id),
    age_days: Math.max(0, (now - ts) / 86400), manifest: !!manifest, downloaded: visuals ? visuals.downloaded : 0, labeled: visuals ? visuals.labeled : 0,
    sites: has('sites.json'), client: has('client.json') || fs.existsSync(path.join(path.dirname(path.resolve(dir)), 'client.json')),
    hypotheses: has('hypotheses.json'), plan: has('test_plan.json'), diff: has('diff.json'), eu_country: isEuCountry(meta.country), eu: !!euData,
    preset: !!niche.preset_id, niche: niche.niche_file, pages_of: !!meta.pages_of,
    rate_limited: (meta.rate_limited_queries || []).length, queries: (meta.queries || []).length
  });
  return { report, doors, rows, query_stats: stats, warnings, eu, visuals, next_steps,
    meta: { ...meta, ts, preset_title: preset && preset.title, niche_file: niche.niche_file, niche: preset, ...curationMeta } };
}

module.exports = { loadSnapshot, loadNicheConfig };

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
  const { report, doors, meta, query_stats, warnings, eu, visuals, next_steps } = snap;
  process.stdout.write(JSON.stringify({ report, doors, meta, query_stats, warnings, eu, visuals, next_steps }));
}
