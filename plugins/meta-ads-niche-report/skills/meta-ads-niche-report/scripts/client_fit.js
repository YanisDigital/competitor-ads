#!/usr/bin/env node
// Which of a snapshot's winning / under-used hooks can this client truthfully
// use, and what still has to be asked? Reads client.json (see
// ../client.example.json) from the snapshot folder or its parent, the report
// from ads.csv (via report.js logic) and prints JSON. The rules live in
// collector.js (checkClientFit); this file only wires files together.
//
//   node client_fit.js out/ecom-dropship-us/2026-09-30 [path/to/client.json]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkClientFit } = require('./collector.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
  console.error('Usage: node client_fit.js <snapshot-folder> [client.json]');
  process.exit(1);
}

const QUESTIONS = {
  reviews_count: 'How many real customer reviews do you have (and the average rating)?',
  reviews_quotable: 'May we quote customer reviews in ads (customers agreed / platform allows)?',
  guarantee_days: 'What is the money-back / return period in days (0 if there is none)?',
  free_shipping: 'Is shipping free (always, or over which order amount)?',
  free_shipping_over: 'Free shipping over what order amount (or none)?',
  bonus: 'Is there a bonus or free gift with an order, and what is it?',
  bundles: 'Are there bundle offers (for example 2 for $X)? List them, or say none.',
  has_copies: 'Are there cheap copies of this product on the market that you can honestly distinguish from?',
  max_discount_pct: 'What is the largest discount in percent you can afford at your margin?',
  real_deadline: 'Do you run real time-limited sales with an actual end date?',
  real_stock_limit: 'Is stock actually limited (real numbers you can state)?',
  personalization: 'Can the product be personalized (name, photo, custom text)?'
};

const candidates = [process.argv[3], path.join(dir, 'client.json'), path.join(path.dirname(dir), 'client.json')].filter(Boolean);
const clientPath = candidates.find(f => fs.existsSync(f));
const client = clientPath ? JSON.parse(fs.readFileSync(clientPath, 'utf8')) : null;

const data = JSON.parse(execFileSync('node', [path.join(__dirname, 'report.js'), dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const hi = data.report.hypothesis_inputs;
const hooks = [];
for (const w of hi.winner_hooks) hooks.push({ hook: w.hook, from: 'winner', strength: w.strength, circular: w.circular });
for (const u of hi.underused_hooks) if (!hooks.some(h => h.hook === u.hook)) hooks.push({ hook: u.hook, from: 'underused', circular: u.circular });

const fit = checkClientFit(client, hooks.map(h => h.hook));
const rows = hooks.map((h, i) => ({ ...h, status: fit[i].status, missing: fit[i].missing, ask: fit[i].missing.map(f => QUESTIONS[f]).filter(Boolean) }));
const askFields = [...new Set(rows.flatMap(r => r.missing))];

console.log(JSON.stringify({
  client_file: clientPath || null,
  product: client && client.product || null,
  usable_hooks: rows.filter(r => r.status === 'ready' && !r.circular).map(r => r.hook),
  blocked_hooks: rows.filter(r => r.status === 'blocked').map(r => r.hook),
  questions: askFields.map(f => ({ field: f, question: QUESTIONS[f] })).filter(q => q.question),
  hooks: rows
}, null, 2));
