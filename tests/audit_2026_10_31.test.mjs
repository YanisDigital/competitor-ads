// Security and privacy review of 2026-10-31 (code of 0.16-0.17).
//  - export_xlsx.py --lang uk: translating a cell re-assigned its value and openpyxl turned third-party "=..." text back into a formula
//  - contact_sheets.py: file names come from creatives/manifest.json, a file anyone could edit: only pictures inside creatives/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const py = (...args) => spawnSync('python', ['-I', '-X', 'utf8', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const XLSX = py('-c', 'import openpyxl').status === 0;
const PIL = py('-c', 'import PIL').status === 0;
const ad = (id, page, body) => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: page, is_active: true, start_date: NOW - 20 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: '=1+2', body: { text: body }, cta_text: 'Shop', link_url: 'https://a.example/', display_format: 'IMAGE' } }, 'q');

test('export_xlsx.py --lang uk never turns third-party text into a formula (page names, ad text, analysis.md)', { skip: !XLSX && 'openpyxl is not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'a31-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([ad('1', '=HYPERLINK("http://evil.example","x")', '=cmd|" /C calc"!A0'), ad('2', 'Plain Page', 'text')]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  writeFileSync(path.join(dir, 'analysis.md'), '=WEBSERVICE("http://evil.example")\n- ok');
  for (const lang of ['ru', 'uk']) {
    const out = path.join(dir, lang + '.xlsx');
    const r = py(path.join(SCRIPTS, 'export_xlsx.py'), dir, '--lang', lang, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    const c = py('-c', `
import openpyxl
wb = openpyxl.load_workbook(r"${out}")
bad = [(ws.title, c.coordinate) for ws in wb for row in ws.iter_rows() for c in row
       if c.data_type == "f" and isinstance(c.value, str) and ("evil" in c.value or "cmd" in c.value or c.value.startswith("=1+2"))]
own = [c.value for ws in wb for row in ws.iter_rows() for c in row if c.data_type == "f"][:1]
print("BAD", bad, "OWN", len(own))
`);
    assert.match(c.stdout, /BAD \[\] OWN 1/, lang + ': ' + c.stdout + c.stderr);
  }
});

test('contact_sheets.py reads only pictures inside <folder>/creatives, whatever manifest.json says', { skip: !PIL && 'Pillow is not installed' }, () => {
  const base = mkdtempSync(path.join(tmpdir(), 'a31cs-'));
  const dir = path.join(base, 'snap');
  mkdirSync(path.join(dir, 'creatives'), { recursive: true });
  const mk = (p, color) => py('-c', `from PIL import Image; Image.new("RGB",(50,40),${color}).save(r"${p}")`);
  mk(path.join(dir, 'creatives', '1-1.jpg'), '(200,0,0)');
  mk(path.join(base, 'outside.jpg'), '(0,200,0)');
  writeFileSync(path.join(base, 'secret.txt'), 'not a picture');
  writeFileSync(path.join(dir, 'creatives', 'manifest.json'), JSON.stringify({ items: [
    { id: '1', page: 'A', kind: 'image', status: 'ok', files: ['creatives/1-1.jpg'] },
    { id: '2', page: 'B', kind: 'image', status: 'ok', files: ['../outside.jpg', '../secret.txt', 'C:/Windows/win.ini'] },
    { id: '3', page: 'C', kind: 'video_preview', status: 'ok', files: [], video: { status: 'ok', storyboard: '../outside.jpg' } }
  ] }));
  const r = py(path.join(SCRIPTS, 'contact_sheets.py'), dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /1 picture sheets and 0 video sheets/, 'only the picture inside creatives/ is used, the storyboard outside is skipped');
  assert.ok(existsSync(path.join(dir, 'creatives', 'sheets', 'sheet-01.jpg')));
  assert.equal(py(path.join(SCRIPTS, 'contact_sheets.py'), dir, '--tile', '100000').status, 1, 'a huge tile is refused');
});
