import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, parseCsv, geoCheck, snapshotWarnings } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot, loadNicheConfig } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { setCuration } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/curate.js';
import { selectAds, toRecords, csvOf, htmlOf } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_ads.js';
import { mdToHtml, buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';
import { trText, translateHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/i18n.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ad = (id, page, body = 'Some text of the ad about the thing', extra = {}) => normalizeAd({ ad_archive_id: id, page_id: 'p' + id, page_name: page, is_active: true, start_date: NOW - 20 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'Title', body: { text: body }, cta_text: 'Shop', link_url: `https://${page.toLowerCase().replace(/\W+/g, '')}.example/`, display_format: 'IMAGE', ...extra } }, 'q');
const node = (...args) => spawnSync('node', args, { encoding: 'utf8' });
const py = (...args) => spawnSync('python', ['-I', '-X', 'utf8', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

function snap(rows, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  for (const [f, v] of Object.entries(files)) writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
}

// ---- 3. CSV ----
test('parseCsv reads real CSV: unquoted fields, BOM, CRLF, quotes, comma and line break inside quotes', () => {
  const text = '﻿id,page,start,variants,title,body\r\n1,Shop A,2026-10-01,2,Hello,plain text\r\n2,"Shop, B",2026-10-02,1,"Say ""hi""","line one\nline two"\r\n\r\n3,Shop C,2026-10-03,1,,\r\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.page), ['Shop A', 'Shop, B', 'Shop C']);
  assert.equal(rows[1].title, 'Say "hi"');
  assert.equal(rows[1].body, 'line one\nline two');
  assert.equal(rows[0].variants, 2);
  assert.equal(rows[2].title, '');
});

test('parseCsv round-trips toCsv and still undoes the formula guard', () => {
  const rows = [ad('1', 'Page "Q", Inc', '=SUM(A1) and, commas'), ad('2', 'Другая страница', 'Текст з апострофом: дерев\'яний')];
  const back = parseCsv(toCsv(rows));
  assert.deepEqual(back.map(r => r.page), ['Page "Q", Inc', 'Другая страница']);
  assert.equal(back[0].body, '=SUM(A1) and, commas');
});

// ---- 8. curate.js set ----
test('curate set: decisions by name without case and spaces, one decision per page, criterion, confirm, not found', () => {
  const dir = snap([ad('1', 'Honey Farm '), ad('2', 'Sun Shop'), ad('3', 'Other One')]);
  let r = setCuration(dir, { include: [['honey farm', 'maker'], ['SUN  shop', 'shop']], exclude: ['Other One'], criterion: 'sells honey', note: 'n' });
  assert.deepEqual(r.not_found, []);
  assert.deepEqual(r.curation.include, { 'Honey Farm ': 'maker', 'Sun Shop': 'shop' });
  assert.deepEqual(r.curation.exclude, ['Other One']);
  assert.equal(r.curation.criterion, 'sells honey');
  assert.equal(r.curation.confirmed, undefined);
  r = setCuration(dir, { disputed: [['Sun Shop', 'sells honey and candles']], confirm: true });
  assert.equal(r.curation.include['Sun Shop'], undefined, 'a new decision replaces the old one');
  assert.equal(r.curation.disputed['Sun Shop'], 'sells honey and candles');
  assert.equal(r.curation.confirmed, true);
  r = setCuration(dir, { forget: ['Honey Farm'], include: [['Nope', 'x']] });
  assert.deepEqual(r.not_found, ['Nope']);
  assert.equal(r.curation.include, undefined, 'an empty whitelist is removed: it would keep nobody');
  const s = loadSnapshot(dir, undefined, { now: NOW });
  assert.equal(s.meta.curation.confirmed, true);
});

test('curate.js set (CLI): writes the file, exit code 3 and a message for an unknown name', () => {
  const dir = snap([ad('1', 'A shop'), ad('2', 'B shop')]);
  const ok = node(path.join(SCRIPTS, 'curate.js'), 'set', dir, '--include', 'A shop=maker', '--criterion', 'sells things', '--confirm');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /include 1/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'curation.json'), 'utf8')).confirmed, true);
  const bad = node(path.join(SCRIPTS, 'curate.js'), 'set', dir, '--exclude', 'Z shop');
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /Z shop/);
});

// ---- 9. export_ads ----
test('export_ads: types filter, CSV formula guard and BOM, HTML escaping, unknown type', () => {
  const dir = snap([ad('1', 'Maker A', '=HYPERLINK("x")'), ad('2', 'Shop B', '<script>alert(1)</script>'), ad('3', 'School C')],
    { 'curation.json': { include: { 'Maker A': 'maker', 'Shop B': 'shop', 'School C': 'school' } } });
  const s = loadSnapshot(dir, undefined, { now: NOW });
  const ads = selectAds(s, [], ['school']);
  assert.deepEqual(ads.map(r => r.page).sort(), ['Maker A', 'Shop B']);
  const recs = toRecords(s, selectAds(s, ['maker'], []));
  const csv = csvOf(recs);
  assert.ok(csv.startsWith('﻿"Page"'));
  assert.match(csv, /"'=HYPERLINK/);
  const html = htmlOf(toRecords(s, ads), 'T');
  assert.ok(!html.includes('<script>alert'), 'ad text is escaped');
  assert.match(html, /&lt;script&gt;/);
  const cli = node(path.join(SCRIPTS, 'export_ads.js'), dir, '--types', 'maker', '--format', 'csv');
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(readFileSync(path.join(dir, 'ads_list.csv'), 'utf8'), /Maker A/);
  assert.ok(!/Shop B/.test(readFileSync(path.join(dir, 'ads_list.csv'), 'utf8')));
  const bad = node(path.join(SCRIPTS, 'export_ads.js'), dir, '--types', 'nonsense');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Types in curation\.json: .*maker/);
});

// ---- 4. analysis.md ----
test('analysis.md: a safe small Markdown in the HTML report, nothing else gets through', () => {
  const html = mdToHtml('# Plan\n\n- **first** step <b>x</b>\n- second\n\n1. one\n2. two\n\nText with [link](http://evil.example) and <img src=x onerror=alert(1)>');
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(html, /<ul>\n<li><b>first<\/b> step &lt;b&gt;x&lt;\/b&gt;<\/li>/);
  assert.match(html, /<ol>/);
  assert.ok(!/<img|<a /.test(html), html);
  const page = buildHtml({ report: loadSnapshot(snap([ad('1', 'A'), ad('2', 'B')]), undefined, { now: NOW }).report, meta: {}, rows: [], warnings: [], query_stats: [], next_steps: [], images: {}, analysis: '## Conclusion\n- one' });
  assert.match(page, /<h2>Выводы<\/h2>/);
  assert.match(page, /Conclusion/);
});

// ---- 6. geo ----
test('geoCheck: confirmed, chain and unconfirmed advertisers; geo_only drops the other cities of a chain', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ad('C' + i, 'Chain Kids', i < 2 ? 'Центр у Чернівцях, запис' : 'Центр у Києві, запис')),
    ad('L1', 'Local Mudryk Чернівці', 'Заняття для дітей'), ad('L2', 'Local Mudryk Чернівці', 'Ще заняття'),
    ad('U1', 'Somewhere', 'Дитячий центр розвитку')
  ];
  const g = geoCheck(rows, ['чернів']);
  const kind = p => g.pages.find(x => x.page === p).kind;
  assert.equal(kind('Chain Kids'), 'chain');
  assert.equal(kind('Local Mudryk Чернівці'), 'confirmed');
  assert.equal(kind('Somewhere'), 'unconfirmed');
  const w = snapshotWarnings({ advertisers: 3, queryStats: [], ts: NOW, geo: g });
  assert.ok(w.some(x => x.code === 'geo_chain' && /Chain Kids/.test(x.message) && /2 из 6/.test(x.message)));
  assert.ok(w.some(x => x.code === 'geo_unconfirmed' && /Somewhere/.test(x.message)));
  const dir = snap(rows, { 'niche.json': { geo_terms: ['чернів'], geo_only: true } });
  const s = loadSnapshot(dir, undefined, { now: NOW });
  assert.equal(s.rows.filter(r => r.page === 'Chain Kids').length, 2, 'only the ads that name the city are kept');
  assert.ok(s.warnings.some(x => x.code === 'geo_chain' && /убраны из отчёта/.test(x.message)));
  assert.equal(s.geo.only, true);
  const dir2 = snap(rows, { 'niche.json': { geo_terms: ['чернів'] } });
  assert.equal(loadSnapshot(dir2, undefined, { now: NOW }).rows.length, rows.length, 'without geo_only nothing is removed');
  assert.throws(() => loadNicheConfig(snap(rows, { 'niche.json': { geo_terms: 'чернів' } })), /geo_terms/);
  assert.throws(() => loadNicheConfig(snap(rows, { 'niche.json': { geo_terms: ['(a+)+$'] } })), /too slow/);
});

// ---- 5. geo_compare ----
test('geo_compare: a row per place, advertisers in several places, differing run parameters', () => {
  const a = snap(['P1', 'P2', 'Both'].map((p, i) => ad('A' + i, p)));
  const b = snap(['P3', 'Both'].map((p, i) => ad('B' + i, p)));
  writeFileSync(path.join(b, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'PL', queries: ['q'] }));
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'gc-')), 'cmp.html');
  const r = node(path.join(SCRIPTS, 'geo_compare.js'), a, b, '--labels', 'Київ', 'Одеса', '--out', out, '--json');
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /Київ/);
  assert.match(html, /Одеса/);
  assert.match(html, /Both/, 'the advertiser in both places is listed');
  assert.match(html, /country: &quot;UA&quot; \/ &quot;PL&quot;|country: "UA" \/ "PL"/);
  assert.ok(existsSync(out.replace(/\.html$/, '.json')));
  assert.equal(node(path.join(SCRIPTS, 'geo_compare.js'), a).status, 2, 'one folder is not a comparison');
});

// ---- 10. scrape --geos-file ----
test('scrape.py --geos-file: reads the file, skips finished geos, stops at a captcha, rejects bad labels', () => {
  const code = `
import sys, types, json, tempfile
from pathlib import Path
sys.modules.setdefault("playwright", types.ModuleType("playwright"))
import importlib.util
spec = importlib.util.spec_from_file_location("scrape", ${JSON.stringify(path.join(SCRIPTS, 'scrape.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tmp = Path(tempfile.mkdtemp())
gf = tmp / "geos.json"
gf.write_text(json.dumps({"kyiv": ["фотограф Київ"], "odesa": {"keywords": ["фотограф Одеса", "фотограф Одесса"], "country": "UA"}, "lviv": ["фотограф Львів"]}, ensure_ascii=False), encoding="utf-8")
class A: pass
args = A(); args.geos_file = str(gf); args.out = str(tmp / "out"); args.status = "active"; args.media = "all"; args.sort = "impressions"; args.delay = 3.0; args.long_days = 90
args.country = "UA"; args.date_from = None; args.date_to = None; args.language = None; args.exact = False; args.headed = False; args.batch_pause = 30.0
(tmp / "out" / "kyiv").mkdir(parents=True)
(tmp / "out" / "kyiv" / "ads.csv").write_text("x"); (tmp / "out" / "kyiv" / "run.json").write_text("{}")
calls = []
def fake(cmd):
    label = Path(cmd[cmd.index("--out") + 1]).name
    calls.append(label)
    return 3 if label == "odesa" else 0
slept = []
rc = m.run_geos(args, run_geo=fake, sleep=slept.append)
print("RC", rc, calls, slept)
(tmp / "out" / "odesa").mkdir(); (tmp / "out" / "odesa" / "ads.csv").write_text("x"); (tmp / "out" / "odesa" / "run.json").write_text("{}")
calls.clear()
rc = m.run_geos(args, run_geo=lambda c: (calls.append(Path(c[c.index("--out") + 1]).name) or 0), sleep=slept.append)
print("RC2", rc, calls)
gf.write_text(json.dumps({"bad label": ["q"]}))
try:
    m.read_geos(str(gf))
except SystemExit as e:
    print("EXIT", e)
`;
  const r = py('-c', code);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RC 3 \['odesa'\] \[\]/, 'kyiv is finished and skipped, odesa hits a captcha and stops');
  assert.match(r.stdout, /RC2 0 \['lviv'\]/, 'the same command goes on with the geos that are left');
  assert.match(r.stdout, /EXIT --geos-file: bad label/);
});

// ---- 11. niche_check ----
test('niche_check: finds \\b with Cyrillic, a hook that catches nothing, circular words, and says what is wrong in a bad JSON', () => {
  const rows = [ad('1', 'A', 'Басейн і спа, сауна для всіх'), ad('2', 'B', 'Спа-готель з видом')];
  const dir = snap(rows, { 'niche.json': { extra_hooks: { 'спа': '\\bспа\\b', 'укриття': 'укриття', 'басейн': 'басейн' } } });
  const r = node(path.join(SCRIPTS, 'niche_check.js'), dir, '--json');
  const res = JSON.parse(r.stdout);
  const h = n => res.hooks.find(x => x.hook === n);
  assert.ok(h('спа').issues.some(i => /\\b with Cyrillic/.test(i)));
  assert.ok(h('укриття').issues.some(i => /catches no ad/.test(i)));
  assert.deepEqual(h('басейн').issues, []);
  assert.equal(h('басейн').ads, 1);
  assert.equal(r.status, 1);
  const badDir = snap(rows);
  writeFileSync(path.join(badDir, 'niche.json'), '{"extra_hooks": {"x": "\\d+"}}');
  const bad = node(path.join(SCRIPTS, 'niche_check.js'), badDir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not valid JSON/);
});

// ---- 2. --lang uk ----
test('i18n: our text is translated, third-party text is not', () => {
  assert.equal(trText('Предупреждения', 'uk'), 'Попередження');
  assert.equal(trText('Предупреждения', 'ru'), 'Предупреждения');
  assert.equal(trText('Сайт, Facebook-страница', 'uk'), 'Сайт, Сторінка Facebook');
  assert.match(trText('В выборке только 7 рекламодателей: выводы про хуки, форматы и «что работает» это гипотезы для проверки, а не тренд ниши.', 'uk'), /^У вибірці лише 7 рекламодавців: висновки/);
  const ad1 = 'Скидка на объявление для рекламодателей: все продукты выбор срез';
  assert.equal(trText(ad1, 'uk'), ad1, 'an ad text stays as it is');
  assert.equal(trText('Предупреждения о рекламодателях', 'uk'), 'Предупреждения о рекламодателях', 'only whole labels and long known pieces match');
  const html = '<!doctype html><html lang="ru"><head><title>Ads Library: X</title><style>.a::after{content:"Предупреждения"}</style></head><body><h1>Ads Library: X</h1><h2>Предупреждения</h2><p>Скидка для рекламодателей на выбор</p><p>Тип &amp; Дверь</p></body></html>';
  const out = translateHtml(html, 'uk');
  assert.match(out, /<html lang="uk"/);
  assert.match(out, /<h2>Попередження<\/h2>/);
  assert.match(out, /<h1>Бібліотека реклами: X<\/h1>/);
  assert.match(out, /content:"Предупреждения"/, 'style is untouched');
  assert.match(out, /<p>Скидка для рекламодателей на выбор<\/p>/);
});

test('export_html.js --lang uk: a whole report in Ukrainian, ad text untouched; bad --lang is refused', () => {
  const dir = snap([ad('1', 'Page A', 'Скидка на объявление для рекламодателей'), ad('2', 'Page B', 'Plain text'), ad('3', 'Page C', 'Other text')]);
  const out = path.join(dir, 'uk.html');
  const r = node(path.join(SCRIPTS, 'export_html.js'), dir, '--lang', 'uk', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<html lang="uk"/);
  assert.match(html, /Структура реклами/);
  assert.match(html, /Що ще можна зробити/);
  assert.match(html, /Дані: публічна Бібліотека реклами Meta, лише текст оголошень\./);
  assert.ok(!/Структура рекламы/.test(html));
  assert.equal(node(path.join(SCRIPTS, 'export_html.js'), dir, '--lang', 'de').status, 1);
});

const XLSX = py('-c', 'import openpyxl').status === 0;
test('export_xlsx.py --lang uk: sheets and headers in Ukrainian and the formulas still point at the renamed sheets; analysis.md becomes a sheet', { skip: !XLSX && 'openpyxl is not installed' }, () => {
  const dir = snap([ad('1', 'Page A'), ad('2', 'Page B'), ad('3', 'Page C')], { 'analysis.md': '## Висновок\n- перший пункт' });
  const out = path.join(dir, 'uk.xlsx');
  const r = py(path.join(SCRIPTS, 'export_xlsx.py'), dir, '--lang', 'uk', '--out', out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const check = py('-c', `
import openpyxl
wb = openpyxl.load_workbook(r"${out}")
print(wb.sheetnames)
bad = [c.value for ws in wb for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=") and ("'Объявления'" in c.value or "'Рекламодатели'" in c.value)]
print("stale", len(bad))
print([c.value for c in wb["Оголошення"][1]][:3])
print(wb["Висновки"]["A1"].value if "Висновки" in wb.sheetnames else "no analysis sheet")
`);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /'Зведення', 'Оголошення', 'Рекламодавці'/);
  assert.match(check.stdout, /stale 0/);
  assert.match(check.stdout, /Висновок/);
});
