// Found in the used-laptops and Czech travel studies: prices in other currencies were not counted, local-service hooks showed up
// as "free angles" for online niches, the query check existed only for one preset, and an empty market was reported as "small sample".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, siteFacts, queryMatch, nextSteps } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 2000;
const ad = (page, daysAgo, title, body = '', query = 'q', link = 'https://t.example/', active = true) => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page, page_name: page, is_active: active, start_date: NOW - daysAgo * DAY, end_date: active ? NOW : NOW - 3 * DAY, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title, body: { text: body }, cta_text: 'Learn more', link_url: link, display_format: 'IMAGE' }
}, query);

// ---- 1. currencies ----
test('prices in Czech crowns, euros and zloty are counted, with "instead of" pairs and percent off', () => {
  const czk = siteFacts('Zájezd za 12 990 Kč místo 15 990 Kč, sleva 20 %', { currency: 'CZK' });
  assert.deepEqual(czk.prices.list, [12990, 15990]);
  assert.deepEqual(czk.pct_off, [20]);
  assert.deepEqual(siteFacts('Flight €199 instead of €249', { currency: 'EUR' }).prices.list, [199, 249]);
  assert.deepEqual(siteFacts('Laptop 1 299 zł, 49,90 zł dostawa', { currency: 'PLN' }).prices.list, [49.9, 1299]);
  assert.deepEqual(siteFacts('Ноутбук 15 990 Kč', { currency: 'UAH' }).prices.list, [], 'another currency is not counted');
});

test('report: the price block and the price hook follow the niche currency', () => {
  const rows = [ad('Tours', 20, 'Egypt tour 12 990 Kč', 'all inclusive, sleva 10 %')];
  const r = buildReport(rows, { now: NOW, currency: 'CZK' });
  assert.equal(r.prices.currency, 'CZK');
  assert.equal(r.prices.ads_with_price, 1);
  assert.equal(r.prices.min, 12990);
  assert.ok('цена в CZK' in r.hook_freq && !('цена в грн' in r.hook_freq));
  assert.equal(r.hook_freq['цена в CZK'], 1);
});

// ---- 2. local hooks ----
test('local: false drops the hooks of a business with a place and appointments from the free angles; skip_hooks drops any', () => {
  const rows = [ad('Tours', 20, 'Tour', 'Egypt for the whole family')];
  const local = Object.keys(buildReport(rows, { now: NOW }).hook_freq);
  for (const h of ['первый визит', 'до/после', 'запись/бронь', 'адрес/район']) assert.ok(local.includes(h), h);
  const online = Object.keys(buildReport(rows, { now: NOW, local: false }).hook_freq);
  for (const h of ['первый визит', 'до/после', 'запись/бронь', 'адрес/район']) assert.ok(!online.includes(h), h);
  assert.ok(online.includes('бесплатно') && online.includes('гарантия'));
  assert.ok(!Object.keys(buildReport(rows, { now: NOW, skipHooks: ['акция'] }).hook_freq).includes('акция'));
});

// ---- 3. query check for every slice ----
const ROWS = [
  ad('Laptop Shop', 120, 'Б/у ноутбуки с гарантией', 'ThinkPad Latitude EliteBook, проверка и гарантия 12 месяцев', 'ноутбуки б/у'),
  ad('Novel One', 120, 'Её мать была убита', 'Роман о предательстве. Читать сейчас', 'ноутбуки б/у'),
  ad('Novel Two', 119, 'Все ждали, когда магнат', 'Читать дальше', 'ноутбуки б/у'),
  ad('Clinic', 118, 'Лучшая клиника в Турции', 'Имплантация зубов', 'ноутбуки б/у')
];
const MANY = Array.from({ length: 30 }, (_, i) => ad('Noise ' + i, 100 + i, 'Роман часть ' + i, 'История любви и предательства', 'ноутбуки б/у')).concat([ROWS[0]]);

test('the query check is counted for every slice; it removes ads from the lists only when the niche asks for it', () => {
  const off = buildReport(MANY, { now: NOW });
  assert.deepEqual(off.query_check, { loose_ads: 30, ads_checked: 31, enforced: false });
  assert.ok(off.samples.some(x => x.page === 'Noise 0'), 'not enforced: the list is unchanged');
  const on = buildReport(MANY, { now: NOW, queryMatch: true });
  assert.equal(on.query_check.enforced, true);
  assert.ok(!on.samples.some(x => x.page.startsWith('Noise')), 'enforced: loose matches stay out');
  assert.ok(on.samples.some(x => x.page === 'Laptop Shop'));
  assert.equal(on.ads, 31, 'the counts hold every ad');
});

test('the city of a query is not required in the ad text', () => {
  const r = { title: 'Туры в Египет', body: 'Всё включено', link: '', kws: ['туры из Праги'] };
  assert.equal(queryMatch(r), false);
  assert.equal(queryMatch(r, null, ['Праги']), true);
  assert.equal(queryMatch(r, null, ['Прага']), true, 'the stem is compared, not the case form');
});

function snapshot(rows, extra = {}, curation) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nc-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'CZ', queries: ['ноутбуки б/у'], status: 'all', ...extra }));
  if (curation) writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curation));
  return dir;
}

test('report.js: a warning about the noise of the search for a slice that is not cleaned, none after curation', () => {
  const warn = loadSnapshot(snapshot(MANY)).warnings.find(w => w.code === 'loose_matches');
  assert.ok(warn);
  assert.match(warn.message, /30 из 31 объявлений \(97%\)/);
  assert.ok(!loadSnapshot(snapshot(MANY, {}, { include: { 'Laptop Shop': 'продавец' } })).warnings.some(w => w.code === 'loose_matches'));
});

test('niche.json: query_match, local: false and the cities of run.json reach the report', () => {
  const dir = snapshot(MANY, { cities: ['Прага'] });
  writeFileSync(path.join(dir, 'niche.json'), JSON.stringify({ title: 'Online', currency: 'CZK', local: false, query_match: true }));
  const s = loadSnapshot(dir);
  assert.equal(s.report.query_check.enforced, true);
  assert.equal(s.report.prices.currency, 'CZK');
  assert.ok(!('запись/бронь' in s.report.hook_freq));
  assert.ok(s.warnings.some(w => w.code === 'loose_excluded'));
  assert.ok(Object.values(s.query_match).includes(false));
});

// ---- 4. an empty market ----
test('after curation with two advertisers or fewer the market is called empty, with one honest next step', () => {
  const rows = [ad('Laptop Shop', 100, 'Б/у ноутбуки', 'ноутбуки б/у по цене 10 000 Kč', 'ноутбуки б/у', 'https://s.example/', false), ...MANY.slice(0, 5)];
  const s = loadSnapshot(snapshot(rows, {}, { include: { 'Laptop Shop': 'продавец' }, confirmed: true }));
  const w = s.warnings.find(x => x.code === 'empty_market');
  assert.ok(w, 'empty_market');
  assert.ok(!s.warnings.some(x => x.code === 'small_sample'));
  assert.match(w.message, /1 конкурентов и 0 активных объявлений \(остановленных: 1\)/);
  assert.deepEqual(s.next_steps.map(x => x.code), ['empty_market', 'compare']);
  assert.equal(s.next_steps[0].urgent, true);
});

test('without curation, or with more advertisers, nothing changes', () => {
  assert.ok(!loadSnapshot(snapshot(MANY.slice(0, 3))).warnings.some(w => w.code === 'empty_market'), 'not curated yet');
  const codes = nextSteps({ curated: true, empty_market: false, has_image_links: true }).map(x => x.code);
  assert.ok(codes.includes('sites') && !codes.includes('empty_market'));
});

test('Excel: the query column is on the ads sheet for every slice', { skip: spawnSync('python', ['-c', 'import openpyxl']).status !== 0 && 'openpyxl not installed' }, () => {
  const dir = snapshot(MANY);
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const out = spawnSync('python', ['-c', [
    'import sys',
    'from openpyxl import load_workbook',
    'ws = load_workbook(sys.argv[1])["Объявления"]',
    'heads = [c.value for c in ws[1]]',
    'col = heads.index("Слова запроса в тексте")',
    'vals = [str(r[col]) for r in ws.iter_rows(min_row=2, values_only=True)]',
    'print(sum(1 for v in vals if v.startswith("нет")), sum(1 for v in vals if v == "да"))'
  ].join('\n'), path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(out.stdout.trim(), '30 1');
});
