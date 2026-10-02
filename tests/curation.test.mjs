import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyCuration, queryStats, buildReport, toCsv, normalizeAd } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const NOW = 1_700_000_000;
const row = (id, page, kws, extra = {}) => ({
  id, page, page_id: 'p' + id, start: NOW - 30 * 86400, active: true, fmt: 'IMAGE', variants: 1, cta: 'Learn more',
  link: 'https://' + page.toLowerCase().replace(/\W+/g, '') + '.example/', platforms: 'facebook', kws, title: 'title ' + id, body: 'body ' + id, ...extra
});
const ROWS = [
  row('1', 'Brewery A', ['craft beer', 'beer delivery']),
  row('2', 'Brewery A', ['craft beer']),
  row('3', 'Shop B', ['beer delivery']),
  row('4', 'Bath House', ['beer delivery']),
  row('5', 'Glassware', ['craft beer'])
];

test('applyCuration: no curation file means rows pass through untouched', () => {
  const r = applyCuration(ROWS, null);
  assert.equal(r.rows.length, ROWS.length);
  assert.equal(r.excluded_ads, 0);
  assert.deepEqual(r.excluded_pages, []);
  assert.deepEqual(r.types, {});
});

test('applyCuration: exclude list removes whole advertisers and reports unknown names', () => {
  const r = applyCuration(ROWS, { exclude: ['Bath House', 'Glassware', 'Typo Page'] });
  assert.deepEqual(r.rows.map(x => x.id), ['1', '2', '3']);
  assert.equal(r.excluded_ads, 2);
  assert.deepEqual(r.excluded_pages, ['Bath House', 'Glassware']);
  assert.deepEqual(r.not_found, ['Typo Page']);
});

test('applyCuration: include is a whitelist and its values become the advertiser types', () => {
  const r = applyCuration(ROWS, { include: { 'Brewery A': 'producer', 'Shop B': 'shop', 'Missing': 'x' } });
  assert.deepEqual(r.rows.map(x => x.id), ['1', '2', '3']);
  assert.deepEqual(r.excluded_pages, ['Bath House', 'Glassware']);
  assert.deepEqual(r.types, { 'Brewery A': 'producer', 'Shop B': 'shop', Missing: 'x' });
  assert.deepEqual(r.not_found, ['Missing']);
});

test('applyCuration: types without include keep every advertiser and only label them', () => {
  const r = applyCuration(ROWS, { types: { 'Brewery A': 'producer' }, exclude: ['Glassware'] });
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.types, { 'Brewery A': 'producer' });
});

test('queryStats: per query ads, advertisers, relevant share and rate limit; zero-result queries stay visible', () => {
  const kept = applyCuration(ROWS, { include: { 'Brewery A': 'p', 'Shop B': 's' } }).rows;
  const s = queryStats(ROWS, kept, { queries: ['craft beer', 'beer delivery', 'dead query'], rateLimited: ['beer delivery'], curated: true });
  const by = Object.fromEntries(s.map(x => [x.query, x]));
  assert.deepEqual(s.map(x => x.query), ['craft beer', 'beer delivery', 'dead query']); // run order
  assert.deepEqual([by['craft beer'].ads, by['craft beer'].advertisers, by['craft beer'].relevant_advertisers], [3, 2, 1]);
  assert.deepEqual([by['beer delivery'].ads, by['beer delivery'].advertisers, by['beer delivery'].relevant_advertisers], [3, 3, 2]);
  assert.equal(by['beer delivery'].rate_limited, true);
  assert.equal(by['craft beer'].rate_limited, false);
  assert.deepEqual([by['dead query'].ads, by['dead query'].advertisers, by['dead query'].relevant_advertisers], [0, 0, 0]);
});

test('queryStats: without curation the relevant columns are null, not zero', () => {
  const s = queryStats(ROWS, ROWS, { queries: ['craft beer'], curated: false });
  assert.equal(s[0].relevant_advertisers, null);
});

function snapshot(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'snap-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(ROWS));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['craft beer', 'beer delivery', 'dead query'], rate_limited_queries: ['beer delivery'] }));
  for (const [name, body] of Object.entries(files || {})) writeFileSync(path.join(dir, name), JSON.stringify(body));
  return dir;
}

test('loadSnapshot without curation.json: same report as before, no curation block', () => {
  const dir = snapshot();
  const snap = loadSnapshot(dir);
  assert.deepEqual(snap.report, buildReport(snap.rows, { longDays: 90, now: NOW }));
  assert.equal(snap.rows.length, ROWS.length);
  assert.equal(snap.meta.curation, undefined);
  assert.equal(snap.query_stats.find(q => q.query === 'craft beer').relevant_advertisers, null);
});

test('loadSnapshot with curation.json: report built from the kept advertisers, curation summarized in meta', () => {
  const dir = snapshot({ 'curation.json': { include: { 'Brewery A': 'Производитель', 'Shop B': 'Магазин' }, notes: 'checked by hand' } });
  const snap = loadSnapshot(dir);
  assert.equal(snap.report.ads, 3);
  assert.equal(snap.report.advertisers, 2);
  assert.deepEqual(snap.rows.map(r => r.id).sort(), ['1', '2', '3']);
  assert.equal(snap.meta.curation.excluded_ads, 2);
  assert.deepEqual(snap.meta.curation.excluded_pages, ['Bath House', 'Glassware']);
  assert.equal(snap.meta.curation.types['Brewery A'], 'Производитель');
  assert.equal(snap.meta.curation.notes, 'checked by hand');
  const q = Object.fromEntries(snap.query_stats.map(x => [x.query, x]));
  assert.equal(q['beer delivery'].relevant_advertisers, 2);
  assert.equal(q['beer delivery'].rate_limited, true);
  assert.equal(q['dead query'].ads, 0);
});

test('html report shows advertiser types, query statistics and the curation note only when they exist', () => {
  const dir = snapshot({ 'curation.json': { include: { 'Brewery A': 'Производитель', 'Shop B': 'Магазин' } } });
  const html = buildHtml({ ...loadSnapshot(dir), generated: '2026-10-02' });
  assert.match(html, /Производитель/);
  assert.match(html, /Запросы: что нашли/);
  assert.match(html, /dead query/);
  assert.match(html, /убрано вручную/);
  const plain = buildHtml({ ...loadSnapshot(snapshot()), generated: '2026-10-02' });
  assert.doesNotMatch(plain, /убрано вручную|Тип/);
});

test('curation values are escaped in the html report', () => {
  const evil = '<script>alert(1)</script>';
  const dir = snapshot({ 'curation.json': { include: { 'Brewery A': evil } } });
  const html = buildHtml({ ...loadSnapshot(dir), generated: '2026-10-02' });
  assert.equal((html.match(/<script/gi) || []).length, 0);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
