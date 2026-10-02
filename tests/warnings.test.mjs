import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonWarnings, snapshotWarnings, suggestQueries, queryLang, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const ts = (iso) => Date.parse(iso + 'T12:00:00Z') / 1000;

test('seasonWarnings: inside a window, outside, and a window that wraps the new year', () => {
  const seasons = [
    { name: 'Oktoberfest', from: '09-15', to: '10-31', note: 'event peak' },
    { name: 'New Year', from: '12-15', to: '01-10', note: 'gift peak' }
  ];
  assert.deepEqual(seasonWarnings(ts('2026-10-02'), seasons).map(w => w.name), ['Oktoberfest']);
  assert.deepEqual(seasonWarnings(ts('2026-11-20'), seasons), []);
  assert.deepEqual(seasonWarnings(ts('2027-01-05'), seasons).map(w => w.name), ['New Year']);
  assert.deepEqual(seasonWarnings(ts('2026-12-20'), seasons).map(w => w.name), ['New Year']);
  assert.deepEqual(seasonWarnings(ts('2026-10-02'), undefined), []);
  assert.equal(seasonWarnings(ts('2026-10-31'), seasons).length, 1); // window ends are inclusive
});

const STATS = [
  { query: 'a', ads: 30, advertisers: 12, relevant_advertisers: 2, rate_limited: true },
  { query: 'b', ads: 5, advertisers: 4, relevant_advertisers: 0, rate_limited: false },
  { query: 'c', ads: 0, advertisers: 0, relevant_advertisers: 0, rate_limited: false }
];

test('snapshotWarnings: small sample, rate limit, empty queries, season and policy each raise their own warning', () => {
  const w = snapshotWarnings({ advertisers: 8, queryStats: STATS, ts: ts('2026-10-02'),
    preset: { seasons: [{ name: 'Oktoberfest', from: '09-15', to: '10-31', note: 'event peak' }], policy: 'Alcohol ads are restricted.' } });
  const codes = w.map(x => x.code);
  assert.deepEqual(codes.sort(), ['empty_queries', 'policy', 'rate_limited', 'seasonal', 'small_sample']);
  const by = Object.fromEntries(w.map(x => [x.code, x]));
  assert.match(by.small_sample.message, /8/);
  assert.match(by.rate_limited.message, /1 из 3/);
  assert.match(by.empty_queries.message, /c/);
  assert.match(by.seasonal.message, /Oktoberfest/);
  assert.equal(by.policy.message, 'Alcohol ads are restricted.');
});

test('snapshotWarnings: a big clean sample outside any season gives no warnings', () => {
  const clean = [{ query: 'a', ads: 40, advertisers: 20, relevant_advertisers: null, rate_limited: false }];
  assert.deepEqual(snapshotWarnings({ advertisers: 25, queryStats: clean, ts: ts('2026-05-10'), preset: null }), []);
  assert.deepEqual(snapshotWarnings({ advertisers: 25, queryStats: clean, ts: ts('2026-05-10'), preset: { seasons: [{ name: 'x', from: '12-01', to: '12-10' }] } }), []);
});

test('queryLang: Russian-only letters mean ru, everything else uk', () => {
  assert.equal(queryLang('крафтовое пиво'), 'ru');
  assert.equal(queryLang('крафтове пиво'), 'uk');
  assert.equal(queryLang('craft beer'), 'uk');
  assert.equal(queryLang('пиво IPA'), 'uk');
});

test('suggestQueries keeps a query only if it found at least one competitor and explains each dropped one', () => {
  const stats = [
    { query: 'крафтове пиво', ads: 9, advertisers: 8, relevant_advertisers: 1, rate_limited: true },
    { query: 'крафтовое пиво', ads: 0, advertisers: 0, relevant_advertisers: 0, rate_limited: false },
    { query: 'пивоварня', ads: 6, advertisers: 5, relevant_advertisers: 0, rate_limited: false },
    { query: 'пиво з доставкою', ads: 8, advertisers: 5, relevant_advertisers: 3, rate_limited: true }
  ];
  const s = suggestQueries(stats);
  assert.equal(s.curated, true);
  assert.deepEqual(s.keep.map(x => x.query), ['крафтове пиво', 'пиво з доставкою']);
  assert.equal(s.keep[0].weak, true);   // 1 of 8 advertisers is a competitor
  assert.equal(s.keep[1].weak, false);
  assert.deepEqual(s.drop, [{ query: 'крафтовое пиво', reason: 'no ads' }, { query: 'пивоварня', reason: 'no competitors' }]);
  assert.deepEqual(s.preset_services, [{ uk: 'крафтове пиво' }, { uk: 'пиво з доставкою' }]);
  assert.deepEqual(s.languages, ['uk']);
});

test('suggestQueries cannot judge without curation', () => {
  const s = suggestQueries([{ query: 'a', ads: 3, advertisers: 2, relevant_advertisers: null, rate_limited: false }]);
  assert.equal(s.curated, false);
  assert.deepEqual(s.keep, []);
});

test('suggestQueries puts Russian-only queries under ru and lists both languages', () => {
  const s = suggestQueries([
    { query: 'маникюр Одесса', ads: 5, advertisers: 3, relevant_advertisers: 2, rate_limited: false },
    { query: 'манікюр Одеса', ads: 9, advertisers: 6, relevant_advertisers: 4, rate_limited: false }
  ]);
  assert.deepEqual(s.preset_services, [{ ru: 'маникюр Одесса' }, { uk: 'манікюр Одеса' }]);
  assert.deepEqual(s.languages, ['uk', 'ru']);
});

function snapshot(preset, date, rows) {
  const dir = mkdtempSync(path.join(tmpdir(), 'warn-'));
  const base = { page_id: '1', fmt: 'IMAGE', variants: 1, cta: 'Learn more', link: 'https://x.example/', platforms: 'facebook', title: 't', body: 'b', start: ts(date) - 86400 * 20, active: true };
  const data = rows || [{ ...base, id: '1', page: 'A', kws: ['q1'] }, { ...base, id: '2', page: 'B', kws: ['q2'] }];
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(data));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: date + 'T12:00:00Z', country: 'UA', preset, queries: ['q1', 'q2', 'q3'], rate_limited_queries: ['q2'] }));
  return dir;
}

test('loadSnapshot returns warnings from the preset: season and policy for craft beer in October', () => {
  const snap = loadSnapshot(snapshot('craft-beer-ua', '2026-10-02'));
  const codes = snap.warnings.map(w => w.code);
  assert.ok(codes.includes('seasonal'), 'Oktoberfest window');
  assert.ok(codes.includes('policy'), 'alcohol note');
  assert.ok(codes.includes('small_sample'), 'only 2 advertisers');
  assert.ok(codes.includes('rate_limited'));
  assert.ok(codes.includes('empty_queries'));
});

test('loadSnapshot: a preset without seasons or policy only gets data-driven warnings', () => {
  const snap = loadSnapshot(snapshot('beauty', '2026-10-02'));
  assert.ok(!snap.warnings.some(w => w.code === 'seasonal' || w.code === 'policy'));
});

test('html report shows the warnings and escapes them', () => {
  const snap = loadSnapshot(snapshot('craft-beer-ua', '2026-10-02'));
  snap.warnings.push({ code: 'x', severity: 'warn', message: '<script>alert(1)</script>' });
  const html = buildHtml({ ...snap, generated: '2026-10-02' });
  assert.match(html, /Предупреждения/);
  assert.match(html, /Октоберфест/);
  assert.equal((html.match(/<script/gi) || []).length, 0);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('suggest_queries.js prints keep/drop and a ready preset services list', () => {
  const dir = snapshot('beauty', '2026-10-02');
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ include: { A: 'competitor' } }));
  const res = spawnSync('node', [path.join(SCRIPTS, 'suggest_queries.js'), dir], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.keep.map(k => k.query), ['q1']);
  assert.deepEqual(out.drop.map(d => d.query).sort(), ['q2', 'q3']);
  assert.deepEqual(out.preset_services, [{ uk: 'q1' }]);
});
