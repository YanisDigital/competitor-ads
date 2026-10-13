// The Library matches ANY word of a query (and text we never collect), so most ads it returns for
// "clogged drain" are not about drains. For presets with a products block, an ad whose own text lacks the
// query words is a loose match: counted, marked, but kept out of the lists and the products.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, queryMatch } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report');
const PRESET = JSON.parse(readFileSync(path.join(SKILL, 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 500;
const ad = (page, daysAgo, link, title, body, query) => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title, body: { text: body }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, query);

test('queryMatch: all words of the query, endings ignored, fillers not required', () => {
  const m = (title, body, q, link = '') => queryMatch({ title, body, link, kws: [q] });
  assert.equal(m('Hair clogs your drains?', 'Pop it in, done', 'clogged drain'), true, 'clogs / drains');
  assert.equal(m('The kitchen table', 'The faucet and the drain. The brown dust on the saucer', 'clogged drain'), false, 'only one word');
  assert.equal(m('Why your kidney numbers get worse', 'My husband started dialysis', 'clogged drain'), false);
  assert.equal(m('Sink organizers that fit', 'Two tiers, sliding drawers', 'under sink organizer'), true, '"under" is a filler');
  assert.equal(m('Two tiers', 'Sliding drawers', 'under sink organizer', 'https://shop.example/products/under-sink-organizer'), true, 'the link counts');
  assert.equal(queryMatch({ title: 'x', body: 'y', kws: [] }), null, 'no query, no verdict');
  assert.equal(queryMatch({ title: 'Grout stains gone', body: '', kws: ['clogged drain', 'grout stains'] }), true, 'any of the queries that found it');
});

const ROWS = [
  ad('Store A', 120, 'https://store-a.example/products/drain-snake', 'Clogged drain?', 'Clears clogs in seconds', 'clogged drain'),
  ad('Story Page', 120, 'https://story.example/', 'The kitchen table', 'The faucet and the drain. The brown dust on the saucer', 'clogged drain'),
  ad('Story Page', 20, 'https://story.example/products/kitchen-thing', 'The kitchen table again', 'A long story that has nothing to do with it', 'clogged drain'),
  ad('Store B', 20, 'https://store-b.example/products/drain-cover', 'Stop drain clogs', 'Hair catcher for every shower drain', 'clogged drain'),
  // a service company is recognised by its page name; a product ad may mention plumbing
  ad('Bossier Elite Plumbing & Air', 120, 'https://bossier.example/', 'Clogged drain? Call us', 'Same-day drain clearing in Bossier', 'clogged drain'),
  ad('Store C', 20, 'https://store-c.example/products/c-shaped-organizer', 'Under sink organizer', 'Curves around the plumbing and doubles your space', 'under sink organizer')
];

test('buildReport (products preset): loose matches stay out of the lists and the products, and are counted', () => {
  const r = buildReport(ROWS, { now: NOW, currency: 'USD', onlineOnly: true, baseHooks: false, products: PRESET.products });
  assert.equal(r.products.query_check, true);
  assert.equal(r.products.loose_ads, 2, 'the two story ads');
  assert.equal(r.products.ads_checked, ROWS.length);
  const lists = [...r.longrun.map(x => x.page), ...r.samples.map(x => x.page), ...r.products.top.flatMap(p => p.pages)];
  assert.ok(!lists.includes('Story Page'));
  assert.ok(lists.includes('Store A') && lists.includes('Store B'));
  assert.ok(r.products.excluded_pages.some(e => e.page === 'Bossier Elite Plumbing & Air' && e.flags.includes('локальные услуги/ремонт')), 'service company by its name');
  assert.ok(!r.products.excluded_pages.some(e => e.page === 'Store C'), 'a product ad that mentions plumbing stays');
  assert.equal(r.ads, ROWS.length, 'the counts still hold every ad');
});

test('without a products block nothing changes: no query check', () => {
  const r = buildReport(ROWS, { now: NOW, currency: 'USD' });
  assert.equal(r.products, null);
  assert.ok(r.samples.some(x => x.page === 'Story Page'));
});

function snapshot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'qm-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(ROWS));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['clogged drain', 'under sink organizer'], preset: 'ecom-problem-solvers-us' }));
  return dir;
}

test('report.js gives the per-ad verdict and the HTML explains the loose matches', () => {
  const snap = loadSnapshot(snapshot());
  const verdicts = Object.values(snap.query_match);
  assert.equal(verdicts.filter(v => v === false).length, 2);
  const html = buildHtml({ ...snap, images: {}, generated: '2026-10-12' });
  assert.match(html, /у 2 из 6 объявлений в тексте нет слов запроса, это случайные совпадения/);
});

const py = args => spawnSync('python', args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const hasOpenpyxl = py(['-c', 'import openpyxl']).status === 0;

test('Excel: column "Слова запроса в тексте" on the ads sheet', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = snapshot();
  const res = py([path.join(SKILL, 'scripts', 'export_xlsx.py'), dir]);
  assert.equal(res.status, 0, res.stderr);
  const out = py(['-c', [
    'import sys',
    'from openpyxl import load_workbook',
    'ws = load_workbook(sys.argv[1])["Объявления"]',
    'heads = [c.value for c in ws[1]]',
    'col = heads.index("Слова запроса в тексте")',
    'print(sorted(str(r[col]) for r in ws.iter_rows(min_row=2, values_only=True)))'
  ].join('\n'), path.join(dir, 'report.xlsx')]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /'да', 'да', 'да', 'да', 'нет', 'нет'/);
});
