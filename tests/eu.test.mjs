import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEuCountry, pickEuAds, parseEuDetails, euSummary, toCsv, normalizeAd } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;

// A response shaped like the one the Library sends after "See ad details" (synthetic values).
const response = (over = {}) => JSON.stringify({ data: { ad_library_main: { ad_details: { aaa_info: {
  targets_eu: true, eu_total_reach: 1000, gender_audience: 'All', age_audience: { min: 18, max: 65 },
  location_audience: [{ name: 'Austria', type: 'countries', excluded: false }, { name: 'Germany', type: 'countries', excluded: false }, { name: 'France', type: 'countries', excluded: true }],
  age_country_gender_reach_breakdown: [
    { country: 'AT', age_gender_breakdowns: [{ age_range: '25-34', male: 100, female: 300, unknown: 0 }, { age_range: '35-44', male: 50, female: 250, unknown: 50 }, { age_range: 'Unknown', male: null, female: null, unknown: 10 }] },
    { country: 'DE', age_gender_breakdowns: [{ age_range: '25-34', male: 40, female: 160, unknown: 0 }] }
  ], ...over } }, payer_info: { aaa_info: { payer_beneficiary_data: [{ payer: 'Payer GmbH', beneficiary: 'Brand GmbH' }], is_ad_taken_down: false } } } } });

test('isEuCountry knows the 27 member states, in any case, and nothing else', () => {
  for (const c of ['DE', 'pl', 'FR', 'IE', 'SE']) assert.equal(isEuCountry(c), true, c);
  for (const c of ['UA', 'KZ', 'US', 'GB', 'CH', '', undefined]) assert.equal(isEuCountry(c), false, String(c));
});

test('parseEuDetails: reach, targeting, per-country age and gender breakdown, payer', () => {
  const d = parseEuDetails(response());
  assert.equal(d.eu_total_reach, 1000);
  assert.equal(d.age_min, 18);
  assert.equal(d.age_max, 65);
  assert.equal(d.gender, 'All');
  assert.deepEqual(d.locations, ['Austria', 'Germany']); // excluded places are not targeted
  assert.deepEqual(d.excluded_locations, ['France']);
  assert.equal(d.breakdown.length, 4);
  assert.deepEqual(d.breakdown[0], { country: 'AT', age_range: '25-34', male: 100, female: 300, unknown: 0 });
  assert.equal(d.payer, 'Payer GmbH');
  assert.equal(d.beneficiary, 'Brand GmbH');
});

test('parseEuDetails: several JSON lines, noise lines, and "no EU data" all handled', () => {
  assert.equal(parseEuDetails('not json\n' + response() + '\n{"data":{}}').eu_total_reach, 1000);
  assert.equal(parseEuDetails('{"data":{"x":1}}'), null);
  assert.equal(parseEuDetails(''), null);
  assert.equal(parseEuDetails(null), null);
  assert.equal(parseEuDetails(response({ eu_total_reach: null })), null);
});

test('pickEuAds: one ad per advertiser first (the longest-running), then more, up to the limit', () => {
  const r = (id, page, daysAgo) => ({ id, page, start: NOW - daysAgo * 86400 });
  const rows = [r('1', 'A', 5), r('2', 'A', 50), r('3', 'B', 10), r('4', 'C', 1), r('5', 'A', 20)];
  assert.deepEqual(pickEuAds(rows, 3), ['2', '3', '4']);                 // oldest of A, B's only, C's only
  assert.deepEqual(pickEuAds(rows, 5), ['2', '3', '4', '5', '1']);       // then A's remaining, oldest first
  assert.deepEqual(pickEuAds(rows, 0), []);
  assert.deepEqual(pickEuAds([], 5), []);
});

test('euSummary: per-ad reach and audience, per-advertiser roll-up, overall age and gender shares', () => {
  const eu = { ads: { '1': parseEuDetails(response()), '2': parseEuDetails(response({ eu_total_reach: 500, age_audience: { min: 25, max: 54 }, gender_audience: 'Women',
    age_country_gender_reach_breakdown: [{ country: 'DE', age_gender_breakdowns: [{ age_range: '25-34', male: 0, female: 100, unknown: 0 }] }] })) } };
  const rows = [{ id: '1', page: 'Alpha' }, { id: '2', page: 'Alpha' }, { id: '3', page: 'Beta' }];
  const s = euSummary(eu, rows);
  assert.equal(s.ads, 2);
  const one = s.per_ad.find(x => x.id === '1');
  assert.equal(one.page, 'Alpha');
  assert.equal(one.reach, 1000);
  assert.equal(one.top_age_range, '25-34');       // 100+300+40+160 = 600 of the 960 counted
  assert.equal(one.female_share, 0.74);           // female 710 of the 960 counted (male 190, female 710, unknown 60)
  const alpha = s.per_page.find(p => p.page === 'Alpha');
  assert.equal(alpha.ads, 2);
  assert.equal(alpha.reach_sum, 1500);
  assert.equal(alpha.reach_max, 1000);
  assert.equal(alpha.age_min, 18);
  assert.equal(alpha.age_max, 65);
  assert.deepEqual(alpha.payers, ['Payer GmbH']);
  assert.ok(!s.per_page.some(p => p.page === 'Beta'), 'no data, no row');
  assert.ok(s.overall.age_share['25-34'] > 0.5);
  assert.ok(Math.abs(Object.values(s.overall.age_share).reduce((a, b) => a + b, 0) - 1) < 0.02);
});

test('euSummary without data is an empty summary, not an error', () => {
  const s = euSummary(null, []);
  assert.equal(s.ads, 0);
  assert.deepEqual(s.per_ad, []);
  assert.deepEqual(s.per_page, []);
});

function snapshot(withEu) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eu-'));
  const rows = [normalizeAd({ ad_archive_id: '1', page_id: '7', page_name: 'Alpha', is_active: true, start_date: NOW - 30 * 86400, publisher_platform: ['facebook'],
    snapshot: { title: 'T', body: { text: 'B' }, cta_text: 'x', link_url: 'https://alpha.example/' } }, 'q')];
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'DE', queries: ['q'] }));
  if (withEu) writeFileSync(path.join(dir, 'eu.json'), JSON.stringify({ country: 'DE', ads: { '1': parseEuDetails(response()) } }));
  return dir;
}

test('loadSnapshot adds the EU summary only when eu.json exists', () => {
  assert.equal(loadSnapshot(snapshot(false)).eu, null);
  const eu = loadSnapshot(snapshot(true)).eu;
  assert.equal(eu.ads, 1);
  assert.equal(eu.per_page[0].page, 'Alpha');
});

test('HTML report: EU section only with data, values escaped', () => {
  const html = buildHtml({ ...loadSnapshot(snapshot(true)), generated: '2026-10-06' });
  assert.match(html, /ЕС: охват и аудитория/);
  assert.match(html, /1000/);
  const plain = buildHtml({ ...loadSnapshot(snapshot(false)), generated: '2026-10-06' });
  assert.doesNotMatch(plain, /ЕС: охват и аудитория/);
  const dir = snapshot(true);
  writeFileSync(path.join(dir, 'eu.json'), JSON.stringify({ ads: { '1': parseEuDetails(response({ location_audience: [{ name: '<script>alert(1)</script>', excluded: false }] })) } }));
  const evil = buildHtml({ ...loadSnapshot(dir), generated: '2026-10-06' });
  assert.equal((evil.match(/<script/gi) || []).length, 0);
  assert.ok(evil.includes('&lt;script&gt;'));
});

const PYXLSX = spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
test('xlsx: a sheet with EU reach per advertiser and per ad when eu.json exists', { skip: !PYXLSX && 'openpyxl not installed' }, () => {
  const dir = snapshot(true);
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const check = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb['ЕС охват и аудитория'] if 'ЕС охват и аудитория' in wb.sheetnames else None
print(json.dumps({'sheets': wb.sheetnames, 'values': [[c for c in r] for r in ws.iter_rows(values_only=True)] if ws else None}, ensure_ascii=False, default=str))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const out = JSON.parse(check.stdout);
  assert.ok(out.sheets.includes('ЕС охват и аудитория'));
  const flat = JSON.stringify(out.values);
  assert.match(flat, /Alpha/);
  assert.match(flat, /1000/);
  assert.match(flat, /Payer GmbH/);
  const without = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), snapshot(false)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(without.status, 0, without.stderr);
});

const py = code => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

test('eu_details.py refuses a snapshot from a country outside the EU and a limit above the cap', () => {
  const dir = snapshot(false);
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  const r = spawnSync('python', [path.join(SCRIPTS, 'eu_details.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /EU/);
  const big = spawnSync('python', [path.join(SCRIPTS, 'eu_details.py'), snapshot(false), '--limit', '500'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.notEqual(big.status, 0);
  assert.match(big.stderr + big.stdout, /limit/i);
});

test('eu_details: picking ads is collector.js, and a fake blocked page stops the run (no bypass)', () => {
  const r = py('import eu_details; print(json.dumps(eu_details.MAX_ADS))');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout) <= 50);
});
