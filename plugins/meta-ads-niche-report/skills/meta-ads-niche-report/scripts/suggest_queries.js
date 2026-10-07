#!/usr/bin/env node
// Which queries of a curated snapshot are worth keeping? A query stays only if
// it found at least one competitor (see curation.json); the rest are listed
// with the reason. Also prints `preset_services`, ready to paste into a preset.
// The rule lives in collector.js (suggestQueries); this file wires files.
//
//   node suggest_queries.js out/craft-beer-ua-merged/2026-10-02
const fs = require('fs');
const path = require('path');
const { suggestQueries } = require('./collector.js');
const { loadSnapshot } = require('./report.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
  console.error('Usage: node suggest_queries.js <snapshot-folder-with-ads.csv>');
  process.exit(1);
}
const { query_stats, meta } = loadSnapshot(dir, process.argv[3]);
const out = suggestQueries(query_stats);
if (!out.curated) console.error('No curation.json in this folder: without it there is no way to tell competitors from noise. Curate the advertisers first.');
// A niche without a preset: niche.json plus the queries that found competitors is
// a preset draft. Save it to presets/ only with the user's consent.
if (out.curated && meta.niche_file && meta.niche) {
  const { extra_hooks, noise, currency, base_hooks, online_only, seasons, policy, title } = meta.niche;
  out.preset_draft = Object.fromEntries(Object.entries({ id: '<niche-id>', title: title || '', languages: out.languages, services: out.preset_services,
    extra_hooks, noise, currency, base_hooks, online_only, seasons, policy }).filter(([, v]) => v !== undefined));
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
