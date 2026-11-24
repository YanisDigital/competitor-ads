// TikTok port of the Meta 0.16-0.17 changes: the CSV reader, curate.js, export_ads.js, geo_compare.js, niche_check.js, the new warnings and
// next steps, creative selection by leaders, facts in hypotheses, --lang uk (HTML and Excel), PDF, contact sheets and their safety.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report', 'scripts');
const C = require(path.join(SCRIPTS, 'collector.js'));
const { loadSnapshot, loadNicheConfig } = require(path.join(SCRIPTS, 'report.js'));
const { setCuration, listAdvertisers } = require(path.join(SCRIPTS, 'curate.js'));
const { selectAds, toRecords, csvOf, htmlOf } = require(path.join(SCRIPTS, 'export_ads.js'));
const { trText, translateHtml } = require(path.join(SCRIPTS, 'i18n.js'));
const { mdToHtml, buildHtml } = require(path.join(SCRIPTS, 'export_html.js'));

const NOW = 1_790_000_000;
const DAY = 86400;
const node = (...args) => spawnSync('node', args, { encoding: 'utf8' });
const py = (...args) => spawnSync('python', ['-I', '-X', 'utf8', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

let seq = 9000;
const ad = (page, title = 'Trening personalny, pierwszy trening gratis', query = 'siłownia', daysAgo = 20) => C.normalizeLibraryAd({
  id: String(seq++), name: page, first_shown_date: (NOW - daysAgo * DAY) * 1000, last_shown_date: (NOW - 2 * DAY) * 1000, estimated_audience: '1K-10K', title
}, query);

function snap(rows, files = {}, run = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ttp-'));
  writeFileSync(path.join(dir, 'ads.csv'), C.toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), source: 'library', country: 'PL', queries: ['siłownia'], ...run }));
  for (const [f, v] of Object.entries(files)) writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
}
const PAGES = ['Gym One', 'Gym Two', 'Gym Three', 'Gym Four', 'Gym Five', 'Gym Six'];
const six = () => PAGES.map(p => ad(p));

// ---- CSV ----
test('csvRecords/parseCsv read real CSV: no quotes, BOM, CRLF, quotes, a comma and a line break inside quotes; toCsv round-trips', () => {
  const text = '﻿id,page,start,title\r\n1,Shop A,2026-10-01,plain text\r\n2,"Shop, B",2026-10-02,"line one\nline two"\r\n\r\n3,Shop C,2026-10-03,\r\n';
  const rows = C.parseCsv(text);
  assert.deepEqual(rows.map(r => r.page), ['Shop A', 'Shop, B', 'Shop C']);
  assert.equal(rows[1].title, 'line one\nline two');
  const back = C.parseCsv(C.toCsv([ad('Page "Q", Inc', '=SUM(A1) and, commas'), ad('Інша сторінка', 'Текст з апострофом: дерев\'яний')]));
  assert.deepEqual(back.map(r => r.page), ['Page "Q", Inc', 'Інша сторінка']);
  assert.equal(back[0].title, '=SUM(A1) and, commas');
});

// ---- curate.js ----
test('curate set: decisions by name without case and spaces, one decision per page, criterion, confirm, not found', () => {
  const dir = snap([ad('Honey Gym '), ad('Sun Gym'), ad('Other One')]);
  let r = setCuration(dir, { include: [['honey gym', 'studio'], ['SUN  gym', 'club']], exclude: ['Other One'], criterion: 'sells a gym pass', note: 'n' });
  assert.deepEqual(r.not_found, []);
  assert.deepEqual(r.curation.include, { 'Honey Gym': 'studio', 'Sun Gym': 'club' });
  assert.equal(r.curation.confirmed, undefined);
  r = setCuration(dir, { disputed: [['Sun Gym', 'also sells clothes']], confirm: true });
  assert.equal(r.curation.include['Sun Gym'], undefined, 'a new decision replaces the old one');
  assert.equal(r.curation.confirmed, true);
  r = setCuration(dir, { forget: ['Honey Gym'], include: [['Nope', 'x']] });
  assert.deepEqual(r.not_found, ['Nope']);
  assert.equal(r.curation.include, undefined, 'an empty whitelist is removed: it would keep nobody');
  assert.equal(listAdvertisers(dir).length, 3);
});

test('curate.js (CLI): list prints the advertisers, set writes the file, exit code 3 for an unknown name', () => {
  const dir = snap([ad('A gym'), ad('B gym')]);
  const list = node(path.join(SCRIPTS, 'curate.js'), 'list', dir, '--json');
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).advertisers.length, 2);
  const ok = node(path.join(SCRIPTS, 'curate.js'), 'set', dir, '--include', 'A gym=studio', '--criterion', 'sells a pass', '--confirm');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'curation.json'), 'utf8')).confirmed, true);
  const bad = node(path.join(SCRIPTS, 'curate.js'), 'set', dir, '--exclude', 'Z gym');
  assert.equal(bad.status, 3);
  assert.match(bad.stderr, /Z gym/);
});

// ---- warnings and next steps ----
test('a cleaned but unconfirmed list: unconfirmed, no_criterion and the confirm step first; a confirmed list with a criterion has none', () => {
  const inc = Object.fromEntries(PAGES.map(p => [p, 'studio']));
  const a = loadSnapshot(snap(six(), { 'curation.json': { include: inc } }));
  const codes = a.warnings.map(w => w.code);
  assert.ok(codes.includes('unconfirmed'));
  assert.ok(codes.includes('no_criterion'));
  assert.equal(a.next_steps[0].code, 'confirm');
  const b = loadSnapshot(snap(six(), { 'curation.json': { include: inc, criterion: 'sells a gym pass', confirmed: true } }));
  for (const c of ['unconfirmed', 'no_criterion', 'mixed_types']) assert.ok(!b.warnings.some(w => w.code === c), c);
  assert.ok(!b.next_steps.some(s => s.code === 'confirm'));
});

test('mixed_types: more than three kinds of business among the competitors', () => {
  const types = ['studio', 'club', 'app', 'shop', 'school', 'coach'];
  const inc = Object.fromEntries(PAGES.map((p, i) => [p, types[i]]));
  const s = loadSnapshot(snap(six(), { 'curation.json': { include: inc, criterion: 'x', confirmed: true } }));
  assert.ok(s.warnings.some(w => w.code === 'mixed_types'));
});

test('dominant_advertiser: one advertiser is 30 percent and 5 ads or more; fewer than 5 ads is not flagged', () => {
  const rows = [...Array.from({ length: 6 }, (_, i) => ad('Big Gym', 'Trening nr ' + i + ', karnet bez limitu')), ...PAGES.slice(0, 3).map(p => ad(p))];
  const s = loadSnapshot(snap(rows));
  assert.ok(s.warnings.some(w => w.code === 'dominant_advertiser' && /Big Gym/.test(w.message)));
  assert.equal(s.report.dominant.page, 'Big Gym');
  const small = loadSnapshot(snap([...Array.from({ length: 3 }, (_, i) => ad('Big Gym', 'Trening nr ' + i)), ...PAGES.slice(0, 3).map(p => ad(p))]));
  assert.ok(!small.warnings.some(w => w.code === 'dominant_advertiser'));
});

test('few_competitors: under ten advertisers after cleaning', () => {
  const s = loadSnapshot(snap(six(), { 'curation.json': { include: Object.fromEntries(PAGES.map(p => [p, 'studio'])), criterion: 'x', confirmed: true } }));
  assert.ok(s.next_steps.some(x => x.code === 'few_competitors'));
});

test('a country without a currency rule: prices are not counted and the warning says so; niche.json currency fixes it', () => {
  const rows = PAGES.map(p => ad(p, 'Karnet od 99 w miesiącu, trening bez limitu'));
  const none = loadSnapshot(snap(rows, {}, { country: 'BR' }));
  assert.ok(none.warnings.some(w => w.code === 'currency_unknown'));
  assert.equal(none.report.prices.currency, null);
  const set = loadSnapshot(snap(rows, { 'niche.json': { currency: 'BRL' } }, { country: 'BR' }));
  assert.ok(!set.warnings.some(w => w.code === 'currency_unknown'));
});

// ---- niche.json ----
test('niche.json: business_type product drops the hooks of local businesses; a wrong shape is refused', () => {
  const rows = PAGES.map(p => ad(p, 'Zapisz się online, pierwsza wizyta gratis'));
  assert.ok('запись/бронь' in C.buildReport(rows, { now: NOW, source: 'library' }).hook_freq);
  assert.ok(!('запись/бронь' in C.buildReport(rows, { now: NOW, source: 'library', businessType: 'product' }).hook_freq));
  assert.throws(() => loadNicheConfig(snap(rows, { 'niche.json': { business_type: 'goods' } })), /business_type/);
  assert.throws(() => loadNicheConfig(snap(rows, { 'niche.json': { seasons: 'x' } })), /seasons/);
});

test('niche_check: finds a hook that catches nothing and says what is wrong in a bad JSON', () => {
  const dir = snap([ad('A', 'Basen i sauna dla wszystkich'), ad('B', 'Spa z widokiem')], { 'niche.json': { extra_hooks: { basen: 'basen', schron: 'schron' } } });
  const r = node(path.join(SCRIPTS, 'niche_check.js'), dir, '--json');
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.hooks.find(x => x.hook === 'basen').issues, []);
  assert.ok(res.hooks.find(x => x.hook === 'schron').issues.some(i => /catches no ad/.test(i)));
  assert.equal(r.status, 1);
  const badDir = snap([ad('A')]);
  writeFileSync(path.join(badDir, 'niche.json'), '{"extra_hooks": {"x": "\\d+"}}');
  const bad = node(path.join(SCRIPTS, 'niche_check.js'), badDir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not valid JSON/);
});

// ---- export_ads ----
test('export_ads: the list follows curation types, CSV text starting with = is written as text, HTML escapes and keeps http(s) links only', () => {
  const dir = snap([ad('Gym <b>One', '=HYPERLINK("http://evil.example")'), ad('Shop Two', 'Odzież sportowa')],
    { 'curation.json': { include: { 'Gym <b>One': 'studio', 'Shop Two': 'shop' }, types: { 'Gym <b>One': 'studio', 'Shop Two': 'shop' } } });
  const snapshot = loadSnapshot(dir);
  const rows = selectAds(snapshot, ['studio'], []);
  assert.equal(rows.length, 1);
  const recs = toRecords(snapshot, rows);
  assert.ok(!/(^|,)"=/m.test(csvOf(recs)), 'no cell starts with =');
  const html = htmlOf(recs, 'List');
  assert.ok(!/<b>One/.test(html));
  assert.ok(!/javascript:/i.test(html));
  const cli = node(path.join(SCRIPTS, 'export_ads.js'), dir, '--types', 'studio', '--out', path.join(dir, 'list.csv'));
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(existsSync(path.join(dir, 'list.csv')));
});

// ---- geo_compare ----
test('geo_compare: a row per place, advertisers in several places, differing run parameters', () => {
  const a = snap(['P1', 'P2', 'Both'].map(p => ad(p)));
  const b = snap(['P3', 'Both'].map(p => ad(p)), {}, { country: 'DE' });
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'ttgc-')), 'cmp.html');
  const r = node(path.join(SCRIPTS, 'geo_compare.js'), a, b, '--labels', 'Warszawa', 'Berlin', '--out', out, '--json');
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /Warszawa/);
  assert.match(html, /Berlin/);
  assert.match(html, /Both/);
  assert.ok(existsSync(out.replace(/\.html$/, '.json')));
  assert.equal(node(path.join(SCRIPTS, 'geo_compare.js'), a).status, 2, 'one folder is not a comparison');
});

// ---- creatives ----
const crow = (id, page, daysAgo) => ({ id, page, start: NOW - daysAgo * DAY, last: NOW - 2 * DAY, source: 'library', image_url: `https://cdn.example/${id}.jpg` });
test('selectCreatives: leaders get several, the others one; leadersOnly drops the others; types narrow the choice', () => {
  const rows = [];
  ['A', 'B', 'C', 'D'].forEach((p, i) => { for (let k = 0; k < 4 - i; k++) rows.push(crow(p + k, p, 10 + k)); });
  const all = C.selectCreatives(rows, { now: NOW, topAdvertisers: 2, limit: 30, perAdvertiser: 3 });
  assert.deepEqual(['A', 'B', 'C', 'D'].map(p => all.filter(s => s.page === p).length), [3, 3, 1, 1]);
  const lead = C.selectCreatives(rows, { now: NOW, topAdvertisers: 2, limit: 30, perAdvertiser: 3, leadersOnly: true });
  assert.deepEqual([...new Set(lead.map(s => s.page))], ['A', 'B']);
  const typed = C.selectCreatives(rows, { now: NOW, limit: 30, types: ['maker'], typeOf: { A: 'maker', C: 'maker', B: 'shop' } });
  assert.deepEqual([...new Set(typed.map(s => s.page))].sort(), ['A', 'C']);
});

test('lintCreatives: creatives of advertisers removed by curation are neither asked for nor linted', () => {
  const manifest = { items: [{ id: '1', page: 'Kept', status: 'ok', kind: 'image' }, { id: '2', page: 'Gone', status: 'ok', kind: 'image' }] };
  assert.equal(C.lintCreatives([], manifest).findings.filter(x => x.code === 'unlabeled').length, 2);
  const kept = C.lintCreatives([{ id: '2' }], manifest, { keepPages: new Set(['Kept ']) });
  assert.equal(kept.findings.filter(x => x.code === 'unlabeled').length, 1);
  assert.ok(!kept.findings.some(x => x.id === '2'), 'a label of a removed advertiser is skipped, no unknown_id');
});

// ---- facts and stale numbers ----
test('checkFacts compares the numbers of a hypothesis with the report; lint_hypotheses warns when the data changed', () => {
  const rows = six();
  const r = C.buildReport(rows, { now: NOW, source: 'library' });
  const hyp = n => [{ name: 'h', facts: [{ metric: 'advertisers', value: n }] }];
  assert.deepEqual(C.checkFacts(hyp(6), r), []);
  assert.equal(C.checkFacts(hyp(8), r)[0].code, 'fact_mismatch');
  assert.equal(C.checkFacts([{ name: 'h', facts: [{ metric: 'nope.nothing', value: 1 }] }], r)[0].code, 'fact_unknown_metric');
  const dir = snap(rows);
  writeFileSync(path.join(dir, 'hypotheses.json'), JSON.stringify([{ name: 'h1', signal_strength: 'moderate', angle: 'a', evidence: '6 of 6', headline: 'Karnet', primary_text: 'Pierwszy trening gratis', cta: 'Sign up', destination: 'site', format: 'video', test: 't', metric: 'CTR', risk: 'none', confirm_with_client: ['price'], hook_line: 'Pierwszy trening gratis', scenario: 'Trener w sali, haczyk w 0-3 s', facts: [{ metric: 'advertisers', value: 6 }] }]));
  const lint = () => node(path.join(SCRIPTS, 'lint_hypotheses.js'), dir);
  const first = lint();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(!/WARNING/.test(first.stdout));
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ include: { 'Gym One': 'studio', 'Gym Two': 'studio' } }));
  const second = lint();
  assert.match(second.stdout, /WARNING/);
  assert.match(second.stdout, /fact_mismatch/);
  assert.equal(second.status, 1);
});

// ---- --lang uk ----
test('i18n: our text is translated, third-party text is not', () => {
  assert.equal(trText('Предупреждения', 'uk'), 'Попередження');
  assert.equal(trText('Предупреждения', 'ru'), 'Предупреждения');
  const ad1 = 'Скидка на объявление для рекламодателей: все продукты выбор срез';
  assert.equal(trText(ad1, 'uk'), ad1, 'an ad text stays as it is');
  const html = '<!doctype html><html lang="ru"><head><title>X</title><style>.a::after{content:"Предупреждения"}</style></head><body><h2>Предупреждения</h2><p>Скидка для рекламодателей на выбор</p></body></html>';
  const out = translateHtml(html, 'uk');
  assert.match(out, /<html lang="uk"/);
  assert.match(out, /<h2>Попередження<\/h2>/);
  assert.match(out, /content:"Предупреждения"/, 'style is untouched');
  assert.match(out, /<p>Скидка для рекламодателей на выбор<\/p>/);
});

test('export_html.js --lang uk: the report is in Ukrainian, ad text is untouched; a bad --lang is refused', () => {
  const dir = snap([ad('Page A', 'Скидка на объявление для рекламодателей'), ad('Page B'), ad('Page C')]);
  const out = path.join(dir, 'uk.html');
  const r = node(path.join(SCRIPTS, 'export_html.js'), dir, '--lang', 'uk', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<html lang="uk"/);
  assert.match(html, /Попередження|Що ще можна зробити/);
  assert.equal(node(path.join(SCRIPTS, 'export_html.js'), dir, '--lang', 'de').status, 1);
});

const XLSX = py('-c', 'import openpyxl').status === 0;
test('export_xlsx.py --lang uk: Ukrainian sheets, analysis.md as a sheet, and no formula made from third-party text', { skip: !XLSX && 'openpyxl is not installed' }, () => {
  const dir = snap([ad('Page A', '=1+2 evil'), ad('Page B', '@cmd text'), ad('Page C')], { 'analysis.md': '## Висновок\n- перший пункт' });
  const out = path.join(dir, 'uk.xlsx');
  const r = py(path.join(SCRIPTS, 'export_xlsx.py'), dir, '--lang', 'uk', '--out', out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const c = py('-c', `
import openpyxl
wb = openpyxl.load_workbook(r"${out}")
bad = [(ws.title, c.coordinate) for ws in wb for row in ws.iter_rows() for c in row if c.data_type == "f" and isinstance(c.value, str) and ("evil" in c.value or "cmd" in c.value or c.value.startswith("=1+2"))]
print("BAD", bad)
print(wb.sheetnames)
print(wb["Висновки"]["A1"].value if "Висновки" in wb.sheetnames else "no analysis sheet")
`);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /BAD \[\]/);
  assert.match(c.stdout, /Зведення/);
  assert.match(c.stdout, /Висновок/);
});

// ---- analysis.md in HTML ----
test('analysis.md: a Markdown table becomes a table and the text is escaped; the section is in the report', () => {
  const html = mdToHtml('## T\n\n| a | b |\n|---|---|\n| 1 | <script>x</script> |\n');
  assert.match(html, /<table/);
  assert.ok(!/<script>x/.test(html));
  const dir = snap(six(), { 'analysis.md': '## Висновок\n- перший пункт\n' });
  const page = buildHtml({ ...loadSnapshot(dir), analysis: '## Висновок\n- перший пункт', images: {} });
  assert.match(page, /перший пункт/);
  assert.match(page, /Выводы/);
});

// ---- PDF and contact sheets ----
const PW = py('-c', 'import playwright').status === 0;
test('export_pdf.py: the whole report goes to a PDF file', { skip: !PW && 'playwright is not installed' }, () => {
  const dir = snap(six());
  const out = path.join(dir, 'report.pdf');
  const r = py(path.join(SCRIPTS, 'export_pdf.py'), dir, '--out', out);
  if (r.status !== 0 && /Executable doesn't exist|BrowserType\.launch/.test(r.stderr + r.stdout)) return;
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(out).slice(0, 4).toString(), '%PDF');
});

const PIL = py('-c', 'import PIL').status === 0;
test('contact_sheets.py reads only pictures inside <folder>/creatives, whatever manifest.json says', { skip: !PIL && 'Pillow is not installed' }, () => {
  const base = mkdtempSync(path.join(tmpdir(), 'ttcs-'));
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
  assert.match(r.stdout, /1 picture sheets and 0 video sheets/);
  assert.equal(py(path.join(SCRIPTS, 'contact_sheets.py'), dir, '--tile', '100000').status, 1, 'a huge tile is refused');
});
