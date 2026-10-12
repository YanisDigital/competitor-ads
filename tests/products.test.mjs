// Early products (preset ecom-problem-solvers-us): grouping of ads into products and the brief's criteria.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, earlyProducts } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report');
const PRESET = JSON.parse(readFileSync(path.join(SKILL, 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;

const ad = (id, page, daysAgo, link, text, variants = 1) => normalizeAd({
  ad_archive_id: String(id), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: variants, snapshot: { title: text, body: { text: '' }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, 'q');
const cfg = { min_days: 7, max_days: 45, max_stores: 3, min_price: 45, red_flags: PRESET.products.red_flags };
const run = rows => earlyProducts(rows, { now: NOW, currency: 'USD', config: cfg });
const byHandle = (res, h) => res.top.find(p => p.handle === h);

const ROWS = [
  // a good one: one store, 20 days, 3 variants, price in the ad
  ad(1, 'Store A', 20, 'https://store-a.example/products/drain-snake?utm_source=fb', 'Clogged drain? Clear it in seconds. Only $49.95', 3),
  ad(2, 'Store A', 5, 'https://store-a.example/products/drain-snake', 'Say goodbye to clogged drains forever'),
  // the same handle on a second page of the same store counts as one store
  ad(3, 'Store A Outlet', 12, 'https://store-a.example/products/drain-snake-2', 'Drain snake bundle, free shipping'),
  // too old
  ad(4, 'Store B', 120, 'https://store-b.example/products/grout-brush', 'Grout stains gone. $59'),
  // too new (3 days)
  ad(5, 'Store C', 3, 'https://store-c.example/products/lint-trap', 'Dryer lint trap that never clogs'),
  // sold by four stores: not early any more
  ad(6, 'Store D1', 20, 'https://d1.example/products/under-sink-rack', 'Under sink organizer, $52'),
  ad(7, 'Store D2', 21, 'https://d2.example/products/under-sink-rack', 'Under sink organizer, $52'),
  ad(8, 'Store D3', 22, 'https://d3.example/products/under-sink-rack', 'Under sink organizer, $52'),
  ad(9, 'Store D4', 23, 'https://d4.example/products/under-sink-rack', 'Under sink organizer, $52'),
  // health claim: red flag
  ad(10, 'Store E', 15, 'https://store-e.example/products/knee-brace', 'Pain relief for your joints in minutes. $59'),
  // price in the ad below the minimum
  ad(11, 'Store F', 15, 'https://store-f.example/products/screw-extractor', 'Remove any stripped screw. Only $12.99'),
  // a store's brand ad: no product link, unique text: not a product
  ad(12, 'Store G', 10, 'https://store-g.example/', 'Welcome to Store G, we love our customers and ship worldwide every day'),
  // the same copy on two pages without a product link: a copied creative, so a product
  ad(13, 'Store H', 18, 'https://h1.example/', 'This genius fold-flat shower caddy ends the clutter for good, order yours today'),
  ad(14, 'Store H2', 19, 'https://h2.example/', 'This genius fold-flat shower caddy ends the clutter for good, order yours today'),
  // a tracker link is not a store
  ad(15, 'Store I', 18, 'https://track.shop-i.example/abc', 'Stain remover that works on any fabric')
];

test('earlyProducts: handle grouping, one store per site, window, scaling, price', () => {
  const r = run(ROWS);
  const drain = byHandle(r, 'drain-snake');
  assert.equal(drain.ads, 3);
  assert.equal(drain.stores, 1, 'two pages on one site are one store');
  assert.ok([20, 21].includes(drain.oldest_days), 'the CSV keeps the day only');
  assert.equal(drain.variants, 5);
  assert.equal(drain.fresh_ads, 1);
  assert.deepEqual(drain.price, { min: 49.95, max: 49.95 });
  assert.equal(drain.early, true);
  assert.equal(drain.strong, true, 'new variants and a launch this week');
  assert.equal(drain.ad_urls.length, 3);
  assert.ok(drain.store_urls.every(u => !u.includes('?')), 'store links lose their query');
  assert.equal(r.criteria.max_days, 45);
});

test('earlyProducts: too old, too new, too many stores, red flags, low price', () => {
  const r = run(ROWS);
  const old = byHandle(r, 'grout-brush');
  assert.equal(old.checks.window, false);
  assert.match(old.reasons.join(' '), /старый \(120/);
  assert.equal(byHandle(r, 'lint-trap').checks.window, false);
  assert.match(byHandle(r, 'lint-trap').reasons.join(' '), /слишком свежий/);
  const rack = byHandle(r, 'under-sink-rack');
  assert.equal(rack.stores, 4);
  assert.equal(rack.early, false);
  assert.equal(r.too_many_stores, 1);
  const knee = byHandle(r, 'knee-brace');
  assert.deepEqual(knee.red_flags, ['здоровье/медицина']);
  assert.equal(knee.early, false);
  const screw = byHandle(r, 'screw-extractor');
  assert.equal(screw.checks.price, false);
  assert.equal(screw.early, false);
  assert.match(screw.reasons.join(' '), /\$12\.99/);
});

test('earlyProducts: copied creatives are products, brand ads are not, trackers are not stores', () => {
  const r = run(ROWS);
  const caddy = r.top.find(p => /shower caddy/.test(p.text));
  assert.ok(caddy, 'the same copy on two pages is a product');
  assert.equal(caddy.handle, '');
  assert.equal(caddy.stores, 2);
  assert.ok(!r.top.some(p => /Store G/.test(p.text)), 'a brand ad without product link or copy is no product');
  const stain = r.top.find(p => /Stain remover/.test(p.text));
  assert.equal(stain, undefined, 'a single ad through a tracker has no handle and no copy: not a product');
});

test('earlyProducts: best first, strong before early before the rest', () => {
  const r = run(ROWS);
  const order = r.top.map(p => (p.strong ? 2 : p.early ? 1 : 0));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));
  assert.equal(r.found, r.top.length);
  assert.ok(r.strong >= 1 && r.early >= r.strong);
});

test('buildReport: products only when the preset has a products block', () => {
  assert.equal(buildReport(ROWS, { now: NOW, currency: 'USD' }).products, null);
  const r = buildReport(ROWS, { now: NOW, currency: 'USD', products: cfg });
  assert.ok(r.products && r.products.found > 0);
});

test('preset ecom-problem-solvers-us: valid, 15 queries, regexes compile and match the brief', () => {
  assert.equal(PRESET.services.length, 15, 'one run holds at most 15 queries');
  assert.ok(PRESET.services.every(s => typeof s.en === 'string' && !/[%$]|off\b|free shipping|limited stock/i.test(s.en)), 'offers are hooks, not queries (the Library matches any word)');
  for (const [k, src] of [...Object.entries(PRESET.products.red_flags), ...Object.entries(PRESET.extra_hooks)]) assert.doesNotThrow(() => new RegExp(src, 'i'), k);
  assert.equal(PRESET.products.min_days, 7);
  assert.equal(PRESET.products.max_days, 45);
  assert.equal(PRESET.products.max_stores, 3);
  assert.equal(PRESET.products.min_price, 45);
  const flag = text => Object.entries(PRESET.products.red_flags).filter(([, s]) => new RegExp(s, 'i').test(text)).map(([k]) => k);
  assert.deepEqual(flag('Baby bottle warmer'), ['детские товары']);
  assert.deepEqual(flag('pain relief for arthritis'), ['здоровье/медицина']);
  assert.deepEqual(flag('hunting knife'), ['оружие/регулируемое']);
  assert.deepEqual(flag('patented design'), ['бренд/патент']);
  assert.deepEqual(flag('Under sink organizer'), []);
});

function snapshot(rows, preset = 'ecom-problem-solvers-us') {
  const dir = mkdtempSync(path.join(tmpdir(), 'prod-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['clogged drain'], preset }));
  return dir;
}

test('snapshot with the preset: report.products, HTML section, and no section for other presets', () => {
  const snap = loadSnapshot(snapshot(ROWS));
  assert.ok(snap.report.products && snap.report.products.early >= 1);
  const html = buildHtml({ ...snap, images: {}, generated: '2026-10-12' });
  assert.match(html, /<h2>Ранние продукты<\/h2>/);
  assert.match(html, /drain snake/);
  assert.ok(!/<script/i.test(html));
  const other = loadSnapshot(snapshot(ROWS, 'ecom-dropship-us'));
  assert.equal(other.report.products, null);
  assert.ok(!/Ранние продукты/.test(buildHtml({ ...other, images: {}, generated: '2026-10-12' })));
});

const py = (args) => spawnSync('python', args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const hasOpenpyxl = py(['-c', 'import openpyxl']).status === 0;

test('Excel: sheet "Продукты" with the brief columns and empty manual columns', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = snapshot(ROWS);
  const res = py([path.join(SKILL, 'scripts', 'export_xlsx.py'), dir]);
  assert.equal(res.status, 0, res.stderr);
  const out = py(['-c', [
    'import sys',
    'from openpyxl import load_workbook',
    'ws = load_workbook(sys.argv[1])["Продукты"]',
    'print("|".join(str(c.value) for c in ws[1]))',
    'print("|".join("" if c.value is None else str(c.value) for c in ws[2]))'
  ].join('\n'), path.join(dir, 'report.xlsx')]);
  const [heads, row] = out.stdout.trim().split('\n');
  assert.match(heads, /^Продукт\|Проблема/);
  assert.match(heads, /Ссылка на поставщика \(вручную\)/);
  assert.match(row, /^drain snake\|\|сильный\|1\|2[01]\|/);
});

test('texts cut at an emoji never leave half of it (a lone surrogate stopped the Excel save)', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const long = 'x'.repeat(139) + '😀 tail';   // the emoji straddles the 140-character cut
  const rows = [ad(21, 'Store J', 20, 'https://j.example/', long), ad(22, 'Store J2', 20, 'https://j2.example/', long)];
  const r = run(rows);
  assert.ok(r.top.length >= 1);
  for (const p of r.top) assert.ok(p.text.isWellFormed() && p.name.isWellFormed());
  const dir = snapshot(rows);
  const res = py([path.join(SKILL, 'scripts', 'export_xlsx.py'), dir]);
  assert.equal(res.status, 0, res.stderr);
});
