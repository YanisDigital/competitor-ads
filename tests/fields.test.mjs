import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv, buildReport } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;

const node = (over = {}, snapOver = {}) => ({
  ad_archive_id: '1', page_id: '777', page_name: 'Salon A', is_active: true, start_date: NOW - 30 * 86400, publisher_platform: ['instagram'],
  contains_digital_created_media: true, collation_count: 2,
  snapshot: { title: 'T', body: { text: 'B' }, cta_text: 'Learn more', cta_type: 'LEARN_MORE', caption: 'salon-a.example', link_url: 'https://salon-a.example/x',
    page_like_count: 12345, page_profile_uri: 'https://www.facebook.com/salona', display_format: 'IMAGE', ...snapOver }, ...over
});

test('normalizeAd keeps page size, link caption, button type, AI flag and profile link', () => {
  const r = normalizeAd(node(), 'q');
  assert.equal(r.page_likes, 12345);
  assert.equal(r.caption, 'salon-a.example');
  assert.equal(r.cta_type, 'LEARN_MORE');
  assert.equal(r.ai_made, true);
  assert.equal(r.page_url, 'https://www.facebook.com/salona');
});

test('normalizeAd tolerates ads that have none of the new fields', () => {
  const r = normalizeAd({ ad_archive_id: '2', page_id: '1', page_name: 'B', is_active: true, start_date: NOW, snapshot: { title: 't', body: 'b' } }, 'q');
  assert.equal(r.page_likes, null);
  assert.equal(r.caption, '');
  assert.equal(r.cta_type, '');
  assert.equal(r.ai_made, null);
  assert.equal(r.page_url, '');
});

test('CSV round trip carries page_id and the new fields; formula-like values stay text', () => {
  const rows = [normalizeAd(node({}, { caption: '=HYPERLINK("http://x.example")' }), 'q')];
  const csv = toCsv(rows);
  assert.match(csv.split('\n')[0], /page_id,page_likes,caption,cta_type,ai_made,page_url,end,image_url,video_url$/);
  const [back] = parseCsv(csv);
  assert.equal(back.page_id, '777');
  assert.equal(back.page_likes, 12345);
  assert.equal(back.caption, '=HYPERLINK("http://x.example")'); // prefix removed on the way back, as for other fields
  assert.equal(back.cta_type, 'LEARN_MORE');
  assert.equal(back.ai_made, true);
  assert.match(csv.split('\n')[1], /"'=HYPERLINK/); // but never a live formula in the file
});

test('an old ads.csv without the new columns still loads', () => {
  const old = 'id,page,start,active,fmt,variants,cta,link,platforms,kws,title,body\n"1","Salon A","2026-09-01","true","IMAGE","1","Learn more","https://a.example/","instagram","q","t","b"';
  const [r] = parseCsv(old);
  assert.equal(r.page, 'Salon A');
  assert.equal(r.page_id ?? '', '');
  assert.ok(r.page_likes === undefined || r.page_likes === null);
});

test('buildReport: advertiser size and profile link, AI-made ads and button types', () => {
  const rows = [
    normalizeAd(node(), 'q'),
    normalizeAd(node({ ad_archive_id: '2', contains_digital_created_media: false }, { page_like_count: 20000, cta_type: 'SHOP_NOW' }), 'q'),
    normalizeAd(node({ ad_archive_id: '3', page_id: '8', page_name: 'Shop B', contains_digital_created_media: undefined }, { page_like_count: 500, cta_type: 'LEARN_MORE', page_profile_uri: 'https://www.facebook.com/shopb' }), 'q')
  ];
  const r = buildReport(rows, { now: NOW });
  assert.equal(r.ai_made_ads, 1);
  assert.deepEqual(r.cta_types, { LEARN_MORE: 2, SHOP_NOW: 1 });
  const a = r.top_pages.find(p => p.page === 'Salon A');
  assert.equal(a.page_likes, 20000); // the largest value seen for that page
  assert.equal(a.page_url, 'https://www.facebook.com/salona');
  assert.equal(r.top_pages.find(p => p.page === 'Shop B').page_likes, 500);
});

test('buildReport on rows from an old csv: new fields are zero or empty, nothing breaks', () => {
  const r = buildReport([{ id: '1', page: 'A', start: NOW - 86400, active: true, fmt: 'IMAGE', variants: 1, cta: 'x', link: 'https://a.example/', platforms: 'facebook', kws: ['q'], title: 't', body: 'b' }], { now: NOW });
  assert.equal(r.ai_made_ads, 0);
  assert.deepEqual(r.cta_types, {});
  assert.equal(r.top_pages[0].page_likes, null);
});

function snapshotDir(rows, curation) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pgs-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  if (curation) writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curation));
  return dir;
}
const py = code => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

test('page_library_url builds the "all ads of one page" link', () => {
  const r = py('import scrape; print(scrape.page_library_url("KZ", "123456789"))');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /view_all_page_id=123456789/);
  assert.match(r.stdout, /country=KZ/);
  assert.match(r.stdout, /search_type=page/);
  assert.match(r.stdout, /active_status=active/);
});

test('pages_from_snapshot takes the curated competitors with their page ids, not the noise', () => {
  const rows = [normalizeAd(node(), 'q'), normalizeAd(node({ ad_archive_id: '2', page_id: '8', page_name: 'Bath House' }), 'q'), normalizeAd(node({ ad_archive_id: '3' }), 'q')];
  const dir = snapshotDir(rows, { include: { 'Salon A': 'competitor' } });
  const r = py('import scrape; print(json.dumps(scrape.pages_from_snapshot(' + JSON.stringify(dir) + ')))');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [{ page_id: '777', name: 'Salon A' }]);
});

test('pages_from_snapshot refuses an old snapshot that has no page ids', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'old-'));
  writeFileSync(path.join(dir, 'ads.csv'), 'id,page,start,active,fmt,variants,cta,link,platforms,kws,title,body\n"1","A","2026-09-01","true","IMAGE","1","x","https://a.example/","facebook","q","t","b"');
  const r = py('import scrape; scrape.pages_from_snapshot(' + JSON.stringify(dir) + ')');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /page_id/);
});

test('loadSnapshot still builds a report from the new csv', () => {
  const dir = snapshotDir([normalizeAd(node(), 'q')]);
  const snap = loadSnapshot(dir);
  assert.equal(snap.report.ads, 1);
  assert.equal(snap.report.top_pages[0].page_likes, 12345);
});

test('html and xlsx show the new fields only when the data has them', async () => {
  const { buildHtml } = await import('../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js');
  const withFields = loadSnapshot(snapshotDir([normalizeAd(node(), 'q')]));
  const html = buildHtml({ ...withFields, generated: '2026-10-03' });
  assert.match(html, /Подписчики/);
  assert.match(html, /12345/);
  assert.match(html, /Создано ИИ/);
  const old = 'id,page,start,active,fmt,variants,cta,link,platforms,kws,title,body\n"1","Salon A","2026-09-01","true","IMAGE","1","Learn more","https://a.example/","instagram","q","t","b"';
  const dir = mkdtempSync(path.join(tmpdir(), 'oldhtml-'));
  writeFileSync(path.join(dir, 'ads.csv'), old);
  const plain = buildHtml({ ...loadSnapshot(dir), generated: '2026-10-03' });
  assert.doesNotMatch(plain, /Подписчики|Создано ИИ/);
});
