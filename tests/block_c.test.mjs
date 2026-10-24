import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, currencyForCountry, buildQueries } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report');
const SCRIPTS = path.join(SKILL, 'scripts');
const NOW = 1_790_000_000;
const ad = (id, page, body) => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: page, is_active: true, start_date: NOW - 20 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'T', body: { text: body }, cta_text: 'Shop', link_url: `https://${page}.example/`, display_format: 'IMAGE' } }, 'q');
const py = (...args) => spawnSync('python', ['-I', '-X', 'utf8', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

function snap(country, rows, niche) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bc-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country, queries: ['q'] }));
  if (niche) writeFileSync(path.join(dir, 'niche.json'), JSON.stringify(niche));
  return dir;
}

// ---- 12. currency ----
test('more countries have a currency rule and their prices are read (UZ: sum, RU: rubles, GE: lari)', () => {
  assert.equal(currencyForCountry('UZ'), 'UZS');
  assert.equal(currencyForCountry('RU'), 'RUB');
  assert.equal(currencyForCountry('GE'), 'GEL');
  const uz = buildReport([ad('1', 'a', 'Курс за 450 000 сум в месяц'), ad('2', 'b', 'Урок 120000 сум')], { now: NOW, currency: 'UZS' });
  assert.equal(uz.prices.currency, 'UZS');
  assert.equal(uz.prices.ads_with_price, 2);
  assert.equal(uz.prices.min, 120000);
  const ru = buildReport([ad('1', 'a', 'Занятие 2500 руб')], { now: NOW, currency: 'RUB' });
  assert.equal(ru.prices.ads_with_price, 1);
});

test('a country without a currency rule: prices are not guessed as hryvnias, percentages still count, niche.json fixes it', () => {
  const rows = [ad('1', 'a', 'Курс за 450 грн, знижка 20%'), ad('2', 'b', 'Ціна 900 грн'), ad('3', 'c', 'Без ціни')];
  const dir = snap('BR', rows);
  const s = loadSnapshot(dir, undefined, { now: NOW });
  assert.equal(s.report.prices.currency, null);
  assert.equal(s.report.prices.currency_unknown, true);
  assert.equal(s.report.prices.ads_with_price, 0);
  assert.equal(s.report.prices.pct_off_mentions, 1, 'a percentage does not depend on the currency');
  assert.ok(!('цена в грн' in s.report.hook_freq), 'no hryvnia hook in a Brazilian niche');
  const w = s.warnings.find(x => x.code === 'currency_unknown');
  assert.ok(w && /BR/.test(w.message) && /niche\.json/.test(w.message));
  const fixed = loadSnapshot(snap('BR', rows, { currency: 'UAH' }), undefined, { now: NOW });
  assert.equal(fixed.report.prices.currency, 'UAH');
  assert.equal(fixed.report.prices.ads_with_price, 2);
  assert.ok(!fixed.warnings.some(x => x.code === 'currency_unknown'));
  assert.equal(loadSnapshot(snap('UA', rows), undefined, { now: NOW }).report.prices.ads_with_price, 2, 'Ukraine is unchanged');
});

// ---- 13. --pages-of keeps the decisions ----
test('scrape.py --pages-of: the new snapshot inherits curation.json and niche.json (geo_terms), never overwriting', () => {
  const code = `
import sys, types, json, tempfile
from pathlib import Path
sys.modules.setdefault("playwright", types.ModuleType("playwright"))
import importlib.util
spec = importlib.util.spec_from_file_location("scrape", ${JSON.stringify(path.join(SCRIPTS, 'scrape.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = Path(tempfile.mkdtemp())
src, out = tmp / "src", tmp / "out"
src.mkdir(); out.mkdir()
(src / "curation.json").write_text('{"include": {"A": "maker"}}'); (src / "niche.json").write_text('{"geo_terms": ["x"]}')
(out / "niche.json").write_text('{"mine": true}')
print(m.inherit_snapshot_files(str(src), str(out)))
print((out / "niche.json").read_text(), (out / "curation.json").read_text())
`;
  const r = py('-c', code);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\['curation\.json'\]/);
  assert.match(r.stdout, /\{"mine": true\}/, 'an existing niche.json is kept');
  assert.match(r.stdout, /"include"/);
});

// ---- 14. videos by default ----
test('fetch_creatives.py: --top-advertisers brings 10 videos by default, --videos 0 turns it off', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fc-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([ad('1', 'a', 'text')]));
  const code = (extra) => `
import sys, importlib.util
spec = importlib.util.spec_from_file_location("fc", ${JSON.stringify(path.join(SCRIPTS, 'fetch_creatives.py'))})
fc = importlib.util.module_from_spec(spec); spec.loader.exec_module(fc)
fc.select = lambda *a, **k: (print("VIDEOS", a[3]) or [])
sys.argv = ["fc", ${JSON.stringify(dir)}, ${extra}]
try:
    fc.main()
except SystemExit:
    pass
`;
  assert.match(py('-c', code('"--top-advertisers", "10"')).stdout, /VIDEOS 10/);
  assert.match(py('-c', code('"--top-advertisers", "10", "--videos", "0"')).stdout, /VIDEOS 0/);
  assert.match(py('-c', code('"--limit", "5"')).stdout, /VIDEOS 0/, 'without the leaders option nothing changes');
});

// ---- 15/16. templates and the hotels preset ----
test('templates ask for language, person and form; the briefs carry them', () => {
  for (const f of ['pitch.md', 'strategy_month1.md']) {
    const t = readFileSync(path.join(SKILL, 'references', f), 'utf8');
    assert.match(t, /proposal_language/);
    assert.match(t, /first_singular/);
  }
  for (const f of ['client.example.json', 'client.service.example.json', 'client.b2b.example.json']) {
    const c = JSON.parse(readFileSync(path.join(SKILL, f), 'utf8'));
    assert.equal(c.proposal_language, 'uk');
    assert.equal(c.proposal_style, 'prose');
  }
});

test('preset hotels-resort-ua: Ukrainian queries with the resort as the city, hooks that run, seasons and policy', () => {
  const p = JSON.parse(readFileSync(path.join(SKILL, 'presets', 'hotels-resort-ua.json'), 'utf8'));
  assert.equal(p.id, 'hotels-resort-ua');
  assert.deepEqual(p.languages, ['uk']);
  const qs = buildQueries(p, { uk: 'Буковель' }, 12);
  assert.equal(qs.length, 12);
  assert.equal(qs[0], 'готель Буковель');
  assert.ok(p.seasons.every(s => /^\d\d-\d\d$/.test(s.from) && /^\d\d-\d\d$/.test(s.to)));
  assert.ok(p.policy.length > 20);
  const rows = [ad('1', 'h1', 'Готель з басейном і спа, 100 м до підйомника, сніданок включено'), ad('2', 'h2', 'Чани та сауна, раннє бронювання до 1 листопада')];
  const dir = snap('UA', rows);
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...run, preset: 'hotels-resort-ua' }));
  const s = loadSnapshot(dir, undefined, { now: NOW });
  assert.ok(s.report.hook_freq['басейн/спа/сауна'] >= 2);
  assert.ok(s.report.hook_freq['близько до підйомника'] >= 1);
  assert.ok(s.report.hook_freq['раннє бронювання'] >= 1);
});
