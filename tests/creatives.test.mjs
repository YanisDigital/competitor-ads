import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv, creativeMedia, selectCreatives, lintCreatives, creativesSummary, CREATIVE_TAGS, strengthOf } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };

const ad = (snapshot, over = {}) => ({
  ad_archive_id: '1', page_id: '7', page_name: 'Salon A', is_active: true, start_date: NOW - 10 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'T', body: { text: 'B' }, cta_text: 'Learn more', link_url: 'https://salon-a.example/', display_format: 'IMAGE', ...snapshot }, ...over
});
const card = n => ({ body: 'c' + n, original_image_url: `https://cdn.example/card${n}.jpg` });

// ---- ads.csv: every card of a carousel ------------------------------------

test('carousel: links to up to 5 cards, in order, http(s) only', () => {
  const r = normalizeAd(ad({ display_format: 'CAROUSEL', cards: [card(1), card(2), { resized_image_url: 'https://cdn.example/r3.jpg' }, { original_image_url: 'javascript:x' }, card(5), card(6), card(7)] }), 'q');
  assert.equal(r.card_image_urls, ['https://cdn.example/card1.jpg', 'https://cdn.example/card2.jpg', 'https://cdn.example/r3.jpg', 'https://cdn.example/card5.jpg', 'https://cdn.example/card6.jpg'].join(' | '));
  assert.equal(normalizeAd(ad({ images: [{ original_image_url: 'https://cdn.example/a.jpg' }] }), 'q').card_image_urls, '');
});

test('CSV round trip keeps the card links; older files without the column still load', () => {
  const rows = [normalizeAd(ad({ display_format: 'CAROUSEL', cards: [card(1), card(2)] }), 'q')];
  const csv = toCsv(rows);
  assert.match(csv.split('\n')[0], /,card_image_urls$/);
  assert.equal(parseCsv(csv)[0].card_image_urls, 'https://cdn.example/card1.jpg | https://cdn.example/card2.jpg');
  const [o] = parseCsv('id,page,start,image_url\n"1","A","2026-09-01","https://cdn.example/x.jpg"');
  assert.deepEqual(creativeMedia(o), { kind: 'image', urls: ['https://cdn.example/x.jpg'] });
});

test('creativeMedia: carousel, video preview, single picture, nothing', () => {
  assert.deepEqual(creativeMedia({ fmt: 'CAROUSEL', image_url: 'https://c/1.jpg', card_image_urls: 'https://c/1.jpg | https://c/2.jpg' }), { kind: 'carousel', urls: ['https://c/1.jpg', 'https://c/2.jpg'] });
  assert.deepEqual(creativeMedia({ fmt: 'CAROUSEL', image_url: 'https://c/1.jpg', card_image_urls: 'https://c/1.jpg' }), { kind: 'image', urls: ['https://c/1.jpg'] });
  assert.deepEqual(creativeMedia({ fmt: 'DCO', image_url: 'https://c/1.jpg', card_image_urls: 'https://c/1.jpg | https://c/2.jpg' }), { kind: 'image', urls: ['https://c/1.jpg'] }); // DCO cards are alternatives, a viewer sees one
  assert.deepEqual(creativeMedia({ fmt: 'VIDEO', image_url: 'https://c/p.jpg', video_url: 'https://c/v.mp4' }), { kind: 'video_preview', urls: ['https://c/p.jpg'] });
  assert.equal(creativeMedia({ fmt: 'IMAGE', image_url: '' }), null);
  assert.equal(creativeMedia({ fmt: 'IMAGE', image_url: 'ftp://c/1.jpg' }), null);
});

// ---- which creatives to download ------------------------------------------

const row = (id, page, daysAgo, over = {}) => ({ id, page, start: NOW - daysAgo * 86400, active: 'true', fmt: 'IMAGE', variants: 1, image_url: `https://cdn.example/${id}.jpg?sig=${id}`, ...over });

test('selectCreatives: long-running ads first, round robin over advertisers, at most N per advertiser, limit', () => {
  const rows = [row('a1', 'A', 5), row('a2', 'A', 200), row('a3', 'A', 30), row('a4', 'A', 10), row('b1', 'B', 100), row('b2', 'B', 3), row('c1', 'C', 1)];
  const sel = selectCreatives(rows, { now: NOW, limit: 60, perAdvertiser: 3 });
  assert.deepEqual(sel.map(s => s.id), ['a2', 'b1', 'c1', 'a3', 'b2', 'a4']);
  assert.equal(sel[0].long_running, true);
  assert.equal(sel[0].days, 200);
  assert.deepEqual(sel[0].urls, ['https://cdn.example/a2.jpg?sig=a2']);
  assert.deepEqual(selectCreatives(rows, { now: NOW, limit: 2 }).map(s => s.id), ['a2', 'b1']);
});

test('selectCreatives: the same picture (other signature) only once, stopped ads and ads without media skipped', () => {
  const rows = [row('1', 'A', 50, { image_url: 'https://cdn.example/same.jpg?sig=x' }), row('2', 'A', 40, { image_url: 'https://cdn.example/same.jpg?sig=y' }),
    row('3', 'B', 40, { active: 'false' }), row('4', 'C', 40, { image_url: '' }), row('5', 'D', 40)];
  assert.deepEqual(selectCreatives(rows, { now: NOW }).map(s => s.id), ['1', '5']);
});

test('selectCreatives: rows come in already curated (only the kept advertisers are passed)', () => {
  const rows = [row('1', 'A', 50), row('2', 'B', 40)];
  assert.deepEqual(selectCreatives(rows.filter(r => r.page !== 'B'), { now: NOW }).map(s => s.id), ['1']);
});

// ---- labels -----------------------------------------------------------------

const good = (id, over = {}) => ({ id, subject: 'product', text_on_image: 'headline', price_on_image: false, offer_on_image: ['discount'], social_proof: ['none'], style: 'pro_photo', brand_visible: true, notes: '', ...over });
const manifest = items => ({ items: items.map(([id, page, kind = 'image']) => ({ id, page, kind, status: 'ok', files: [`creatives/${id}-1.jpg`], thumbs: [] })) });

test('CREATIVE_TAGS: every field has Russian names for its values', () => {
  for (const [field, t] of Object.entries(CREATIVE_TAGS)) {
    assert.ok(t.label, field);
    if (t.values) for (const v of t.values) assert.ok(t.names[v], field + '.' + v);
  }
});

test('lintCreatives: a clean label passes', () => {
  const res = lintCreatives([good('1')], manifest([['1', 'A']]));
  assert.equal(res.errors, 0, JSON.stringify(res.findings));
});

test('lintCreatives: unknown value, missing field, wrong type, unknown id, duplicate, "none" mixed, long notes', () => {
  const m = manifest([['1', 'A'], ['2', 'A'], ['3', 'B', 'carousel']]);
  const res = lintCreatives([
    good('1', { subject: 'cat' }),
    good('2', { style: undefined, price_on_image: 'yes', offer_on_image: ['none', 'gift'], notes: 'x'.repeat(201) }),
    good('2'),
    good('9'),
    good('3')
  ], m);
  const codes = res.findings.map(f => f.id + ':' + f.code);
  for (const c of ['1:bad_value', '2:missing_field', '2:bad_type', '2:none_mixed', '2:notes_long', '2:duplicate_id', '9:unknown_id', '3:carousel_story_missing']) assert.ok(codes.includes(c), c + ' in ' + codes);
  assert.ok(res.errors >= 5);
});

test('lintCreatives: a carousel story on a single picture is a warning, a downloaded but unlabeled creative is info', () => {
  const res = lintCreatives([good('1', { carousel_story: 'catalog' })], manifest([['1', 'A'], ['2', 'B']]));
  assert.equal(res.errors, 0);
  assert.ok(res.findings.some(f => f.code === 'carousel_story_not_carousel' && f.severity === 'warn'));
  assert.ok(res.findings.some(f => f.code === 'unlabeled' && f.severity === 'info' && f.id === '2'));
});

// ---- summary for the report -------------------------------------------------

test('strengthOf: the same thresholds as the hooks', () => {
  assert.equal(strengthOf(5, 0.5), 'strong');
  assert.equal(strengthOf(5, 0.6), 'moderate');
  assert.equal(strengthOf(3, 0.7), 'moderate');
  assert.equal(strengthOf(2, 0.5), 'weak');
});

test('creativesSummary: counts per tag value by advertisers, strength, long-running share, gallery items', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((p, i) => row(String(i + 1), p, i === 0 ? 120 : 20));
  rows.push(row('7', 'A', 20));
  const m = manifest(rows.map(r => [r.id, r.page]));
  const labels = rows.map(r => good(r.id, { subject: r.id === '7' || r.id === '6' ? 'face_closeup' : 'product' }));
  const v = creativesSummary(rows, labels, m, { now: NOW });
  assert.equal(v.downloaded, 7);
  assert.equal(v.labeled, 7);
  assert.equal(v.advertisers, 6);
  const subj = v.fields.find(f => f.field === 'subject');
  const product = subj.values.find(x => x.value === 'product');
  assert.equal(product.creatives, 5);
  assert.equal(product.advertisers, 5);
  assert.equal(product.strength, 'strong');
  assert.equal(product.long_running, 1);
  assert.equal(product.name, CREATIVE_TAGS.subject.names.product);
  const face = subj.values.find(x => x.value === 'face_closeup');
  assert.equal(face.advertisers, 2);
  assert.equal(face.strength, 'weak');
  const offer = v.fields.find(f => f.field === 'offer_on_image').values.find(x => x.value === 'discount');
  assert.equal(offer.creatives, 7);
  const noProof = v.fields.find(f => f.field === 'social_proof').values.find(x => x.value === 'none');
  assert.equal(noProof.strength, null, 'the absence of a device has no strength');
  assert.equal(v.fields.find(f => f.field === 'brand_visible').values.find(x => x.value === true).strength, 'strong');
  const item = v.items.find(i => i.id === '1');
  assert.equal(item.long_running, true);
  assert.equal(item.url, 'https://www.facebook.com/ads/library/?id=1');
  assert.equal(item.tags.subject, 'product');
  assert.ok(v.warnings.some(w => w.code === 'creatives_small'), 'under 10 advertisers labeled');
});

test('creativesSummary: expired links and unlabeled pictures become warnings; duplicates and dropped advertisers are not shown', () => {
  const rows = [row('1', 'A', 20), row('2', 'B', 20)];
  const m = { items: [
    { id: '1', page: 'A', kind: 'image', status: 'ok', files: ['creatives/1-1.jpg'], thumbs: [] },
    { id: '2', page: 'B', kind: 'image', status: 'expired', files: [], thumbs: [] },
    { id: '3', page: 'B', kind: 'image', status: 'duplicate', dup_of: '1', files: [], thumbs: [] },
    { id: '4', page: 'Z', kind: 'image', status: 'ok', files: ['creatives/4-1.jpg'], thumbs: [] }
  ] };
  const v = creativesSummary(rows, null, m, { now: NOW });
  assert.equal(v.downloaded, 1);
  assert.equal(v.expired, 1);
  assert.equal(v.labeled, 0);
  assert.deepEqual(v.items.map(i => i.id), ['1']);
  assert.ok(v.warnings.some(w => w.code === 'creatives_expired'));
  assert.ok(v.warnings.some(w => w.code === 'creatives_unlabeled'));
  assert.ok(!v.warnings.some(w => w.code === 'creatives_small'), 'nothing labeled yet: no sample warning');
});

// ---- snapshot files, report.js, HTML ------------------------------------------

// The smallest valid PNG (1x1), as a stand-in for a downloaded picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function snapshot({ withManifest = true, withLabels = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'creatives-'));
  const rows = [
    normalizeAd(ad({ images: [{ original_image_url: 'https://scontent.example.fbcdn.net/a.jpg' }] }, { ad_archive_id: '1', page_name: 'Alpha' }), 'q'),
    normalizeAd(ad({ display_format: 'CAROUSEL', cards: [card(1), card(2)] }, { ad_archive_id: '2', page_name: 'Beta <b>' }), 'q')
  ];
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  if (withManifest) {
    mkdirSync(path.join(dir, 'creatives', 'thumbs'), { recursive: true });
    writeFileSync(path.join(dir, 'creatives', 'thumbs', '1-1.png'), PNG);
    writeFileSync(path.join(dir, 'creatives', 'manifest.json'), JSON.stringify({ items: [
      { id: '1', page: 'Alpha', kind: 'image', status: 'ok', files: ['creatives/1-1.png'], thumbs: ['creatives/thumbs/1-1.png'] },
      { id: '2', page: 'Beta <b>', kind: 'carousel', status: 'ok', files: ['creatives/2-1.png', 'creatives/2-2.png'], thumbs: ['../outside.png'] }
    ] }));
  }
  if (withLabels) writeFileSync(path.join(dir, 'creatives.json'), JSON.stringify([good('1', { notes: '<script>alert(1)</script>' }), good('2', { carousel_story: 'catalog' })]));
  return dir;
}

test('loadSnapshot: visuals only when creatives/manifest.json exists; its warnings join the report warnings', () => {
  assert.equal(loadSnapshot(snapshot({ withManifest: false, withLabels: false })).visuals, null);
  const s = loadSnapshot(snapshot());
  assert.equal(s.visuals.labeled, 2);
  assert.ok(s.warnings.some(w => w.code === 'creatives_small'));
  const unl = loadSnapshot(snapshot({ withLabels: false }));
  assert.equal(unl.visuals.labeled, 0);
  assert.ok(unl.warnings.some(w => w.code === 'creatives_unlabeled'));
});

test('HTML: creatives section with tag summary and an embedded thumbnail; text escaped; no file outside the folder', () => {
  const dir = snapshot();
  const res = spawnSync('node', [path.join(SCRIPTS, 'export_html.js'), dir], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const html = readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /Креативы/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.equal((html.match(/data:image/g) || []).length, 1, 'only the thumbnail inside the folder is embedded');
  assert.equal((html.match(/<script/gi) || []).length, 0);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Beta &lt;b&gt;'));
  const plain = buildHtml({ ...loadSnapshot(snapshot({ withManifest: false, withLabels: false })), generated: '2026-10-06' });
  assert.doesNotMatch(plain, /<h2>Креативы/);
});

// ---- CLI: creatives.js ---------------------------------------------------------

test('creatives.js select writes creatives/selection.json; lint writes creatives_lint.json and fails on errors', () => {
  const dir = snapshot({ withManifest: false, withLabels: false });
  const sel = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'select', dir, '--limit', '1'], { encoding: 'utf8' });
  assert.equal(sel.status, 0, sel.stderr);
  const s = JSON.parse(readFileSync(path.join(dir, 'creatives', 'selection.json'), 'utf8'));
  assert.equal(s.items.length, 1);
  const full = snapshot();
  const ok = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'lint', full], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(existsSync(path.join(full, 'creatives_lint.json')));
  writeFileSync(path.join(full, 'creatives.json'), JSON.stringify([good('1', { subject: 'cat' })]));
  const bad = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'lint', full], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const usage = spawnSync('node', [path.join(SCRIPTS, 'creatives.js')], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

// ---- fetch_creatives.py (no network: the downloader is replaced) ----------------

const py = (code, ...args) => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code, ...args], { encoding: 'utf8', env: ENV });

test('fetch_creatives: only https links on the Meta CDN are fetched', () => {
  const urls = ['https://scontent-waw1-1.xx.fbcdn.net/v/t39/a.jpg?x=1', 'https://scontent.cdninstagram.com/v/a.jpg', 'http://scontent.xx.fbcdn.net/a.jpg',
    'https://fbcdn.net.evil.example/a.jpg', 'https://evil.example/?u=fbcdn.net', 'https://127.0.0.1/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', ''];
  const r = py('import fetch_creatives as f; print(json.dumps([f.is_allowed_url(u) for u in json.loads(sys.argv[1])]))', JSON.stringify(urls));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [true, true, false, false, false, false, false, false, false]);
});

test('fetch_creatives: manifest with ok, expired, duplicate, too big and not-an-image; files stay in the folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fetch-'));
  const items = [
    { id: '1', page: 'A', kind: 'image', urls: ['https://a.fbcdn.net/1.png'] },
    { id: '2', page: 'B', kind: 'image', urls: ['https://a.fbcdn.net/gone.png'] },
    { id: '3', page: 'C', kind: 'image', urls: ['https://a.fbcdn.net/copy.png'] },
    { id: '4', page: 'D', kind: 'image', urls: ['https://a.fbcdn.net/big.png'] },
    { id: '5', page: 'E', kind: 'image', urls: ['https://a.fbcdn.net/page.html'] },
    { id: '6', page: 'F', kind: 'carousel', urls: ['https://a.fbcdn.net/c1.png', 'https://evil.example/c2.png'] }
  ];
  const code = `
import fetch_creatives as f, base64
from pathlib import Path
png = base64.b64decode(${JSON.stringify(PNG.toString('base64'))})
def fake(url):
    if 'gone' in url: raise f.FetchError('expired')
    if 'big' in url: raise f.FetchError('too_big')
    if 'page.html' in url: raise f.FetchError('blocked')
    return png, 'image/png'
m = f.fetch_all(json.loads(sys.argv[2]), Path(sys.argv[1]), fetch=fake, sleep=lambda s: None)
print(json.dumps(m))`;
  const r = py(code, dir, JSON.stringify(items));
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  const by = Object.fromEntries(m.items.map(i => [i.id, i]));
  assert.equal(by['1'].status, 'ok');
  assert.ok(by['1'].files[0].startsWith('creatives/'));
  assert.ok(existsSync(path.join(dir, by['1'].files[0])));
  assert.equal(by['2'].status, 'expired');
  assert.equal(by['3'].status, 'duplicate');
  assert.equal(by['3'].dup_of, '1');
  assert.equal(by['4'].status, 'too_big');
  assert.equal(by['5'].status, 'blocked');
  assert.equal(by['6'].status, 'duplicate', 'its first card is the same picture as ad 1');
  assert.ok(existsSync(path.join(dir, 'creatives', 'manifest.json')));
});

test('fetch_creatives: refuses a limit above the cap', () => {
  const dir = snapshot({ withManifest: false, withLabels: false });
  const r = spawnSync('python', [path.join(SCRIPTS, 'fetch_creatives.py'), dir, '--limit', '500'], { encoding: 'utf8', env: ENV });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /limit/i);
});

const PYIMG = spawnSync('python', ['-c', 'import openpyxl, PIL'], { encoding: 'utf8' }).status === 0;
test('xlsx: a "Креативы" sheet with the thumbnail and the tags, and a summary block', { skip: !PYIMG && 'openpyxl or Pillow not installed' }, () => {
  const dir = snapshot();
  const res = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: ENV });
  assert.equal(res.status, 0, res.stderr);
  const check = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb['Креативы']
vals = [[c for c in r] for r in ws.iter_rows(values_only=True)]
summ = [[c for c in r] for r in wb['Сводка'].iter_rows(values_only=True)]
print(json.dumps({'images': len(ws._images), 'values': vals, 'summary': summ}, ensure_ascii=False, default=str))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: ENV });
  assert.equal(check.status, 0, check.stderr);
  const out = JSON.parse(check.stdout);
  assert.equal(out.images, 1, 'only the thumbnail inside the folder');
  const flat = JSON.stringify(out.values);
  assert.match(flat, /Alpha/);
  assert.match(flat, new RegExp(CREATIVE_TAGS.subject.names.product));
  assert.match(JSON.stringify(out.summary), /Что на креативах/);
  const without = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), snapshot({ withManifest: false, withLabels: false })], { encoding: 'utf8', env: ENV });
  assert.equal(without.status, 0, without.stderr);
});
