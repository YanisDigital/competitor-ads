#!/usr/bin/env node
// Rebuilds the full report for a snapshot folder from its ads.csv, using the
// same code as the collector (collector.js) and the snapshot's preset
// (run.json -> presets/<id>.json). Prints {report, doors, meta} as JSON to
// stdout. Used by export_xlsx.py so the spreadsheet always reflects the
// current report logic, even for folders scraped with an older version.
//
//   node report.js out/ecom-dropship-us/2026-09-30
const fs = require('fs');
const path = require('path');
const { parseCsv, buildReport, classifyDoor } = require('./collector.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
  console.error('Usage: node report.js <snapshot-folder-with-ads.csv>');
  process.exit(1);
}

const metaPath = path.join(dir, 'run.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
const ts = meta.date ? Date.parse(meta.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;

let preset = null;
const presetId = process.argv[3] || meta.preset; // optional override for snapshots without run.json
if (presetId) {
  const p = path.join(__dirname, '..', 'presets', presetId + '.json');
  if (fs.existsSync(p)) preset = JSON.parse(fs.readFileSync(p, 'utf8'));
}

const rows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
const opts = { longDays: 90, now: ts };
if (preset) {
  opts.extraHooks = preset.extra_hooks || {};
  opts.noise = preset.noise || [];
  if (preset.currency) opts.currency = preset.currency;
  if (preset.base_hooks === false) opts.baseHooks = false;
  if (preset.online_only) opts.onlineOnly = true;
}
const doors = Object.fromEntries(rows.map(r => [r.id, classifyDoor(r)]));
process.stdout.write(JSON.stringify({ report: buildReport(rows, opts), doors, meta: { ...meta, ts, preset_title: preset && preset.title } }));
