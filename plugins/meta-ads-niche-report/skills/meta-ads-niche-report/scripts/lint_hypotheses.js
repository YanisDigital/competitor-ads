#!/usr/bin/env node
// Checks the ad hypotheses in a snapshot folder (hypotheses.json): required
// fields, headline/text length, unfilled placeholders, risky wording
// (personal attributes, health claims, before/after, superlatives, fake
// urgency, ...) and, with a client.json, claims the client has not confirmed
// (guarantee days, rating, review count, discount, price, hooks). Rules live
// in collector.js (lintHypotheses). Writes hypotheses_lint.json next to the
// hypotheses, prints a summary, and exits 1 if any hypothesis has errors.
//
//   node lint_hypotheses.js out/ecom-dropship-us/2026-09-30 [path/to/client.json]
//
// These are heuristics, not Meta's review: final approval is Meta's.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lintHypotheses, checkFacts } = require('./collector.js');

const dir = process.argv[2];
const hypPath = dir && path.join(dir, 'hypotheses.json');
if (!dir || !fs.existsSync(hypPath)) {
  console.error('Usage: node lint_hypotheses.js <snapshot-folder-with-hypotheses.json> [client.json]');
  process.exit(2);
}

const clientPath = [process.argv[3], path.join(dir, 'client.json'), path.join(path.dirname(dir), 'client.json')].filter(Boolean).find(f => fs.existsSync(f));
const client = clientPath ? JSON.parse(fs.readFileSync(clientPath, 'utf8')) : null;

// The snapshot's preset and niche.json supply the niche hook regexes used to spot claims.
const preset = require('./report.js').loadNicheConfig(dir).config || {};

const hyps = JSON.parse(fs.readFileSync(hypPath, 'utf8'));
const results = lintHypotheses(hyps, {
  client,
  extraHooks: preset.extra_hooks || {},
  baseHooks: preset.base_hooks === false ? false : undefined
});
const out = path.join(dir, 'hypotheses_lint.json');
// The numbers in a hypothesis come from the data and the cleaning (curation.json). When either changed after the last
// check, the typed numbers may be stale: say so, and check the declared facts against the current report.
const hashOf = f => (fs.existsSync(path.join(dir, f)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 16) : '');
const data_hash = hashOf('ads.csv') + ':' + hashOf('curation.json') + ':' + hashOf('niche.json');
const prev = fs.existsSync(out) ? (() => { try { return JSON.parse(fs.readFileSync(out, 'utf8')).data_hash; } catch (e) { return null; } })() : null;
const stale = !!prev && prev !== data_hash;
const factIssues = checkFacts(hyps, require('./report.js').loadSnapshot(dir).report);
for (const x of factIssues) { const r = results.find(y => y.name === x.name); if (r) { r.findings.unshift({ severity: x.severity, code: x.code, field: 'facts', message: x.message }); r.errors++; } }
fs.writeFileSync(out, JSON.stringify({ client_file: clientPath || null, data_hash, stale_numbers: stale, results }, null, 2), 'utf8');
if (stale) console.log('WARNING: ads.csv, curation.json or niche.json changed after the last check: re-read the numbers in evidence/angle (or list them as facts: [{metric, value}]) before showing the hypotheses.');

console.log(clientPath ? `Client brief: ${clientPath}` : 'No client.json: claims cannot be checked against confirmed facts.');
for (const r of results) {
  console.log(`\n${r.name}: ${r.errors} errors, ${r.warnings} warnings`);
  for (const x of r.findings) console.log(`  [${x.severity}] ${x.code} (${x.field}): ${x.message}`);
}
console.log('\nSaved: ' + out);
process.exit(results.some(r => r.errors > 0) ? 1 : 0);
