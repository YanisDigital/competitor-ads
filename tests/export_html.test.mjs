import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, normalizeAd } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { buildHtml, esc, safeUrl } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const NOW = 1_700_000_000;
const EVIL = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';

function model(overrides = {}) {
  const base = normalizeAd({
    ad_archive_id: '1', page_id: 'p1', page_name: EVIL, is_active: true, start_date: NOW - 100 * 86400, publisher_platform: ['facebook'],
    collation_count: 3, snapshot: { title: EVIL, body: EVIL, cta_text: EVIL, link_url: 'https://shop.example/x', display_format: 'VIDEO' }
  }, EVIL);
  const rows = [base, { ...base, id: '2', page: 'Other', title: 'plain', body: 'plain text', start: NOW - 5 * 86400 }];
  return { report: buildReport(rows, { now: NOW }), rows, meta: { ts: NOW, country: 'US', queries: [EVIL] }, generated: '2026-09-30', ...overrides };
}

test('esc and safeUrl neutralize markup and non-http links', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('https://example.com/a?b=1&c=2'), 'https://example.com/a?b=1&amp;c=2');
});

test('the report is one self-contained file: strict CSP, no scripts, no external resources', () => {
  const html = buildHtml(model());
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:/);
  assert.equal((html.match(/<script/gi) || []).length, 0);
  assert.equal((html.match(/<link\b/gi) || []).length, 0);
  assert.equal((html.match(/<iframe\b/gi) || []).length, 0);
  assert.ok(!/(src|href)="https?:[^"]*"[^>]*>/.test(html.replace(/<a [^>]*>/g, '')), 'no non-anchor element loads an http(s) resource');
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
});

test('untrusted ad text, page names and queries never reach the page as markup', () => {
  const html = buildHtml(model({
    sites: [{ page: EVIL, ads: 1, landing: 'javascript:alert(1)', final_url: 'javascript:alert(3)', title: EVIL, shopify: true, screenshot: 's.png', site: { prices: { min: 1, max: 2 } }, compare: { promised_not_on_site: [EVIL], on_site_not_advertised: [EVIL] } }],
    hypotheses: [{ name: EVIL, angle: EVIL, evidence: [EVIL], headline: EVIL, primary_text: EVIL, cta: EVIL, destination: EVIL, format: EVIL, test: EVIL, metric: EVIL, risk: EVIL, confirm_with_client: EVIL }],
    images: { 's.png': 'data:image/png;base64,AAAA"><script>alert(4)</script>' }
  }));
  assert.equal((html.match(/<script/gi) || []).length, 0);
  assert.equal((html.match(/<img\b/gi) || []).length, 1); // only the embedded screenshot, none from ad text
  assert.ok(!/<[^>]*\son\w+\s*=/i.test(html), 'no tag carries an event-handler attribute');
  assert.ok(/<[^>]*\son\w+\s*=/i.test('<img src=x onerror=alert(2)>'), 'the check itself detects a real handler');
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('optional sections appear only when their data exists', () => {
  const plain = buildHtml(model());
  assert.doesNotMatch(plain, /Гипотезы объявлений|Сайты лидеров|Изменения с прошлого среза/);
  const full = buildHtml(model({
    hypotheses: [{ name: 'H1', headline: 'h', primary_text: 't' }],
    plan: { ranked: [{ name: 'H1', rank: 1, score: 2, blockers: ['needs a fact'] }], plan: { rounds: [{ round: 1, tests: [{ name: 'H1', variable_type: 'creative' }], budget: 3600 }], assumptions: { variants_per_test: 2, events_per_variant: 50, min_days_per_round: 7, target_cpa: 18 } } },
    lint: { results: [{ name: 'H1', findings: [{ severity: 'error', message: 'bad claim' }, { severity: 'info', message: 'fyi' }] }] },
    diff: { interval_days: 14, prev_ads: 10, curr_ads: 12, survived: 8, new_ads: { count: 4 }, stopped: { count: 2, high_confidence: 1 }, young_tests: { gone: 1, ads: 5 }, scaling: [], dynamics: { scaling_hooks: [{ hook: 'x', ads: 2, strength: 'weak' }], failed_hooks: [] } }
  }));
  assert.match(full, /Гипотезы объявлений/);
  assert.match(full, /#1 · H1/);
  assert.match(full, /bad claim/);
  assert.doesNotMatch(full, /fyi/); // info-level lint stays out of the report
  assert.match(full, /needs a fact/);
  assert.match(full, /План теста/);
  assert.match(full, /Изменения с прошлого среза \(14 дн\.\)/);
});

test('percentages in bars stay within 0-100 even if data is inconsistent', () => {
  const m = model();
  m.report.formats = { VIDEO: 9999 };
  const html = buildHtml(m);
  const widths = [...html.matchAll(/style="width:(\d+)%"/g)].map(x => +x[1]);
  assert.ok(widths.length > 0 && widths.every(w => w >= 0 && w <= 100));
});
