import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, creativeMedia, selectCreatives, lintCreatives, creativesSummary, videoFramePlan, aspectOf, CREATIVE_TAGS } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };
const py = (code, ...args) => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code, ...args], { encoding: 'utf8', env: ENV, timeout: 120000 });

// ---- frame plan ------------------------------------------------------------

test('videoFramePlan: the hook seconds, quarters and the end of a 30-second video', () => {
  const p = videoFramePlan(30);
  assert.deepEqual(p.map(x => x.label), ['0s', '1s', '2s', '3s', '25%', '50%', '75%', 'end']);
  assert.deepEqual(p.map(x => x.t), [0, 1, 2, 3, 7.5, 15, 22.5, 29.75]);
});

test('videoFramePlan: a short video gets no frame past its end and no near-duplicates; no duration means one frame', () => {
  const p = videoFramePlan(2);
  assert.ok(p.every(x => x.t >= 0 && x.t < 2), JSON.stringify(p));
  assert.equal(p[0].t, 0);
  assert.equal(p[p.length - 1].label, 'end');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].t - p[i - 1].t >= 0.4, 'frames at least 0.4 s apart');
  assert.deepEqual(videoFramePlan(NaN), [{ t: 0, label: '0s' }]);
  assert.deepEqual(videoFramePlan(0), [{ t: 0, label: '0s' }]);
});

test('aspectOf: vertical, 4:5, square, horizontal', () => {
  assert.equal(aspectOf(720, 1280), '9:16');
  assert.equal(aspectOf(1080, 1350), '4:5');
  assert.equal(aspectOf(1080, 1080), '1:1');
  assert.equal(aspectOf(1280, 720), '16:9');
  assert.equal(aspectOf(0, 0), '');
});

// ---- selection ---------------------------------------------------------------

const row = (id, page, daysAgo, over = {}) => ({ id, page, start: NOW - daysAgo * 86400, active: 'true', fmt: 'VIDEO', variants: 1,
  image_url: `https://a.fbcdn.net/${id}.jpg`, video_url: `https://a.fbcdn.net/${id}.mp4`, ...over });

test('creativeMedia and selectCreatives keep the video link of a video ad', () => {
  assert.equal(creativeMedia(row('1', 'A', 5)).video_url, 'https://a.fbcdn.net/1.mp4');
  assert.equal(creativeMedia(row('1', 'A', 5, { video_url: 'ftp://x' })).kind, 'image');
  const sel = selectCreatives([row('1', 'A', 5), row('2', 'B', 5, { fmt: 'IMAGE', video_url: '' })], { now: NOW });
  assert.equal(sel.find(s => s.id === '1').video_url, 'https://a.fbcdn.net/1.mp4');
  assert.equal(sel.find(s => s.id === '2').video_url, undefined);
});

test('creatives.js select --videos N marks the first N video creatives, in selection order', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsel-'));
  const ad = (id, page, fmt, media) => normalizeAd({ ad_archive_id: id, page_id: '7', page_name: page, is_active: true, start_date: NOW - 10 * 86400, publisher_platform: ['facebook'],
    snapshot: { title: 'T', body: { text: 'B' }, display_format: fmt, ...media } }, 'q');
  const vid = n => ({ videos: [{ video_hd_url: `https://a.fbcdn.net/v${n}.mp4`, video_preview_image_url: `https://a.fbcdn.net/p${n}.jpg` }] });
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([ad('1', 'A', 'VIDEO', vid(1)), ad('2', 'B', 'IMAGE', { images: [{ original_image_url: 'https://a.fbcdn.net/i.jpg' }] }), ad('3', 'C', 'VIDEO', vid(3)), ad('4', 'D', 'VIDEO', vid(4))]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  const r = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'select', dir, '--videos', '2'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const items = JSON.parse(readFileSync(path.join(dir, 'creatives', 'selection.json'), 'utf8')).items;
  assert.equal(items.filter(i => i.want_video).length, 2);
  assert.ok(!items.find(i => i.id === '2').want_video);
  const bad = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'select', dir, '--videos', '99'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

// ---- labels and summary -------------------------------------------------------

const label = (id, over = {}) => ({ id, subject: 'process', text_on_image: 'headline', price_on_image: false, offer_on_image: ['none'], social_proof: ['none'], style: 'ugc_phone', brand_visible: false, notes: '', ...over });
const vlabel = (id, over = {}) => label(id, { hook_type: 'talking_person', video_format: 'talking_head', subtitles: true, end_cta: false, ...over });
const okVideo = (over = {}) => ({ status: 'ok', duration: 24, width: 720, height: 1280, aspect: '9:16', frames: [], storyboard: 'creatives/x-story.jpg', storyboard_thumb: 'creatives/thumbs/x-story.jpg', ...over });
const mItem = (id, page, video) => ({ id, page, kind: video ? 'video_preview' : 'image', status: 'ok', files: [`creatives/${id}-1.jpg`], thumbs: [`creatives/thumbs/${id}-1.jpg`], ...(video ? { video } : {}) });

test('CREATIVE_TAGS: the video fields are marked video-only and have Russian names', () => {
  for (const f of ['hook_type', 'video_format', 'subtitles', 'end_cta']) {
    assert.ok(CREATIVE_TAGS[f] && CREATIVE_TAGS[f].videoOnly, f);
    assert.ok(CREATIVE_TAGS[f].label, f);
  }
});

test('lintCreatives: a video with frames needs the video fields; a picture must not have them', () => {
  const m = { items: [mItem('1', 'A', okVideo()), mItem('2', 'B', null), mItem('3', 'C', okVideo({ status: 'expired' }))] };
  const res = lintCreatives([label('1'), label('2', { hook_type: 'process' }), label('3')], m);
  const codes = res.findings.map(f => f.id + ':' + f.code + ':' + f.field);
  assert.ok(codes.includes('1:missing_field:hook_type'), codes.join(' '));
  assert.ok(codes.includes('2:video_tag_not_video:hook_type'), codes.join(' '));
  assert.ok(!codes.some(c => c.startsWith('3:missing_field')), 'a video without frames is labeled like a picture');
  assert.equal(lintCreatives([vlabel('1', { hook_type: 'cat' })], m).findings.some(f => f.code === 'bad_value' && f.field === 'hook_type'), true);
  assert.equal(lintCreatives([vlabel('1')], m).errors, 0);
});

test('creativesSummary: video tags over videos only, duration and aspect, the storyboard first in the gallery', () => {
  const rows = ['A', 'B', 'C', 'D', 'E'].map((p, i) => row(String(i + 1), p, 20));
  rows.push(row('6', 'F', 20, { fmt: 'IMAGE', video_url: '' }));
  const m = { items: [
    ...rows.slice(0, 5).map((r, i) => mItem(r.id, r.page, okVideo({ duration: [8, 20, 25, 45, 90][i], aspect: i < 4 ? '9:16' : '1:1', storyboard: `creatives/${r.id}-story.jpg`, storyboard_thumb: `creatives/thumbs/${r.id}-story.jpg` }))),
    mItem('6', 'F', null)
  ] };
  const labels = [...rows.slice(0, 5).map(r => vlabel(r.id)), label('6')];
  const v = creativesSummary(rows, labels, m, { now: NOW });
  const hook = v.fields.find(f => f.field === 'hook_type');
  assert.equal(hook.labeled, 5, 'only videos count');
  assert.equal(hook.values[0].value, 'talking_person');
  assert.equal(hook.values[0].strength, 'strong');
  assert.deepEqual(v.videos.durations, { '<15': 1, '15-30': 2, '30-60': 1, '>60': 1 });
  assert.deepEqual(v.videos.aspects, { '9:16': 4, '1:1': 1 });
  assert.equal(v.videos.analysed, 5);
  const g = v.items.find(i => i.id === '1');
  assert.equal(g.thumbs[0], 'creatives/thumbs/1-story.jpg');
  assert.equal(g.files[0], 'creatives/1-story.jpg');
  assert.equal(g.video.duration, 8);
  assert.equal(v.items.find(i => i.id === '6').video, null);
});

test('creativesSummary: failed videos become an info warning', () => {
  const rows = [row('1', 'A', 20)];
  const v = creativesSummary(rows, null, { items: [mItem('1', 'A', okVideo({ status: 'undecodable' }))] }, { now: NOW });
  assert.ok(v.warnings.some(w => w.code === 'videos_failed'));
  assert.equal(v.videos.analysed, 0);
});

// ---- fetch_creatives.py: videos (downloader and frame extractor replaced) ----

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PYIMG = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;

test('fetch_creatives: videos are downloaded, cut into frames and a storyboard, the mp4 is deleted; failures get a status', { skip: !PYIMG && 'Pillow not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fetchv-'));
  mkdirSync(path.join(dir, 'creatives', 'thumbs'), { recursive: true });
  const items = [
    { id: '1', page: 'A', kind: 'video_preview', status: 'ok', files: [], thumbs: [], want_video: true, video_url: 'https://a.fbcdn.net/1.mp4' },
    { id: '2', page: 'B', kind: 'video_preview', status: 'ok', files: [], thumbs: [], want_video: true, video_url: 'https://a.fbcdn.net/gone.mp4' },
    { id: '3', page: 'C', kind: 'video_preview', status: 'ok', files: [], thumbs: [], want_video: true, video_url: 'https://a.fbcdn.net/broken.mp4' },
    { id: '4', page: 'D', kind: 'video_preview', status: 'ok', files: [], thumbs: [], want_video: true, video_url: 'https://evil.example/4.mp4' },
    { id: '5', page: 'E', kind: 'image', status: 'ok', files: [], thumbs: [] }
  ];
  const code = `
import fetch_creatives as f, base64
from pathlib import Path
from io import BytesIO
from PIL import Image
buf = BytesIO(); Image.new('RGB', (36, 64), 'red').save(buf, 'JPEG'); jpg = buf.getvalue()
def fake_fetch(url, kinds=None, max_bytes=None):
    if 'gone' in url: raise f.FetchError('expired')
    return b'not really a video', 'video/mp4'
def fake_extract(path):
    if 'broken' in str(path) or path.name.startswith('3'): raise f.FetchError('undecodable')
    assert path.exists()
    return {'duration': 30.0, 'width': 720, 'height': 1280, 'frames': [{'t': t, 'label': l, 'jpeg': jpg} for t, l in [(0, '0s'), (1, '1s'), (15, '50%'), (29.75, 'end')]]}
folder = Path(sys.argv[1])
items = json.loads(sys.argv[2])
f.fetch_videos(items, folder, fetch=fake_fetch, extract=fake_extract, sleep=lambda s: None)
print(json.dumps(items))`;
  const r = py(code, dir, JSON.stringify(items));
  assert.equal(r.status, 0, r.stderr);
  const by = Object.fromEntries(JSON.parse(r.stdout).map(i => [i.id, i]));
  const v = by['1'].video;
  assert.equal(v.status, 'ok');
  assert.equal(v.duration, 30);
  assert.equal(v.width, 720);
  assert.equal(v.height, 1280);
  assert.equal(v.frames.length, 4);
  assert.ok(existsSync(path.join(dir, v.storyboard)), 'storyboard written');
  assert.ok(existsSync(path.join(dir, v.storyboard_thumb)));
  assert.ok(existsSync(path.join(dir, v.frames[0].file)));
  assert.ok(!existsSync(path.join(dir, 'creatives', '1.mp4')), 'the mp4 is deleted after the frames');
  assert.equal(by['2'].video.status, 'expired');
  assert.equal(by['3'].video.status, 'undecodable');
  assert.ok(!existsSync(path.join(dir, 'creatives', '3.mp4')), 'deleted even when decoding fails');
  assert.equal(by['4'].video.status, 'blocked');
  assert.equal(by['5'].video, undefined);
});

test('fetch_creatives: refuses more videos than the cap', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'capv-'));
  writeFileSync(path.join(dir, 'ads.csv'), 'id,page,start\n');
  const r = spawnSync('python', [path.join(SCRIPTS, 'fetch_creatives.py'), dir, '--videos', '500'], { encoding: 'utf8', env: ENV });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /videos/i);
});

// The real extractor on a real video: Chromium records a short clip of a
// canvas animation itself (MediaRecorder, webm), so no ffmpeg and no network.
const PW = spawnSync('python', ['-c', 'import playwright, PIL'], { encoding: 'utf8' }).status === 0;
test('extract_frames: the browser decodes a real clip and returns frames at the planned times', { skip: !PW && 'playwright or Pillow not installed', timeout: 120000 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'clip-'));
  const code = `
import fetch_creatives as f, base64
from pathlib import Path
from playwright.sync_api import sync_playwright
REC = """async () => {
  const c = document.createElement('canvas'); c.width = 160; c.height = 284; const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' }); const parts = [];
  rec.ondataavailable = e => parts.push(e.data); const done = new Promise(r => rec.onstop = r); rec.start(100);
  const t0 = performance.now();
  while (performance.now() - t0 < 2500) { const k = (performance.now() - t0) / 2500; x.fillStyle = 'rgb(' + Math.round(255 * k) + ',0,0)'; x.fillRect(0, 0, 160, 284); await new Promise(r => requestAnimationFrame(r)); }
  rec.stop(); await done;
  const b = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = ''; for (const v of b) s += String.fromCharCode(v); return btoa(s);
}"""
with sync_playwright() as p:
    br = p.chromium.launch(headless=True); pg = br.new_page(); pg.goto('about:blank')
    data = base64.b64decode(pg.evaluate(REC)); br.close()
clip = Path(sys.argv[1]) / 'clip.webm'; clip.write_bytes(data)
with f.FrameExtractor() as ex:
    out = ex(clip)
print(json.dumps({'duration': out['duration'], 'w': out['width'], 'h': out['height'], 'labels': [x['label'] for x in out['frames']], 'jpeg': all(x['jpeg'][:2] == b'\\xff\\xd8' for x in out['frames'])}))`;
  const r = py(code, dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(out.duration > 1.5 && out.duration < 4, 'duration ' + out.duration);
  assert.equal(out.w, 160);
  assert.equal(out.h, 284);
  assert.ok(out.labels.length >= 3 && out.labels[0] === '0s' && out.labels[out.labels.length - 1] === 'end', out.labels.join(','));
  assert.equal(out.jpeg, true);
});

// ---- report and exports ------------------------------------------------------------

test('report, HTML and Excel show video length and the storyboard', { skip: !PYIMG && 'Pillow not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vrep-'));
  const ad = normalizeAd({ ad_archive_id: '1', page_id: '7', page_name: 'Alpha', is_active: true, start_date: NOW - 10 * 86400, publisher_platform: ['facebook'],
    snapshot: { title: 'T', body: { text: 'B' }, display_format: 'VIDEO', videos: [{ video_hd_url: 'https://a.fbcdn.net/v.mp4', video_preview_image_url: 'https://a.fbcdn.net/p.jpg' }] } }, 'q');
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([ad]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  mkdirSync(path.join(dir, 'creatives', 'thumbs'), { recursive: true });
  const mk = spawnSync('python', ['-c', `from PIL import Image; import sys; Image.new('RGB', (80, 40), 'blue').save(sys.argv[1]); Image.new('RGB', (80, 40), 'blue').save(sys.argv[2])`,
    path.join(dir, 'creatives', '1-story.jpg'), path.join(dir, 'creatives', 'thumbs', '1-story.jpg')], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  writeFileSync(path.join(dir, 'creatives', 'manifest.json'), JSON.stringify({ items: [mItem('1', 'Alpha', okVideo({ storyboard: 'creatives/1-story.jpg', storyboard_thumb: 'creatives/thumbs/1-story.jpg' }))] }));
  writeFileSync(path.join(dir, 'creatives.json'), JSON.stringify([vlabel('1')]));
  const s = loadSnapshot(dir);
  assert.equal(s.visuals.videos.analysed, 1);
  const h = spawnSync('node', [path.join(SCRIPTS, 'export_html.js'), dir], { encoding: 'utf8' });
  assert.equal(h.status, 0, h.stderr);
  const html = readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /24 с/);
  assert.match(html, /9:16/);
  assert.match(html, /Хук первых секунд/);
  assert.match(html, /data:image\/jpeg;base64,/);
  const x = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: ENV });
  assert.equal(x.status, 0, x.stderr);
  const chk = py(`from openpyxl import load_workbook
wb = load_workbook(sys.argv[1]); ws = wb['Креативы']
print(json.dumps({'vals': [[c for c in r] for r in ws.iter_rows(values_only=True)], 'summary': [[c for c in r] for r in wb['Сводка'].iter_rows(values_only=True)]}, ensure_ascii=False, default=str))`, path.join(dir, 'report.xlsx'));
  assert.equal(chk.status, 0, chk.stderr);
  const flat = chk.stdout;
  assert.match(flat, /видео 24 с, 9:16/);
  assert.match(flat, /Хук первых секунд/);
});
