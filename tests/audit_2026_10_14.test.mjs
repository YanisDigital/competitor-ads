// Findings of the privacy and security audit of 2026-10-14: preset regexes that backtrack on hostile text, niche.json regexes
// and own flags, web links only in the Excel product sheet, batches never mixed into another snapshot.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PLUGINS = path.join(__dirname, '..', 'plugins');
const SKILL = p => path.join(PLUGINS, p, 'skills', p);
const META = SKILL('meta-ads-niche-report');
const TIKTOK = SKILL('tiktok-ads-niche-report');
const M = require(path.join(META, 'scripts', 'collector.js'));
const { loadSnapshot, loadNicheConfig } = require(path.join(META, 'scripts', 'report.js'));

const vm = require('vm');
const HOSTILE = ['1'.repeat(40) + '!', 'a'.repeat(40) + '!', '1 '.repeat(30) + '!', 'a-'.repeat(30) + '!', 'ab'.repeat(30) + '!', '1'.repeat(30000), 'a'.repeat(30000), '1 '.repeat(15000), 'aaaa-'.repeat(6000)];
// true when the expression takes more than 150 ms on one of the inputs (a vm timeout stops an exponential one)
const isSlow = (src, flags) => HOSTILE.some(a => {
  const t = Date.now();
  try { vm.runInNewContext('new RegExp(src, flags).test(a)', { src, flags, a }, { timeout: 400 }); } catch (e) { if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return true; throw e; }
  return Date.now() - t > 150;
});

test('every regular expression of every preset (both plugins) stays fast on hostile text', () => {
  const slow = [];
  for (const [name, root, flags] of [['meta', META, 'i'], ['tiktok', TIKTOK, 'u']]) {
    for (const f of readdirSync(path.join(root, 'presets'))) {
      const p = JSON.parse(readFileSync(path.join(root, 'presets', f), 'utf8'));
      const groups = { ...(p.extra_hooks || {}), ...(p.products ? { ...p.products.red_flags, ...p.products.page_name_flags, ...p.products.soft_flags } : {}) };
      for (const [k, src] of Object.entries(groups)) {
        if (isSlow(src, flags)) slow.push(`${name}/${f}: "${k}"`);
      }
    }
  }
  assert.deepEqual(slow, []);
});

test('the base hooks of both plugins stay fast on hostile text', () => {
  const T = require(path.join(TIKTOK, 'scripts', 'collector.js'));
  for (const C of [M, T]) for (const [k, re] of Object.entries(C.HOOK_PATTERNS)) assert.ok(!isSlow(re.source, re.flags), k);
});

function niche(content) {
  const dir = mkdtempSync(path.join(tmpdir(), 'au-'));
  writeFileSync(path.join(dir, 'ads.csv'), M.toCsv([]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ preset: 'ecom-problem-solvers-us' }));
  writeFileSync(path.join(dir, 'niche.json'), JSON.stringify(content));
  return dir;
}

test('niche.json: a regular expression that backtracks is refused, in both plugins', () => {
  assert.throws(() => loadNicheConfig(niche({ extra_hooks: { evil: '(\\d+)+$' } })), /too slow on a hostile text/);
  assert.throws(() => loadNicheConfig(niche({ products: { red_flags: { evil: '^(a+)+$' } } })), /products\.red_flags "evil" is too slow/);
  assert.doesNotThrow(() => loadNicheConfig(niche({ extra_hooks: { ok: '\\d{1,6}\\s?kg' } })));
  const T = require(path.join(TIKTOK, 'scripts', 'report.js'));
  const dir = mkdtempSync(path.join(tmpdir(), 'au-tt-'));
  writeFileSync(path.join(dir, 'run.json'), '{}');
  writeFileSync(path.join(dir, 'niche.json'), JSON.stringify({ extra_hooks: { evil: '(\\d+)+$' } }));
  assert.throws(() => T.loadNicheConfig(dir), /too slow on a hostile text/);
});

test('niche.json: your own flags (brands, categories) are added to the preset flags, not instead of them', () => {
  const cfg = loadNicheConfig(niche({ products: { red_flags: { 'свой бренд': '\\b(acme brand)\\b' }, soft_flags: { 'свой': '\\bmild\\b' } } })).config;
  assert.ok(cfg.products.red_flags['свой бренд'], 'the own flag is there');
  assert.ok(cfg.products.red_flags['здоровье/медицина'] && cfg.products.red_flags['известный бренд'], 'the preset flags stay');
  assert.ok(cfg.products.soft_flags['свой'] && cfg.products.soft_flags['обещание здоровья (мягкое)']);
  assert.equal(cfg.products.min_days, 7, 'the other products settings stay');
  const NOW = 1_790_000_000;
  const ad = (id, page) => M.normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: page, is_active: true, start_date: NOW - 20 * 86400, end_date: NOW, publisher_platform: ['facebook'], collation_count: 1,
    snapshot: { title: 'Drain cover', body: { text: 'Fits every shower drain, a Acme Brand original' }, cta_text: 'x', link_url: 'https://s' + id + '.example/products/drain-cover', display_format: 'IMAGE' } }, 'drain cover');
  const dir = niche({ products: { red_flags: { 'свой бренд': '\\b(acme brand)\\b' } } });
  writeFileSync(path.join(dir, 'ads.csv'), M.toCsv([ad('1', 'Store A'), ad('2', 'Store B')]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['drain cover'], preset: 'ecom-problem-solvers-us' }));
  const r = loadSnapshot(dir).report.products;
  assert.ok(r.excluded_pages.some(e => e.flags.includes('свой бренд')), 'the page of your own brand flag is left out');
});

test('product store links are web links only (the Excel sheet and the report)', { skip: spawnSync('python', ['-c', 'import openpyxl']).status !== 0 && 'openpyxl not installed' }, () => {
  const NOW = 1_790_000_000;
  const ad = (id, link) => M.normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: 'S' + id, is_active: true, start_date: NOW - 20 * 86400, end_date: NOW, publisher_platform: ['facebook'], collation_count: 1,
    snapshot: { title: 'Same copy for a product here', body: { text: 'Same body text of the product for the test' }, cta_text: 'x', link_url: link, display_format: 'IMAGE' } }, 'q');
  const rows = [ad('1', 'file:///C:/Windows/products/x'), ad('2', 'javascript:alert(1)//products/y')];
  const top = M.earlyProducts(rows, { now: NOW, config: {} }).top;
  assert.deepEqual(top.flatMap(p => p.store_urls), []);
  const dir = mkdtempSync(path.join(tmpdir(), 'au-x-'));
  writeFileSync(path.join(dir, 'ads.csv'), M.toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'US', queries: ['q'], preset: 'ecom-problem-solvers-us' }));
  const res = spawnSync('python', [path.join(META, 'scripts', 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
});

test('--pages-of in batches refuses a folder that already holds another snapshot', { skip: spawnSync('python', ['--version']).status !== 0 && 'python is not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'au-b-'));
  writeFileSync(path.join(dir, 'source.csv'), M.toCsv([]));
  const r = spawnSync('python', [path.join(__dirname, 'pages_batches_harness.py'), path.join(META, 'scripts'), path.join(dir, 'source.csv'), path.join(dir, 'out'), 'foreign'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const res = JSON.parse(r.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop());
  assert.deepEqual(res.rc, [2]);
  assert.equal(res.calls, 0, 'no batch was run');
  assert.equal(res.kept.trim(), 'id', 'the other snapshot is untouched');
  assert.match(r.stdout, /already holds another snapshot/);
});
