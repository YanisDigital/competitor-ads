#!/usr/bin/env node
// Rebuilds the full report for a snapshot folder from its ads.csv, using the
// same code as the collector (collector.js) and the snapshot's preset
// (run.json -> presets/<id>.json). If the folder has a curation.json (hand-made
// list of advertisers to keep or drop, see applyCuration in collector.js) the
// report is built from the kept advertisers only. As a CLI it prints
// {report, doors, meta, query_stats, warnings} as
// JSON to stdout; as a module it exports loadSnapshot(). Used by
// export_xlsx.py and export_html.js so exports always reflect the current
// report logic, even for folders scraped with an older version.
//
//   node report.js out/ecom-dropship-us/2026-09-30 [preset-id]
const fs = require('fs');
const path = require('path');
const { parseCsv, buildReport, classifyDoor, applyCuration, queryStats, snapshotWarnings, currencyForCountry } = require('./collector.js');

function loadSnapshot(dir, presetOverride) {
  const metaPath = path.join(dir, 'run.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const ts = meta.date ? Date.parse(meta.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;

  let preset = null;
  const presetId = presetOverride || meta.preset; // override is for snapshots without run.json
  if (presetId) {
    const p = path.join(__dirname, '..', 'presets', presetId + '.json');
    if (fs.existsSync(p)) preset = JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  const allRows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
  const curationPath = path.join(dir, 'curation.json');
  const curation = fs.existsSync(curationPath) ? JSON.parse(fs.readFileSync(curationPath, 'utf8')) : null;
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
  const report = buildReport(rows, opts);
  const warnings = snapshotWarnings({ advertisers: report.advertisers, queryStats: stats, ts, preset, stoppedAds: report.stopped.ads });
  return { report, doors, rows, query_stats: stats, warnings, meta: { ...meta, ts, preset_title: preset && preset.title, ...curationMeta } };
}

module.exports = { loadSnapshot };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node report.js <snapshot-folder-with-ads.csv> [preset-id]');
    process.exit(1);
  }
  const { report, doors, meta, query_stats, warnings } = loadSnapshot(dir, process.argv[3]);
  process.stdout.write(JSON.stringify({ report, doors, meta, query_stats, warnings }));
}
