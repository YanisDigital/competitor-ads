import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv, parseCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };
const py = (code, ...args) => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code, ...args], { encoding: 'utf8', env: ENV, timeout: 120000 });
const PYIMG = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;

test('CSV: a formula behind leading spaces is neutralised too, and reads back without the quote', () => {
  const rows = [{ id: '1', page: '  =HYPERLINK("http://evil.example")', start: 1_790_000_000, title: '\t+1+1', body: '-20% знижка', kws: [] }];
  const csv = toCsv(rows);
  const line = csv.split('\n')[1];
  assert.ok(line.includes(`"'=HYPERLINK`), line);
  assert.ok(line.includes(`"'+1+1"`), line);
  assert.ok(line.includes(`"'-20% знижка"`), line);
  const [back] = parseCsv(csv);
  assert.equal(back.page, '=HYPERLINK("http://evil.example")');
  assert.equal(back.body, '-20% знижка');
});

test('fetch_creatives: only numeric ad ids name files; others are blocked and nothing is written outside the folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ids-'));
  const r = py(`
import fetch_creatives as f
from pathlib import Path
print(json.dumps([f.is_ad_id(x) for x in ['123', '0', '../x', '1/2', '12a', '', None, '1'*26]]))
folder = Path(sys.argv[1]) / 'snap'
items = [{'id': '../../escape', 'page': 'A', 'kind': 'image', 'urls': ['https://a.fbcdn.net/1.png']}]
m = f.fetch_all(items, folder, fetch=lambda u: (_ for _ in ()).throw(AssertionError('must not download')), sleep=lambda s: None)
print(json.dumps(m['items'][0]['status']))`, dir);
  assert.equal(r.status, 0, r.stderr);
  const [ids, status] = r.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(ids, [true, true, false, false, false, false, false, false]);
  assert.equal(status, 'blocked');
  assert.deepEqual(readdirSync(dir), ['snap']);
});

test('fetch_creatives: a malformed Content-Length does not stop the run', () => {
  const r = py('import fetch_creatives as f; print(json.dumps([f.content_length(x) for x in ["123", "", None, "abc", "-5", "1e9"]]))');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [123, 0, 0, 0, 0, 0]);
});

test('fetch_creatives: a decompression bomb and a non-web format are refused', { skip: !PYIMG && 'Pillow not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bomb-'));
  const r = py(`
import fetch_creatives as f, io
from pathlib import Path
from PIL import Image
folder = Path(sys.argv[1]); (folder / 'creatives' / 'thumbs').mkdir(parents=True)
def png(w, h, fmt='PNG'):
    b = io.BytesIO(); Image.new('L', (w, h)).save(b, fmt); return b.getvalue()
out = []
for name, data in [('ok', png(64, 64)), ('bomb', png(7000, 7000)), ('bmp', png(64, 64, 'BMP'))]:
    try:
        f.save_image(data, 'image/png', folder, name); out.append('ok')
    except f.FetchError as e:
        out.append(e.status)
print(json.dumps(out))`, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['ok', 'error', 'error']);
});

test('check_sites: the address a page really came from must be public (DNS rebinding)', () => {
  const r = py(`
import check_sites as c
print(json.dumps([c.is_public_ip(a) for a in [{'ipAddress': '8.8.8.8', 'port': 443}, {'ipAddress': '127.0.0.1', 'port': 80}, {'ipAddress': '192.168.1.1'},
  {'ipAddress': '[::1]'}, {'ipAddress': '169.254.169.254'}, {'ipAddress': '2606:4700:4700::1111'}, None, {}, {'ipAddress': 'not an ip'}]]))`);
  if (r.status !== 0 && /No module named/.test(r.stderr)) return;
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [true, false, false, false, false, true, false, false, false]);
});

test('check_sites: page JavaScript is off unless --with-js, and WebSockets are refused', () => {
  const r = py(`
import check_sites as c, inspect
src = inspect.getsource(c.run)
print(json.dumps({'js': 'java_script_enabled=args.with_js' in src, 'ws': 'route_web_socket' in src, 'addr': 'server_addr' in src}))`);
  if (r.status !== 0 && /No module named/.test(r.stderr)) return;
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { js: true, ws: true, addr: true });
  const help = spawnSync('python', [path.join(SCRIPTS, 'check_sites.py'), '--help'], { encoding: 'utf8', env: ENV });
  assert.match(help.stdout, /--with-js/);
});
