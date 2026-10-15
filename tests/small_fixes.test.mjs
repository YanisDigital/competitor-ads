import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, applyCuration, lintCreatives } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadNicheConfig } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ad = (id, page) => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: page, is_active: true, start_date: NOW - 86400, publisher_platform: ['facebook'], snapshot: { title: 't', body: { text: 'b' }, cta_text: 'Shop', link_url: 'https://x.example/', display_format: 'IMAGE' } }, 'q');

function dirWithNiche(niche) {
  const dir = mkdtempSync(path.join(tmpdir(), 'small-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([ad('1', 'A')]));
  writeFileSync(path.join(dir, 'niche.json'), JSON.stringify(niche));
  return dir;
}

test('niche.json shape: seasons as an object, wrong types and bad dates give a clear message', () => {
  assert.throws(() => loadNicheConfig(dirWithNiche({ seasons: { name: 'x', from: '12-01', to: '12-31' } })), /"seasons" must be a list/);
  assert.throws(() => loadNicheConfig(dirWithNiche({ seasons: [{ name: 'x', from: 'dec', to: '12-31' }] })), /seasons\[0\]/);
  assert.throws(() => loadNicheConfig(dirWithNiche({ noise: 'a' })), /"noise" must be a list of strings/);
  assert.throws(() => loadNicheConfig(dirWithNiche({ local: 'no' })), /"local" must be true or false/);
  assert.throws(() => loadNicheConfig(dirWithNiche([])), /must be an object/);
  const ok = loadNicheConfig(dirWithNiche({ title: 'T', seasons: [{ name: 'x', from: '12-01', to: '01-10' }], noise: ['a'], local: false }));
  assert.equal(ok.config.title, 'T');
});

test('curation matches page names with trailing and doubled spaces', () => {
  const rows = [ad('1', 'Honey Farm '), ad('2', 'Sun  Shop'), ad('3', 'Other')];
  const c = applyCuration(rows, { include: { 'Honey Farm': 'maker', 'Sun Shop ': 'shop' }, disputed: { 'Other ': 'unclear' }, types: { 'Typo Page': 'x' } });
  assert.deepEqual(c.rows.map(r => r.id), ['1', '2']);
  assert.deepEqual(c.not_found, ['Typo Page']);
  assert.equal(c.disputed[0].page, 'Other');
  assert.equal(c.types['Honey Farm '], 'maker');
});

test('lintCreatives: creatives of advertisers removed by curation are neither asked for nor linted', () => {
  const manifest = { items: [{ id: '1', page: 'Kept', status: 'ok', kind: 'image' }, { id: '2', page: 'Gone', status: 'ok', kind: 'image' }] };
  const all = lintCreatives([], manifest);
  assert.equal(all.findings.filter(x => x.code === 'unlabeled').length, 2);
  const kept = lintCreatives([{ id: '2' }], manifest, { keepPages: new Set(['Kept ']) });
  assert.equal(kept.findings.filter(x => x.code === 'unlabeled').length, 1, 'only the kept advertiser is unlabeled');
  assert.ok(!kept.findings.some(x => x.id === '2'), 'a label of a removed advertiser is skipped, no unknown_id');
});

test('scrape.py --pages: names match without case and extra spaces; an unknown name stops with the known list', () => {
  const code = `
import sys, types
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
sys.modules.setdefault("playwright", types.ModuleType("playwright"))
import importlib.util
spec = importlib.util.spec_from_file_location("scrape", ${JSON.stringify(path.join(SCRIPTS, 'scrape.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
pages = [{"page_id": "1", "name": "Honey Farm"}, {"page_id": "2", "name": "Sun Shop"}]
print([p["name"] for p in m.select_pages(pages, ["  sun   shop ", "HONEY FARM", "sun shop"])])
print(len(m.select_pages(pages, None)))
try:
    m.select_pages(pages, ["Nope"])
except SystemExit as e:
    print("EXIT", e)
`;
  const r = spawnSync('python', ['-I', '-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\['Sun Shop', 'Honey Farm'\]/);
  assert.match(r.stdout, /\r?\n2\r?\n/);
  assert.match(r.stdout, /EXIT --pages: not among the advertisers.*Nope.*Known: Honey Farm, Sun Shop/);
});
