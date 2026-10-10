#!/usr/bin/env node
// Which of a snapshot's winning / under-used hooks can this client truthfully
// use, and what still has to be asked? Reads client.json (see
// ../client.example.json) from the snapshot folder or its parent, the report
// from ads.csv (via report.js logic) and prints JSON. The rules live in
// collector.js (checkClientFit); this file only wires files together.
//
//   node client_fit.js out/fitness-pl/2026-10-09 [path/to/client.json]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkClientFit, serviceEconomics } = require('./collector.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
  console.error('Usage: node client_fit.js <snapshot-folder> [client.json]');
  process.exit(1);
}

const QUESTIONS = {
  reviews_count: 'How many real customer reviews do you have (and the average rating)?',
  free_offer: 'Is anything really free (a trial class, a consultation, a sample)? What exactly, or false.',
  before_after_allowed: 'Do you have real before/after material you may show, and is it allowed for this niche (not weight loss)? true or false.',
  reviews_quotable: 'May we quote customer reviews in ads (customers agreed / platform allows)?',
  guarantee_days: 'What is the money-back / return period in days (0 if there is none)?',
  free_shipping: 'Is shipping free (always, or over which order amount)?',
  free_shipping_over: 'Free shipping over what order amount (or none)?',
  bonus: 'Is there a bonus or free gift with an order, and what is it?',
  max_discount_pct: 'What is the largest discount in percent you can afford at your margin?',
  real_deadline: 'Do you run real time-limited sales with an actual end date?',
  // services (salons, clinics, makeup artists)
  experience_years: 'How many years of professional experience (the real number, 0 if just starting)?',
  address: 'What is the address or district where clients come to you (false if you work only online or at the client\'s home)?',
  booking_url: 'What is the link where a client can book (false if there is none yet)?',
  first_visit_offer: 'Is there a real offer for a first visit, and what exactly (false if none)?',
  portfolio_ready: 'Do you have finished work you may show (photos with the clients\' permission)? true or false.',
  installment: 'Is payment in installments possible? true or false.'
};
// What a client is worth: asked once for a service business, they set the ceiling for the price of a booking.
const ECONOMICS_QUESTIONS = {
  avg_check: 'What is the average check per visit (in the ad currency)?',
  visits_per_year: 'How many times a year does a client usually come?',
  retention_months: 'For how many months does a client typically keep coming?',
  margin_pct: 'What share of the revenue is profit before advertising, in percent?',
  booking_to_visit_pct: 'Out of 100 bookings, how many people actually come?'
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
// Economics only when the brief started on them (a service business): an e-commerce brief never asked.
const economics = client && ['avg_check', 'visits_per_year', 'retention_months', 'margin_pct', 'booking_to_visit_pct'].some(f => client[f] !== undefined && client[f] !== null) ? serviceEconomics(client) : null;

console.log(JSON.stringify({
  client_file: clientPath || null,
  product: client && client.product || null,
  usable_hooks: rows.filter(r => r.status === 'ready' && !r.circular).map(r => r.hook),
  blocked_hooks: rows.filter(r => r.status === 'blocked').map(r => r.hook),
  questions: askFields.map(f => ({ field: f, question: QUESTIONS[f] })).filter(q => q.question),
  economics,
  economics_questions: economics ? economics.missing.map(f => ({ field: f, question: ECONOMICS_QUESTIONS[f] })) : [],
  hooks: rows
}, null, 2));
