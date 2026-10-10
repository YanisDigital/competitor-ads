#!/usr/bin/env node
// Ranks the ad hypotheses of a snapshot and builds a TikTok test plan. Reads
// hypotheses.json, client.json (snapshot folder, its parent, or an explicit
// path) and hypotheses_lint.json (runs the lint itself if it is missing).
// Rules live in collector.js (prioritizeHypotheses, planTests). Writes
// test_plan.json and prints the ranking and the rounds.
//
//   node plan_tests.js out/fitness-pl/2026-10-10 [path/to/client.json]
//
// The score is transparent (evidence x readiness / effort): it orders work,
// it does not predict results.
const fs = require('fs');
const path = require('path');
const { lintHypotheses, prioritizeHypotheses, planTests } = require('./collector.js');

const dir = process.argv[2];
const hypPath = dir && path.join(dir, 'hypotheses.json');
if (!dir || !fs.existsSync(hypPath)) {
  console.error('Usage: node plan_tests.js <snapshot-folder-with-hypotheses.json> [client.json]');
  process.exit(2);
}
const hyps = JSON.parse(fs.readFileSync(hypPath, 'utf8'));
const clientPath = [process.argv[3], path.join(dir, 'client.json'), path.join(path.dirname(dir), 'client.json')].filter(Boolean).find(f => fs.existsSync(f));
const client = clientPath ? JSON.parse(fs.readFileSync(clientPath, 'utf8')) : null;

const lintPath = path.join(dir, 'hypotheses_lint.json');
let lintList;
if (fs.existsSync(lintPath) && fs.statSync(lintPath).mtimeMs >= fs.statSync(hypPath).mtimeMs) {
  lintList = JSON.parse(fs.readFileSync(lintPath, 'utf8')).results;
} else {
  const preset = require('./report.js').loadNicheConfig(dir).config || {};
  lintList = lintHypotheses(hyps, { client, extraHooks: preset.extra_hooks || {}, baseHooks: preset.base_hooks === false ? false : undefined });
}
const lint = Object.fromEntries(lintList.map(r => [r.name, r]));
const ranked = prioritizeHypotheses(hyps, { client, lint });
const plan = planTests(ranked, { client });
const out = path.join(dir, 'test_plan.json');
fs.writeFileSync(out, JSON.stringify({ client_file: clientPath || null, ranked, plan }, null, 2), 'utf8');

console.log(clientPath ? `Client brief: ${clientPath}` : 'No client.json: hooks that need a client fact stay "unknown".');
console.log('\nRanking (score = evidence x readiness / effort):');
for (const r of ranked) console.log(`  ${r.rank}. ${r.name}  score ${r.score}  [${r.evidence_strength}, ${r.variable_type}, fit ${r.fit}, effort ${r.effort}]${r.blockers.length ? '  BLOCKERS: ' + r.blockers.join('; ') : ''}`);
console.log('\nRounds (max ' + plan.assumptions.max_parallel_tests + ' parallel, different variable types; hook and creative never together):');
for (const r of plan.rounds) console.log(`  Round ${r.round}: ${r.tests.map(t => t.name + ' (' + t.variable_type + ')').join(' + ')}${r.budget === null ? '' : '  budget ~' + r.budget}`);
if (plan.excluded.length) console.log('\nExcluded: ' + plan.excluded.map(e => e.name + ' (' + e.reason + ')').join('; '));
const a = plan.assumptions;
console.log(`\nAssumptions: ${a.variants_per_test} variants per test, ${a.events_per_variant} optimization events per variant (TikTok learning-phase guideline), at least ${a.min_days_per_round} days per round, refresh creatives every ${a.creative_refresh_days} days, target CPA ${a.target_cpa === null ? 'unknown (add target_cpa to client.json for a budget)' : a.target_cpa}.`);
console.log('Saved: ' + out);
