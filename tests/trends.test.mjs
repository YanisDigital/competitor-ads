// Google Trends for a niche (scripts/trends.js): the curve status, the season, rising queries, trends.json, the CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWidget, timelinePoints, relatedLists, isQueriesWidget, summarize, seasonProfile, seasonAdvice, classifyRising, buildTrends, suggestedQueries } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/trends.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const WEEK = 7 * 86400;
const START = Date.UTC(2021, 9, 10) / 1000; // Sunday 2021-10-10, like the real 5-year curve
// weekly points: value(i, date) for 262 weeks up to 2026-10-11
const curve = f => Array.from({ length: 262 }, (_, i) => { const t = START + i * WEEK; return { t, v: Math.max(0, Math.min(100, Math.round(f(i, new Date(t * 1000))))) }; });
const flat = (v = 40) => curve(() => v);
const NOW_TS = Date.UTC(2026, 9, 14) / 1000;

test('widgets: the )]}\' prefix, the timeline, related queries and topics', () => {
  const ml = parseWidget(")]}',\n" + JSON.stringify({ default: { timelineData: [{ time: '1633824000', formattedTime: 'Oct 10 – 16, 2021', value: [37] }, { time: '1634428800', value: [41] }] } }));
  assert.deepEqual(timelinePoints(ml), [{ t: 1633824000, v: 37 }, { t: 1634428800, v: 41 }]);
  const queries = { default: { rankedList: [{ rankedKeyword: [{ query: 'a b', value: 100, formattedValue: '100' }] }, { rankedKeyword: [{ query: 'c d', value: 120, formattedValue: '+120%' }, { query: 'e f', value: 5000, formattedValue: 'Breakout' }] }] } };
  const topics = { default: { rankedList: [{ rankedKeyword: [{ topic: { title: 'Sink' }, value: 100, formattedValue: '100' }] }] } };
  assert.equal(isQueriesWidget(queries), true);
  assert.equal(isQueriesWidget(topics), false);
  assert.equal(isQueriesWidget({ default: { rankedList: [] } }), false);
  const { top, rising } = relatedLists(queries);
  assert.equal(top[0].query, 'a b');
  assert.equal(rising[1].label, 'Breakout');
  assert.equal(parseWidget(''), null);
});

test('summarize: statuses of the curve', () => {
  assert.equal(summarize(curve(() => 0)).status, 'insufficient');
  assert.equal(summarize(curve((i) => (i >= 250 && i < 255 ? 30 : 0))).status, 'insufficient', 'five weeks with data in a year is too little');
  assert.equal(summarize(flat(40)).status, 'established');
  assert.equal(summarize(curve(i => (i < 210 ? 0 : 30 + (i - 210)))).status, 'new');
  const rising = summarize(curve(i => (i < 210 ? 20 : 40)));
  assert.equal(rising.status, 'rising');
  assert.ok(rising.growth_52w >= 0.3);
  const declining = summarize(curve(i => (i < 158 ? 50 : i < 210 ? 50 : 20)));
  assert.equal(declining.status, 'declining');
  assert.equal(summarize(curve(i => (i >= 40 && i < 50 ? 100 : i < 40 ? 30 : 33))).status, 'mature');
  const small = summarize(curve(i => (i % 4 === 0 ? 20 : 0)));
  assert.equal(small.low_volume, true);
  assert.match(small.note, /мало данных/);
});

test('season: the peak month, consistency, and where the snapshot sits', () => {
  // a spring peak (March-May) every year, a trough in November-December
  const f = (i, d) => ({ 0: 40, 1: 45, 2: 80, 3: 100, 4: 90, 5: 55, 6: 40, 7: 40, 8: 45, 9: 40, 10: 25, 11: 20 }[d.getUTCMonth()]);
  const pts = curve(f);
  const prof = seasonProfile(pts);
  assert.equal(prof.consistent, true);
  assert.equal(prof.peak_month, 4);
  assert.ok([11, 12].includes(prof.low_month));
  assert.equal(prof.months.length, 12);
  assert.ok(prof.years.every(y => y >= 2023 && y <= 2025), 'only full years: ' + prof.years);
  const may = seasonAdvice(prof, Date.UTC(2026, 4, 10) / 1000);
  assert.equal(may.level, 'peak');
  assert.match(may.note, /сезонн/);
  const nov = seasonAdvice(prof, Date.UTC(2026, 10, 10) / 1000);
  assert.equal(nov.level, 'low');
  assert.equal(nov.months_to_peak, 5);
  const oct = seasonAdvice(prof, NOW_TS);
  assert.ok(['normal', 'low'].includes(oct.level));
  assert.equal(seasonProfile(flat(40)).consistent, false, 'a flat curve has no season');
  assert.equal(seasonAdvice(seasonProfile(flat(40)), NOW_TS), null);
  assert.equal(seasonProfile(curve(() => 10).slice(0, 50)), null, 'under two years: no profile');
});

test('classifyRising: service queries and angles, noise out', () => {
  const rising = [
    { query: 'імплантація зубів ціна', value: 150, label: '+150%' },
    { query: 'імплантація зубів під ключ', value: 90, label: '+90%' },
    { query: 'швидка імплантація зубів', value: 120, label: '+120%' },
    { query: 'імплантація зубів', value: 300, label: '+300%' },
    { query: 'імплантація зубів near me', value: 500, label: '+500%' },
    { query: 'імплантація зубів 2026', value: 400, label: '+400%' },
    { query: 'імплантація', value: 80, label: '+80%' },
    { query: 'базальна імплантація зубів', value: 5000, label: 'Breakout' },
    { query: 'курс імплантація зубів', value: 70, label: '+70%' },
    { query: 'імплантація зубів отзывы', value: 60, label: '+60%' },
    { query: 'швидка імплантація зубів', value: 60, label: '+60%' }
  ];
  const r = classifyRising(rising, 'імплантація зубів', { noise: ['курс'] });
  assert.deepEqual(r.queries.map(x => x.query), ['базальна імплантація зубів', 'швидка імплантація зубів']);
  assert.deepEqual(r.angles.map(x => x.query), ['імплантація зубів ціна', 'імплантація зубів під ключ', 'імплантація зубів отзывы']);
  assert.equal(r.queries[0].seed, 'імплантація зубів');
});

test('buildTrends: statuses, niche direction, season from the lead phrases, errors kept', () => {
  const season = (i, d) => ({ 0: 40, 1: 45, 2: 80, 3: 100, 4: 90, 5: 55, 6: 40, 7: 40, 8: 45, 9: 40, 10: 25, 11: 20 }[d.getUTCMonth()]);
  const raw = {
    geo: 'UA', hl: 'uk', period: 'today 5-y', fetched_at: '2026-10-14T10:00:00Z',
    items: [
      { phrase: 'стоматологія', timeline: curve((i, d) => season(i, d) * (i < 210 ? 0.6 : 1.1)), related_rising: [{ query: 'стоматологія ціни', value: 80, label: '+80%' }, { query: 'дитяча стоматологія без болю', value: 5000, label: 'Breakout' }], related_top: [{ query: 'стоматологія київ' }] },
      { phrase: 'вініри', timeline: curve((i, d) => season(i, d) * (i < 210 ? 0.7 : 1.1)), related_rising: [] },
      { phrase: 'дуже вузька фраза', timeline: curve(() => 0), related_rising: [] },
      { phrase: 'зламана', error: 'Google Trends answered 429' }
    ]
  };
  const t = buildTrends(raw, { now: NOW_TS });
  assert.equal(t.geo, 'UA');
  assert.equal(t.phrases.length, 4);
  assert.equal(t.phrases[0].status, 'rising');
  assert.equal(t.phrases[2].status, 'insufficient');
  assert.equal(t.phrases[3].status, 'error');
  assert.equal(t.niche.measurable, 2);
  assert.equal(t.niche.direction, 'growing');
  assert.equal(t.niche.season.peak_month, 4);
  assert.deepEqual(t.phrases[0].rising_angles.map(x => x.query), ['стоматологія ціни']);
  assert.deepEqual(t.phrases[0].rising_queries.map(x => x.query), ['дитяча стоматологія без болю']);
  assert.equal(t.phrases[0].sparkline.length, 52);
  assert.ok(!('_avg' in t.phrases[0]));
  assert.deepEqual(suggestedQueries(t).map(q => q.query), ['дитяча стоматологія без болю']);
  assert.equal(buildTrends({ items: [] }).niche.direction, 'insufficient');
});

test('trends.js CLI: raw.json -> trends.json, queries file, usage error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trends-'));
  mkdirSync(path.join(dir, 'trends'));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: '2026-10-14T10:00:00Z', country: 'UA', preset: 'dentistry', queries: ['стоматологія'] }));
  writeFileSync(path.join(dir, 'trends', 'raw.json'), JSON.stringify({ geo: 'UA', hl: 'uk', period: 'today 5-y', fetched_at: '2026-10-14T10:00:00Z',
    items: [{ phrase: 'стоматологія', timeline: curve((i) => (i < 210 ? 20 : 45)), related_rising: [{ query: 'сучасна стоматологія', value: 120, label: '+120%' }, { query: 'курс стоматологія', value: 200, label: '+200%' }] }] }));
  let r = spawnSync(process.execPath, [path.join(SCRIPTS, 'trends.js'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(readFileSync(path.join(dir, 'trends.json'), 'utf8'));
  assert.equal(t.phrases[0].status, 'rising');
  assert.deepEqual(t.phrases[0].rising_queries.map(x => x.query), ['сучасна стоматологія'], 'the dentistry preset noise word "курс" is dropped');
  r = spawnSync(process.execPath, [path.join(SCRIPTS, 'trends.js'), 'queries', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(dir, 'trends', 'suggested-queries.txt'), 'utf8'), 'сучасна стоматологія\n');
  r = spawnSync(process.execPath, [path.join(SCRIPTS, 'trends.js'), path.join(dir, 'nothing')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok(existsSync(path.join(dir, 'trends.json')));
});

// ---- the report side: warnings, next step, report.js ------------------------------------------
import { snapshotWarnings, nextSteps, normalizeAd, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const SEASON = { 0: 40, 1: 45, 2: 80, 3: 100, 4: 90, 5: 55, 6: 40, 7: 40, 8: 45, 9: 40, 10: 25, 11: 20 };
const seasonal = (k = 1) => curve((i, d) => SEASON[d.getUTCMonth()] * k);
const trendsAt = (month, k = 1) => buildTrends({ geo: 'UA', hl: 'uk', period: 'today 5-y', items: [{ phrase: 'стоматологія', timeline: seasonal(k), related_rising: [] }] }, { now: Date.UTC(2026, month, 10) / 1000 });
const base = { advertisers: 20, queryStats: [], ts: NOW_TS };

test('snapshotWarnings: a snapshot in the peak season of demand is flagged, a low season is only noted', () => {
  const peak = snapshotWarnings({ ...base, trends: trendsAt(4) }).find(w => w.code === 'demand_peak');
  assert.ok(peak, 'peak warning');
  assert.equal(peak.severity, 'warn');
  assert.match(peak.message, /повтори срез/);
  const low = snapshotWarnings({ ...base, trends: trendsAt(10) }).find(w => w.code === 'demand_low');
  assert.ok(low);
  assert.equal(low.severity, 'info');
  assert.ok(!snapshotWarnings({ ...base, trends: trendsAt(4) }).some(w => w.code === 'demand_low'));
  assert.ok(!snapshotWarnings(base).some(w => /^demand_/.test(w.code)), 'no trends.json: nothing about demand');
});

test('snapshotWarnings: shrinking demand', () => {
  const t = buildTrends({ items: [{ phrase: 'x', timeline: curve((i) => (i < 210 ? 60 : 25)), related_rising: [] }] }, { now: NOW_TS });
  const w = snapshotWarnings({ ...base, trends: t }).find(x => x.code === 'demand_shrinking');
  assert.ok(w);
  assert.match(w.message, /-?\d+%/);
});

test('nextSteps: Google Trends is offered until trends.json exists, and asks before touching Google', () => {
  const st = nextSteps({ curated: true, has_image_links: true, manifest: true, downloaded: 1, labeled: 1, sites: true, client: true, hypotheses: true, plan: true, pages_of: true, niche: true });
  const step = st.find(s => s.code === 'trends');
  assert.ok(step);
  assert.match(step.needs, /по просьбе/);
  assert.ok(!nextSteps({ trends: true }).some(s => s.code === 'trends'));
});

test('loadSnapshot reads trends.json; the HTML and the report JSON carry it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trends-snap-'));
  const NOW = 1_790_000_000;
  const rows = ['1', '2', '3'].map(id => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: 'Clinic ' + id, is_active: true, start_date: NOW - 20 * 86400, end_date: NOW, publisher_platform: ['facebook'], collation_count: 1,
    snapshot: { title: 'T' + id, body: { text: 'Імплантація зубів, запис' }, cta_text: 'Learn more', link_url: 'https://c' + id + '.example/', display_format: 'IMAGE' } }, 'імплантація'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows), 'utf8');
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['імплантація'] }));
  const t = trendsAt(4);
  writeFileSync(path.join(dir, 'trends.json'), JSON.stringify(t));
  const snap = loadSnapshot(dir, undefined, { now: NOW });
  assert.equal(snap.trends.niche.season.peak_month, 4);
  assert.ok(!snap.next_steps.some(s => s.code === 'trends'));
  const html = buildHtml(snap);
  assert.match(html, /<h2>Спрос и сезонность \(Google Trends\)/);
  assert.match(html, /◀ срез/, "the month of the snapshot is marked");
  assert.match(html, /стоматологія/);
  const noTrends = loadSnapshot((() => { const d2 = mkdtempSync(path.join(tmpdir(), 'trends-snap-')); writeFileSync(path.join(d2, 'ads.csv'), toCsv(rows), 'utf8'); writeFileSync(path.join(d2, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['x'] })); return d2; })(), undefined, { now: NOW });
  assert.equal(noTrends.trends, null);
  assert.ok(noTrends.next_steps.some(s => s.code === 'trends'));
  assert.doesNotMatch(buildHtml(noTrends), /<h2>Спрос и сезонность \(Google Trends\)/);
});

// ---- the Excel sheet --------------------------------------------------------------------------
test('xlsx export: a "Спрос (Trends)" sheet only when trends.json exists; ad-side text never becomes a formula', { skip: spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status !== 0 && 'openpyxl not installed' }, () => {
  const NOW = 1_790_000_000;
  const mk = withTrends => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trends-xlsx-'));
    const rows = ['1', '2', '3'].map(id => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: 'Clinic ' + id, is_active: true, start_date: NOW - 20 * 86400, end_date: NOW, publisher_platform: ['facebook'], collation_count: 1,
      snapshot: { title: 'T' + id, body: { text: 'Імплантація зубів' }, cta_text: 'Learn more', link_url: 'https://c' + id + '.example/', display_format: 'IMAGE' } }, 'імплантація'));
    writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows), 'utf8');
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['імплантація'] }));
    if (withTrends) {
      const t = buildTrends({ geo: 'UA', hl: 'uk', period: 'today 5-y', items: [{ phrase: 'стоматологія', timeline: seasonal(), related_rising: [{ query: '=HYPERLINK("http://x")', value: 5000, label: 'Breakout' }, { query: 'сучасна стоматологія', value: 90, label: '+90%' }] }] }, { now: Date.UTC(2026, 4, 10) / 1000 });
      writeFileSync(path.join(dir, 'trends.json'), JSON.stringify(t));
    }
    return dir;
  };
  const sheets = dir => {
    const r = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    assert.equal(r.status, 0, r.stderr);
    const c = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
out = {"names": wb.sheetnames}
if "Спрос (Trends)" in wb.sheetnames:
    ws = wb["Спрос (Trends)"]
    out["cells"] = [str(c.value) for row in ws.iter_rows() for c in row if c.value is not None]
    out["formulas"] = [c.coordinate for row in ws.iter_rows() for c in row if c.data_type == 'f']
print(json.dumps(out, ensure_ascii=False))`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return JSON.parse(c.stdout);
  };
  assert.ok(!sheets(mk(false)).names.includes('Спрос (Trends)'));
  const withT = sheets(mk(true));
  assert.ok(withT.names.includes('Спрос (Trends)'));
  const text = withT.cells.join(' | ');
  assert.match(text, /стоматологія/);
  assert.match(text, /растёт|новый спрос|ровно|устойчивый/);
  assert.match(text, /сучасна стоматологія \+90%/);
  assert.deepEqual(withT.formulas, [], 'a rising query that starts with = is text, not a formula');
});
