import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts', 'export_xlsx.py');
const NOW = 1_790_000_000;

const ad = (snapshot, over = {}) => ({
  ad_archive_id: '1', page_id: '7', page_name: 'Salon A', is_active: true, start_date: NOW - 10 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'T', body: { text: 'B' }, cta_text: 'Learn more', link_url: 'https://salon-a.example/', display_format: 'IMAGE', ...snapshot }, ...over
});

test('image ad: the full-size picture, no video link', () => {
  const r = normalizeAd(ad({ images: [{ original_image_url: 'https://cdn.example/full.jpg', resized_image_url: 'https://cdn.example/small.jpg' }] }), 'q');
  assert.equal(r.image_url, 'https://cdn.example/full.jpg');
  assert.equal(r.video_url, '');
});

test('image ad without an original falls back to the resized picture', () => {
  const r = normalizeAd(ad({ images: [{ resized_image_url: 'https://cdn.example/small.jpg' }] }), 'q');
  assert.equal(r.image_url, 'https://cdn.example/small.jpg');
});

test('video ad: HD link preferred, SD as fallback, the preview frame as the picture', () => {
  const hd = normalizeAd(ad({ display_format: 'VIDEO', videos: [{ video_hd_url: 'https://cdn.example/hd.mp4', video_sd_url: 'https://cdn.example/sd.mp4', video_preview_image_url: 'https://cdn.example/prev.jpg' }] }), 'q');
  assert.equal(hd.video_url, 'https://cdn.example/hd.mp4');
  assert.equal(hd.image_url, 'https://cdn.example/prev.jpg');
  const sd = normalizeAd(ad({ display_format: 'VIDEO', videos: [{ video_hd_url: null, video_sd_url: 'https://cdn.example/sd.mp4' }] }), 'q');
  assert.equal(sd.video_url, 'https://cdn.example/sd.mp4');
});

test('carousel / DCO ad: media comes from the first card when the snapshot has none', () => {
  const r = normalizeAd(ad({ display_format: 'DCO', cards: [{ body: 'c', original_image_url: 'https://cdn.example/card.jpg', video_hd_url: null }] }), 'q');
  assert.equal(r.image_url, 'https://cdn.example/card.jpg');
  const v = normalizeAd(ad({ display_format: 'VIDEO', cards: [{ body: 'c', video_hd_url: 'https://cdn.example/card.mp4', video_preview_image_url: 'https://cdn.example/card.jpg' }] }), 'q');
  assert.equal(v.video_url, 'https://cdn.example/card.mp4');
});

test('only http(s) links are kept: other schemes are dropped', () => {
  const r = normalizeAd(ad({ images: [{ original_image_url: 'javascript:alert(1)' }], videos: [{ video_hd_url: 'file:///etc/passwd', video_sd_url: 'data:text/html,<script>' }] }), 'q');
  assert.equal(r.image_url, '');
  assert.equal(r.video_url, '');
});

test('an ad with no media keeps both fields empty', () => {
  const r = normalizeAd(ad({}), 'q');
  assert.equal(r.image_url, '');
  assert.equal(r.video_url, '');
});

test('CSV round trip carries both links, and old files without the columns still load', () => {
  const rows = [normalizeAd(ad({ images: [{ original_image_url: 'https://cdn.example/full.jpg?a=1&b=2' }] }), 'q')];
  const csv = toCsv(rows);
  assert.match(csv.split('\n')[0], /,image_url,video_url$/);
  const [back] = parseCsv(csv);
  assert.equal(back.image_url, 'https://cdn.example/full.jpg?a=1&b=2');
  assert.equal(back.video_url, '');
  const old = 'id,page,start,active,fmt,variants,cta,link,platforms,kws,title,body\n"1","A","2026-09-01","true","IMAGE","1","x","https://a.example/","facebook","q","t","b"';
  const [o] = parseCsv(old);
  assert.ok(o.image_url === undefined || o.image_url === '');
});

const PYXLSX = spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
test('xlsx: picture and video columns hold real hyperlinks, nothing else', { skip: !PYXLSX && 'openpyxl not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'media-'));
  const rows = [
    normalizeAd(ad({ images: [{ original_image_url: 'https://cdn.example/full.jpg' }] }), 'q'),
    normalizeAd(ad({ display_format: 'VIDEO', videos: [{ video_hd_url: 'https://cdn.example/hd.mp4', video_preview_image_url: 'https://cdn.example/prev.jpg' }] }, { ad_archive_id: '2' }), 'q'),
    normalizeAd(ad({}, { ad_archive_id: '3' }), 'q')
  ];
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  const res = spawnSync('python', [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(res.status, 0, res.stderr);
  const check = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb['Объявления']
head = [c.value for c in ws[1]]
ci, cv = head.index('Картинка'), head.index('Видео')
out = {}
for row in ws.iter_rows(min_row=2):
    out[row[0].value] = [(row[ci].value, row[ci].hyperlink.target if row[ci].hyperlink else None), (row[cv].value, row[cv].hyperlink.target if row[cv].hyperlink else None)]
cm = ws.cell(row=1, column=ci + 1).comment
print(json.dumps({'cells': out, 'note': bool(cm and 'действуют' in cm.text), 'rows': ws.max_row}, ensure_ascii=False))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(check.status, 0, check.stderr);
  const out = JSON.parse(check.stdout);
  assert.deepEqual(out.cells['1'], [['картинка', 'https://cdn.example/full.jpg'], [null, null]]);
  assert.deepEqual(out.cells['2'], [['превью', 'https://cdn.example/prev.jpg'], ['видео', 'https://cdn.example/hd.mp4']]);
  assert.deepEqual(out.cells['3'], [[null, null], [null, null]]);
  assert.equal(out.note, true, 'a comment on the header must say that the links expire');
  assert.equal(out.rows, 4, 'no extra rows under the table');
});
