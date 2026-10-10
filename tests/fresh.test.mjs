import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const DAY = 86400;

const node = (id, page, startDaysAgo, endDaysAgo, text = 'Body ' + id, variants = 1) => ({
  ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: endDaysAgo === null, start_date: NOW - startDaysAgo * DAY,
  end_date: endDaysAgo === null ? NOW : NOW - endDaysAgo * DAY, publisher_platform: ['facebook'], collation_count: variants,
  snapshot: { title: 'T ' + id, body: { text }, cta_text: 'Learn more', link_url: 'https://' + page.toLowerCase() + '.example/', display_format: 'IMAGE' }
});
const rowOf = (...args) => normalizeAd(node(...args), 'q');

const ROWS = [
  rowOf('1', 'Alpha', 2, null, 'Знижка 20% на перший візит'),
  rowOf('2', 'Alpha', 3, null),
  rowOf('3', 'Alpha', 4, null, 'Body 3', 4),
  rowOf('4', 'Beta', 5, null),         // the CSV keeps the day only, so stay clear of the 7-day edge
  rowOf('5', 'Gamma', 8, null),        // 8 days: not fresh
  rowOf('6', 'Delta', 40, null),       // old
  rowOf('7', 'Beta', 3, 1)             // started 3 days ago but already stopped
];

test('buildReport: fresh lists live ads younger than a week, max 2 per advertiser, and flags bursts', () => {
  const r = buildReport(ROWS, { now: NOW });
  assert.equal(r.fresh.days, 7);
  assert.equal(r.fresh.ads, 4);                                 // 1, 2, 3, 4; not the 8-day, old or stopped ones
  assert.equal(r.fresh.advertisers, 2);
  assert.deepEqual(r.fresh.bursts, [{ page: 'Alpha', ads: 3 }]);
  assert.deepEqual(r.fresh.top.map(t => t.id), ['3', '1', '4']); // most variants first, then newest; Alpha capped at 2
  const t1 = r.fresh.top.find(t => t.id === '1');
  assert.equal(t1.days, 2);
  assert.equal(t1.url, 'https://www.facebook.com/ads/library/?id=1');
  assert.ok(Array.isArray(t1.hooks));
});

test('buildReport: no young ads gives an empty fresh block', () => {
  const r = buildReport([ROWS[4], ROWS[5]], { now: NOW });
  assert.deepEqual(r.fresh, { days: 7, ads: 0, advertisers: 0, bursts: [], top: [] });
});

function snapshotDir(rows, curation) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fr-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'], status: 'all' }));
  if (curation) writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curation));
  return dir;
}

test('fresh respects curation.json and shows up in the HTML report only when there are fresh ads', () => {
  const snap = loadSnapshot(snapshotDir(ROWS, { exclude: ['Alpha'] }));
  assert.equal(snap.report.fresh.ads, 1);
  assert.deepEqual(snap.report.fresh.top.map(t => t.id), ['4']);
  assert.match(buildHtml({ ...snap, generated: '2026-10-10' }), /Свежие запуски/);
  const plain = buildHtml({ ...loadSnapshot(snapshotDir([ROWS[4], ROWS[5]])), generated: '2026-10-10' });
  assert.doesNotMatch(plain, /Свежие запуски/);
});

const PYXLSX = spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
test('xlsx: a "Свежие" sheet with the fresh ads and their links', { skip: !PYXLSX && 'openpyxl not installed' }, () => {
  const dir = snapshotDir(ROWS);
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const check = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb['Свежие']
print(json.dumps({'ids': [r[8] for r in ws.iter_rows(min_row=2, max_row=4, values_only=True)], 'note': ws.cell(row=6, column=1).value}, ensure_ascii=False))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(check.status, 0, check.stderr);
  const out = JSON.parse(check.stdout);
  assert.deepEqual(out.ids, ['3', '1', '4'].map(id => 'https://www.facebook.com/ads/library/?id=' + id));
  assert.match(out.note, /Alpha \(3\)/);
});
