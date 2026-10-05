import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv, buildReport, diffSnapshots, snapshotWarnings } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const DAY = 86400;

const node = (id, page, startDaysAgo, endDaysAgo, extra = {}) => ({
  ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: endDaysAgo === null, start_date: NOW - startDaysAgo * DAY,
  end_date: endDaysAgo === null ? NOW : NOW - endDaysAgo * DAY, publisher_platform: ['facebook'], collation_count: 1,
  snapshot: { title: 'T ' + id, body: { text: 'Body ' + id }, cta_text: 'Learn more', link_url: 'https://' + page.toLowerCase() + '.example/', display_format: 'IMAGE' }, ...extra
});
const rowOf = (...args) => normalizeAd(node(...args), 'q');

const ACTIVE_OLD = rowOf('1', 'Alpha', 200, null);   // active, 200 days
const ACTIVE_NEW = rowOf('2', 'Beta', 5, null);      // active, 5 days
const STOP_SHORT = rowOf('3', 'Alpha', 40, 30);      // ran 10 days, stopped 30 days ago
const STOP_LONG = rowOf('4', 'Gamma', 400, 100);     // ran 300 days, stopped 100 days ago

const py = code => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

test('library_url: active by default, status and start-date window on request', () => {
  const r = py('import scrape; print(scrape.library_url("UA", "q")); print(scrape.library_url("UA", "q", status="all", date_from="2026-06-01", date_to="2026-08-31")); print(scrape.page_library_url("UA", "123", status="inactive"))');
  assert.equal(r.status, 0, r.stderr);
  const [plain, full, page] = r.stdout.trim().split(/\r?\n/);
  assert.match(plain, /active_status=active/);
  assert.doesNotMatch(plain, /start_date/);
  assert.match(full, /active_status=all/);
  assert.match(full, /start_date\[min\]=2026-06-01/);
  assert.match(full, /start_date\[max\]=2026-08-31/);
  assert.match(page, /view_all_page_id=123/);
  assert.match(page, /active_status=inactive/);
});

test('validate_date accepts YYYY-MM-DD and refuses anything else', () => {
  const ok = py('import scrape; print(scrape.validate_date("2026-06-01"))');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), '2026-06-01');
  for (const bad of ['06/01/2026', '2026-13-01', '2026-06-01&x=1', '']) {
    const r = py('import scrape; scrape.validate_date(' + JSON.stringify(bad) + ')');
    assert.notEqual(r.status, 0, 'should refuse ' + JSON.stringify(bad));
  }
});

test('CSV keeps the stop date of stopped ads and leaves it empty for active ones', () => {
  const csv = toCsv([ACTIVE_OLD, STOP_SHORT]);
  assert.match(csv.split('\n')[0], /,end$/);
  const [a, s] = parseCsv(csv);
  assert.equal(a.end, null);
  assert.ok(Math.abs(Math.round((NOW - s.end) / DAY) - 30) <= 1); // the file keeps the date, not the time
  assert.equal(String(s.active), 'false');
});

test('buildReport without stopped ads has an empty stopped block and nothing else changes', () => {
  const rows = [ACTIVE_OLD, ACTIVE_NEW];
  const r = buildReport(rows, { now: NOW });
  assert.deepEqual(r.stopped, { ads: 0, advertisers: 0, median_run_days: null, short_lived: 0, top: [] });
  assert.deepEqual(r.status_counts, { active: 2, stopped: 0 });
  assert.equal(r.longrun.length, 1);
});

test('buildReport: stopped ads are counted apart and never inflate age, long-runners or page age', () => {
  const r = buildReport([ACTIVE_OLD, ACTIVE_NEW, STOP_SHORT, STOP_LONG], { now: NOW });
  assert.equal(r.ads, 4);
  assert.deepEqual(r.status_counts, { active: 2, stopped: 2 });
  assert.deepEqual(r.longrun.map(l => l.id), ['1']);               // the 300-day stopped ad is not "running for 300 days"
  assert.equal(Object.values(r.age_buckets).reduce((a, b) => a + b, 0), 2); // age buckets: active ads only
  assert.equal(r.top_pages.find(p => p.page === 'Alpha').oldest_days, 200);
  assert.equal(r.stopped.ads, 2);
  assert.equal(r.stopped.advertisers, 2);
  assert.equal(r.stopped.median_run_days, 10);                     // lower median of [10, 300]
  assert.equal(r.stopped.short_lived, 1);                          // ran under 14 days
  assert.deepEqual(r.stopped.top.map(t => [t.id, t.run_days]), [['4', 300], ['3', 10]]);
});

test('diffSnapshots ignores stopped ads, so a mixed snapshot does not look like new or vanished ads', () => {
  const prev = [ACTIVE_OLD, ACTIVE_NEW];
  const curr = [ACTIVE_OLD, ACTIVE_NEW, STOP_SHORT, STOP_LONG];
  const d = diffSnapshots(prev, curr, { prevTs: NOW - 14 * DAY, currTs: NOW });
  assert.equal(d.curr_ads, 2);
  assert.equal(d.new_ads.count, 0);
});

test('snapshotWarnings says that stopped ads are in the sample and how they are treated', () => {
  const w = snapshotWarnings({ advertisers: 30, queryStats: [], ts: NOW, preset: null, stoppedAds: 7 });
  assert.ok(w.some(x => x.code === 'stopped_included' && /7/.test(x.message)));
  assert.ok(!snapshotWarnings({ advertisers: 30, queryStats: [], ts: NOW, preset: null, stoppedAds: 0 }).some(x => x.code === 'stopped_included'));
});

function snapshotDir(rows) {
  const dir = mkdtempSync(path.join(tmpdir(), 'st-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'], status: 'all' }));
  return dir;
}

test('loadSnapshot and the HTML report show stopped ads in their own section only when there are some', () => {
  const html = buildHtml({ ...loadSnapshot(snapshotDir([ACTIVE_OLD, ACTIVE_NEW, STOP_SHORT, STOP_LONG])), generated: '2026-10-05' });
  assert.match(html, /Остановленные объявления/);
  assert.match(html, /300/);
  const plain = buildHtml({ ...loadSnapshot(snapshotDir([ACTIVE_OLD, ACTIVE_NEW])), generated: '2026-10-05' });
  assert.doesNotMatch(plain, /Остановленные объявления/);
});

const PYXLSX = spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
test('xlsx: status columns, run length for stopped ads and a sheet with the stopped ones', { skip: !PYXLSX && 'openpyxl not installed' }, () => {
  const dir = snapshotDir([ACTIVE_OLD, STOP_LONG]);
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const check = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb['Объявления']
head = [c.value for c in ws[1]]
rows = {r[0]: dict(zip(head, r)) for r in ws.iter_rows(min_row=2, values_only=True)}
print(json.dumps({'sheets': wb.sheetnames, 'head': head[-3:], 'days': {k: v['Дней на дату сбора'] for k, v in rows.items()}}, ensure_ascii=False))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const out = JSON.parse(check.stdout);
  assert.ok(out.sheets.includes('Остановленные'));
  assert.ok(out.head.includes('Остановлено'));
  assert.equal(out.days['4'], 300); // run length of the stopped ad, not days since it started
  assert.equal(out.days['1'], 200);
});
