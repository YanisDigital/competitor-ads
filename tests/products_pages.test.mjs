// Early products: pages that are not competitors for the brief (health, local services, flammables, brands)
// are left out of the lists that show what works, marked, and listed with the reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report');
const PRESET = JSON.parse(readFileSync(path.join(SKILL, 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;
const opts = { now: NOW, currency: 'USD', onlineOnly: true, baseHooks: false, products: PRESET.products };

let seq = 100;
const ad = (page, daysAgo, link, title, body = '', variants = 1) => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: variants, snapshot: { title, body: { text: body }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, 'q');

const ROWS = [
  // the three pages found in the first live report
  ad('Healthy Hair Growth Secrets', 100, 'https://pills.shop-h.example/quiz', 'Your follicles are last in line', 'Hair loss under stress, hormonal and nutritional. Take the quiz to find out why'),
  ad('Yankee Home Improvement', 120, 'https://get.yankee-home.example/baths', 'This is what a shower should cost', 'Installed in as little as 1 day. Book a free in-home estimate today'),
  ad('Yankee Home Improvement', 119, 'https://get.yankee-home.example/baths', 'Walk-in shower and bath remodel', 'Licensed and insured contractors'),
  ad('Bigfoot Bushcraft', 110, 'https://bigfoot.example/products/fire-plug', 'Waterproof fire starter', 'Windproof, waterproof, 5+ minute burn time. Instant fire'),
  // ordinary dropshipped products that must stay
  ad('Store A', 120, 'https://store-a.example/products/drain-snake', 'Clogged drain? Clear it in seconds', 'Hair catcher for the shower drain, no tools needed', 3),
  ad('Store B', 20, 'https://store-b.example/products/ferro-rod-kit', 'Ferro rod fire starter kit', 'Strike sparks in any weather. Compact steel rod with striker'),
  ad('Store C', 20, 'https://store-c.example/products/cleaning-tablets', 'Toilet cleaning tablets', 'Drop in a tablet and the stains are gone. Laundry capsules too'),
  // a store with one health-sounding ad out of four is not excluded (the threshold is a third)
  ad('Store D', 120, 'https://store-d.example/products/mop-one', 'Spin mop for hard floors', 'Cleans in half the time'),
  ad('Store D', 119, 'https://store-d.example/products/mop-two', 'Mop refill pads', 'Fits the spin mop, pack of 6'),
  ad('Store D', 118, 'https://store-d.example/products/duster', 'Extendable duster', 'Reach the ceiling fan without a ladder'),
  ad('Store D', 117, 'https://store-d.example/products/knee-pad', 'Garden knee pad', 'Relieve pressure on your joints while you work in the garden')
];

const report = buildReport(ROWS, opts);
const byName = n => report.products.excluded_pages.find(e => e.page === n);

test('pages with red flags are excluded and listed with the reason', () => {
  assert.deepEqual(byName('Healthy Hair Growth Secrets').flags, ['здоровье/медицина']);
  assert.ok(byName('Yankee Home Improvement').flags.includes('локальные услуги/ремонт'));
  assert.deepEqual(byName('Bigfoot Bushcraft').flags, ['огнеопасное/химическое']);
  assert.equal(byName('Yankee Home Improvement').ads, 2);
  assert.equal(report.products.excluded_count, report.products.excluded_pages.length, 'the list is complete, not cut');
  for (const n of ['Store A', 'Store B', 'Store C']) assert.equal(byName(n), undefined, n + ' is an ordinary store');
  assert.equal(byName('Store D'), undefined, 'one flagged ad out of four stays below the threshold');
});

test('excluded pages are marked in top_pages and kept out of longrun, samples and products', () => {
  const marked = report.top_pages.filter(p => p.out_of_niche).map(p => p.page).sort();
  assert.deepEqual(marked, ['Bigfoot Bushcraft', 'Healthy Hair Growth Secrets', 'Yankee Home Improvement']);
  const lists = [...report.longrun.map(x => x.page), ...report.samples.map(x => x.page)];
  for (const n of ['Healthy Hair Growth Secrets', 'Yankee Home Improvement', 'Bigfoot Bushcraft']) assert.ok(!lists.includes(n), n);
  assert.ok(lists.includes('Store A'), 'an ordinary store stays in the lists');
  const productPages = report.products.top.flatMap(p => p.pages);
  assert.ok(!productPages.includes('Bigfoot Bushcraft') && !productPages.includes('Healthy Hair Growth Secrets'));
  assert.ok(productPages.includes('Store A'));
});

test('cleaning tablets, laundry capsules and a ferro rod are not flagged; chemical burn-time fire starters are', () => {
  const flag = t => Object.entries(PRESET.products.red_flags).filter(([, s]) => new RegExp(s, 'i').test(t)).map(([k]) => k);
  assert.deepEqual(flag('Toilet cleaning tablets and laundry capsules'), []);
  assert.deepEqual(flag('Ferro rod fire starter kit'), []);
  assert.deepEqual(flag('Waterproof fire starter, 5+ minute burn time'), ['огнеопасное/химическое']);
  assert.deepEqual(flag('Book your dryer vent cleaning today'), ['локальные услуги/ремонт']);
  assert.deepEqual(flag('Lymph support formula'), ['здоровье/медицина']);
  assert.deepEqual(flag('Easy installation, no tools needed'), [], 'a product that is easy to install is not a local service');
});

function snapshot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pg-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(ROWS));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['q'], preset: 'ecom-problem-solvers-us' }));
  return dir;
}

test('HTML says which pages were left out and marks them in the top table', () => {
  const html = buildHtml({ ...loadSnapshot(snapshot()), images: {}, generated: '2026-10-12' });
  assert.match(html, /Исключено как вне ниши \(3 страниц/);
  assert.match(html, /Healthy Hair Growth Secrets \(здоровье\/медицина\)/);
  assert.match(html, /вне ниши: локальные услуги\/ремонт/);
});

const py = args => spawnSync('python', args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const hasOpenpyxl = py(['-c', 'import openpyxl']).status === 0;

test('Excel: sheet "Вне ниши" lists every excluded page with its reasons', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = snapshot();
  const res = py([path.join(SKILL, 'scripts', 'export_xlsx.py'), dir]);
  assert.equal(res.status, 0, res.stderr);
  const out = py(['-c', [
    'import sys',
    'from openpyxl import load_workbook',
    'ws = load_workbook(sys.argv[1])["Вне ниши"]',
    'for r in ws.iter_rows(min_row=2, max_row=4, values_only=True): print("|".join(str(x) for x in r))'
  ].join('\n'), path.join(dir, 'report.xlsx')]);
  const lines = out.stdout.trim().split('\n');
  assert.ok(lines.some(l => /^Yankee Home Improvement\|2\|2\|локальные услуги\/ремонт/.test(l)), out.stdout);
  assert.ok(lines.some(l => /^Healthy Hair Growth Secrets\|1\|1\|здоровье\/медицина/.test(l)), out.stdout);
});
