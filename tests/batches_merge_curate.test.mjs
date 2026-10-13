// 0.15.8: --pages-of in batches into one folder (and the resume after a captcha), merge.js, "disputed" in curation.json,
// curate.js list and report.js --save.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv, applyCuration } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';
import { mergeSlices } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/merge.js';
import { listAdvertisers } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/curate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const HAS_PYTHON = spawnSync('python', ['--version']).status === 0;
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 3000;
const ad = (page, daysAgo = 20, query = 'q', active = true, link = 'https://shop.example/products/x') => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page.replace(/\D/g, ''), page_name: page, is_active: active, start_date: NOW - daysAgo * DAY, end_date: active ? NOW : NOW - DAY, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title: 'Title of ' + page, body: { text: 'Body text of ' + page }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, query);
const tmp = p => mkdtempSync(path.join(tmpdir(), p));
const slice = (rows, run = {}) => {
  const d = tmp('bmc-');
  writeFileSync(path.join(d, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(d, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['q'], status: 'active', search_type: 'any_words', ...run }));
  return d;
};

// ---- merge.js ----
test('merge: one row per ad, queries joined, run.json queries united, report rebuilt, curation copied', () => {
  const a = slice([ad('Page 01', 20, 'clogged drain'), ad('Page 02', 20, 'clogged drain')], { queries: ['clogged drain'] });
  const dupe = ad('Page 01', 20, 'dryer lint');
  const first = parseCsv(readFileSync(path.join(a, 'ads.csv'), 'utf8'))[0];
  const b = slice([{ ...dupe, id: first.id }, ad('Page 03', 20, 'dryer lint')], { queries: ['dryer lint'], blocked: 'captcha', queries_remaining: ['x'], queries_planned: 9 });
  writeFileSync(path.join(a, 'curation.json'), JSON.stringify({ include: { 'Page 01': 'seller' } }));
  const out = path.join(tmp('bmc-out-'), 'merged');
  const r = mergeSlices(out, [a, b]);
  assert.equal(r.rows, 3);
  const rows = parseCsv(readFileSync(path.join(out, 'ads.csv'), 'utf8'));
  assert.deepEqual(rows.find(x => x.id === first.id).kws.sort(), ['clogged drain', 'dryer lint']);
  const run = JSON.parse(readFileSync(path.join(out, 'run.json'), 'utf8'));
  assert.deepEqual(run.queries, ['clogged drain', 'dryer lint']);
  assert.equal(run.blocked, 'captcha', 'the state of the last folder');
  assert.equal(run.merged_from.length, 2);
  assert.ok(JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')).ads === 3);
  assert.ok(existsSync(path.join(out, 'curation.json')));
});

test('merge: the out folder is the first source, a complete last batch clears the partial state, slices that differ are refused', () => {
  const base = slice([ad('Page 01')], { queries: ['page: Page 01'], blocked: 'captcha', queries_remaining: ['page: Page 02'], queries_planned: 2 });
  const batch = slice([ad('Page 02')], { queries: ['page: Page 02'] });
  const r = mergeSlices(base, [batch]);
  assert.equal(r.rows, 2);
  const run = JSON.parse(readFileSync(path.join(base, 'run.json'), 'utf8'));
  assert.ok(!('blocked' in run) && !('queries_remaining' in run));
  assert.deepEqual(run.queries, ['page: Page 01', 'page: Page 02']);
  const other = slice([ad('Page 09')], { country: 'DE' });
  assert.throws(() => mergeSlices(tmp('o-'), [base, other]), /not comparable: "country"/);
  assert.doesNotThrow(() => mergeSlices(tmp('o-'), [base, other], { force: true }));
});

// ---- disputed ----
const ROWS = [ad('Seller'), ad('Mixed Shop'), ad('Mixed Shop'), ad('Noise')];
test('disputed: not counted as competitors, listed with the reason and the ads', () => {
  const c = applyCuration(ROWS, { include: { Seller: 'seller', 'Mixed Shop': 'seller?' }, disputed: { 'Mixed Shop': 'new and used range', Ghost: 'typo' } });
  assert.deepEqual([...new Set(c.rows.map(r => r.page))], ['Seller']);
  assert.deepEqual(c.disputed.map(d => [d.page, d.why, d.ads, d.active]), [['Mixed Shop', 'new and used range', 2, 2]]);
  assert.ok(c.not_found.includes('Ghost'), 'a typo in disputed is reported');
  assert.deepEqual(applyCuration(ROWS, { disputed: { Noise: { why: 'object form' } } }).disputed.map(d => d.why), ['object form']);
  assert.deepEqual(applyCuration(ROWS, null).disputed, []);
});

test('disputed: shown in the HTML report and in the Excel sheet "Спорные"', { skip: spawnSync('python', ['-c', 'import openpyxl']).status !== 0 && 'openpyxl not installed' }, () => {
  const d = slice(ROWS);
  writeFileSync(path.join(d, 'curation.json'), JSON.stringify({ include: { Seller: 'seller', 'Mixed Shop': 'x' }, disputed: { 'Mixed Shop': 'new and used range' } }));
  const html = buildHtml({ ...loadSnapshot(d), images: {}, generated: '2026-10-13' });
  assert.match(html, /<h2>Спорные рекламодатели \(не учтены\)<\/h2>/);
  assert.match(html, /new and used range/);
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), d], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const out = spawnSync('python', ['-c', 'import sys\nfrom openpyxl import load_workbook\nws = load_workbook(sys.argv[1])["Спорные"]\nprint("|".join(str(c.value) for c in ws[2]))', path.join(d, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.match(out.stdout, /^Mixed Shop\|2\|2\|new and used range\|/);
});

// ---- curate.js list ----
test('curate list: advertisers with counts, door, site and the decision already written', () => {
  const d = slice([...ROWS, ad('Old Ads', 100, 'q', false, '')]);
  writeFileSync(path.join(d, 'curation.json'), JSON.stringify({ include: { Seller: 'seller' }, exclude: ['Noise'], disputed: { 'Mixed Shop': 'why' } }));
  const list = listAdvertisers(d);
  const by = Object.fromEntries(list.map(x => [x.page, x]));
  assert.equal(list[0].page, 'Mixed Shop', 'most ads first');
  assert.equal(by['Mixed Shop'].ads, 2);
  assert.equal(by['Mixed Shop'].site, 'shop.example');
  assert.match(by['Mixed Shop'].status, /^спорный: why/);
  assert.equal(by.Seller.status, 'конкурент: seller');
  assert.equal(by.Noise.status, 'исключён');
  assert.equal(by['Old Ads'].active, 0);
  assert.equal(list.filter(x => !x.decided).map(x => x.page).join(), 'Old Ads');
  const r = spawnSync('node', [path.join(SCRIPTS, 'curate.js'), 'list', d, '--undecided', '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).matching, 1);
});

// ---- report.js --save ----
test('report.js --save writes the report after curation to a file (no throwaway script)', () => {
  const d = slice(ROWS);
  writeFileSync(path.join(d, 'curation.json'), JSON.stringify({ include: { Seller: 'seller' } }));
  const r = spawnSync('node', [path.join(SCRIPTS, 'report.js'), d, '--save'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Saved: .*report_full\.json/);
  const full = JSON.parse(readFileSync(path.join(d, 'report_full.json'), 'utf8'));
  assert.equal(full.report.advertisers, 1, 'after curation');
  const named = path.join(d, 'x.json');
  assert.equal(spawnSync('node', [path.join(SCRIPTS, 'report.js'), d, '--save', named], { encoding: 'utf8' }).status, 0);
  assert.ok(existsSync(named));
  const plain = spawnSync('node', [path.join(SCRIPTS, 'report.js'), d], { encoding: 'utf8' });
  assert.ok(JSON.parse(plain.stdout).report, 'without --save the JSON still goes to stdout');
});

// ---- --pages-of in batches ----
function batchRun(scenario) {
  const dir = tmp('pb-');
  const rows = [];
  for (let i = 1; i <= 35; i++) rows.push(ad('Page ' + String(i).padStart(2, '0'), 20, 'page: Page ' + String(i).padStart(2, '0')), ad('Page ' + String(i).padStart(2, '0'), 30, 'page: Page ' + String(i).padStart(2, '0')));
  writeFileSync(path.join(dir, 'source.csv'), toCsv(rows));
  const out = path.join(dir, 'out');
  const r = spawnSync('python', [path.join(__dirname, 'pages_batches_harness.py'), SCRIPTS, path.join(dir, 'source.csv'), out, scenario], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const line = r.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
  assert.ok(line, r.stdout + r.stderr);
  return JSON.parse(line);
}

test('--pages-of with 35 pages: batches of 15 into one folder with a pause between them', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const r = batchRun('ok');
  assert.deepEqual(r.rc, [0]);
  assert.equal(r.calls, 3, 'three batches, not one run of 35 queries');
  assert.deepEqual(r.sleeps, [30, 30], 'a pause between the batches');
  assert.equal(r.queries, 35);
  assert.equal(r.pages, 35);
  assert.equal(r.ads, 70);
  assert.deepEqual(r.state, [], 'no partial state');
  assert.deepEqual(r.leftovers, [], 'the batch folders are gone');
});

test('a captcha in batch 2 stops the run with what was collected; the same command continues with the pages that are left', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const r = batchRun('resume');
  assert.deepEqual(r.rc, [3, 0]);
  assert.equal(r.after_first.queries.length, 18, 'batch 1 (15) and 3 pages of batch 2');
  assert.equal(r.after_first.queries_remaining.length, 17);
  assert.match(r.after_first.blocked, /captcha/);
  assert.equal(r.after_first.queries_planned, 35);
  assert.equal(r.calls, 4, 'two batches before the block, then the 17 left in two more');
  assert.equal(r.pages, 35);
  assert.equal(r.ads, 70, 'no ad twice');
  assert.deepEqual(r.state, [], 'the finished run has no blocked state');
});
