// meta-ads-niche-report: hardening found in the security review of 2026-10-10.
//  - check_sites.py: a redirect into a private network must never be requested
//    (network test, skipped without Playwright or internet)
//  - regexes over third-party text must not hang on a hostile page (ReDoS)
//  - HTML: third-party links without tracking parameters, client budget hidden
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const require = createRequire(import.meta.url);
const C = require(path.join(SCRIPTS, 'collector.js'));
const { buildHtml, cleanUrl } = require(path.join(SCRIPTS, 'export_html.js'));
const HAS_PYTHON = spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0;

test('check_sites: redirects into localhost, a router or a metadata address are never requested (SSRF)', { skip: !HAS_PYTHON && 'python is not installed', timeout: 240000 }, (t) => {
  const r = spawnSync('python', [path.join(__dirname, 'check_sites_ssrf.py'), SCRIPTS], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 240000 });
  if (r.status === 77) return t.skip((r.stdout || '').trim());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('hostile page text cannot hang the hook and price regexes (ReDoS)', () => {
  const attacks = ['1'.repeat(400000), '1 '.repeat(200000), '1.'.repeat(200000), 'before '.repeat(57000), '2 років '.repeat(50000)];
  for (const text of attacks) {
    const t0 = Date.now();
    for (const currency of ['UAH', 'USD', 'KZT']) C.siteFacts(text, { currency });
    const capped = text.slice(0, 30000).toLowerCase();
    for (const re of Object.values(C.HOOK_PATTERNS)) re.test(capped);
    assert.ok(Date.now() - t0 < 1000, 'too slow on ' + JSON.stringify(text.slice(0, 12)) + ': ' + (Date.now() - t0) + ' ms');
  }
});

test('payer flag: names stay out, a different payer is flagged', () => {
  assert.equal(C.payerDiffers('Brand GmbH', 'Payer GmbH'), true);
  assert.equal(C.payerDiffers('Brand GmbH', 'BRAND GMBH'), false);
  assert.equal(C.payerDiffers('', 'X'), null);
});

test('HTML: third-party links without tracking parameters', () => {
  assert.equal(cleanUrl('https://shop.example/p?fbclid=SECRET&utm_source=fb#x'), 'https://shop.example/p');
  assert.equal(cleanUrl('https://u:p@shop.example/'), '');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
});

const model = (over = {}) => ({
  report: { ads: 1, advertisers: 1, single_ad_advertisers: 1, formats: {}, doors: {}, ctas: {}, age_buckets: {}, hook_freq: {}, prices: {}, top_pages: [], longrun: [], creative_clusters: [], store_groups: [], hypothesis_inputs: {} },
  meta: { ts: 1790000000, country: 'UA', queries: ['q'] }, rows: [], warnings: [], query_stats: [], next_steps: [], ...over
});

test('HTML: the site-check link loses its tracking parameters; client budget and CPA only with --with-budget', () => {
  const sites = [{ page: 'A', ads: 1, landing: 'https://shop.example/p?fbclid=SECRET', final_url: 'https://shop.example/p?fbclid=SECRET&utm_campaign=x', title: 't', site: { prices: {} }, compare: {} }];
  const plan = { ranked: [], plan: { rounds: [{ round: 1, tests: [{ name: 'H1', variable_type: 'creative' }], budget: 74321 }], excluded: [], assumptions: { variants_per_test: 2, events_per_variant: 50, min_days_per_round: 7, target_cpa: 8123 } } };
  const html = buildHtml(model({ sites, plan, hypotheses: [{ name: 'H1', headline: 'h', primary_text: 't' }] }));
  assert.ok(!html.includes('SECRET') && !html.includes('fbclid'));
  assert.ok(!html.includes('74321') && !html.includes('8123'));
  const withBudget = buildHtml(model({ sites, plan, hypotheses: [{ name: 'H1', headline: 'h', primary_text: 't' }], withBudget: true }));
  assert.ok(withBudget.includes('74321') && withBudget.includes('8123'));
});
