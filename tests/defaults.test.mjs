import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, selectCreatives, nextSteps } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot, loadNicheConfig } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };

// Ads of a fictional car-import niche (no preset for it).
const ad = (id, page, body, daysAgo = 120, snap = {}) => normalizeAd({ ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'Авто зі США', body: { text: body }, cta_text: 'Learn more', link_url: `https://${page.toLowerCase()}.example/`, display_format: 'IMAGE', images: [{ original_image_url: `https://a.fbcdn.net/${id}.jpg` }], ...snap } }, 'авто зі США');

function snapshot({ niche, preset, country = 'UA', daysOld = 1, extra = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'defaults-'));
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((p, i) => [ad(p + '1', p, 'Авто під ключ зі США, ціна від 9000$'), ad(p + '2', p, i < 3 ? 'Поетапна оплата, авто під ключ' : 'Доставка і розмитнення', 20)]);
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date((NOW - daysOld * 86400) * 1000).toISOString(), country, queries: ['авто зі США'], ...(preset ? { preset } : {}), ...extra }));
  if (niche) writeFileSync(path.join(dir, 'niche.json'), JSON.stringify(niche));
  return dir;
}
const NICHE = { title: 'Пригон авто з США', currency: 'USD', extra_hooks: { 'под ключ': 'під ключ|под ключ', 'поэтапная оплата': 'поетапн|поэтапн' }, noise: ['запчастин'] };

// ---- niche.json ------------------------------------------------------------------

test('loadNicheConfig: preset only, niche.json only, both merged (hooks joined, fields overridden), nothing', () => {
  const p = loadNicheConfig(snapshot(), 'beauty');
  assert.equal(p.config.title, 'Beauty salons, nails, brows, lashes');
  assert.equal(p.niche_file, false);
  const n = loadNicheConfig(snapshot({ niche: NICHE }), undefined);
  assert.equal(n.config.currency, 'USD');
  assert.equal(n.niche_file, true);
  const both = loadNicheConfig(snapshot({ niche: NICHE }), 'beauty');
  assert.ok(both.config.extra_hooks['стерильность'] && both.config.extra_hooks['под ключ'], 'preset and niche hooks together');
  assert.equal(both.config.currency, 'USD');
  assert.equal(both.config.title, 'Пригон авто з США');
  assert.equal(loadNicheConfig(snapshot(), undefined).config, null);
});

test('loadNicheConfig: a broken regular expression in niche.json names the hook', () => {
  const dir = snapshot({ niche: { extra_hooks: { 'сломанный': '(' } } });
  assert.throws(() => loadNicheConfig(dir), /niche\.json.*сломанный/);
});

test('loadSnapshot with niche.json: niche hooks counted per advertiser with strength, currency from the niche', () => {
  const s = loadSnapshot(snapshot({ niche: NICHE }), undefined, { now: NOW });
  assert.equal(s.report.hook_freq['под ключ'], 9);
  assert.equal(s.report.prices.currency, 'USD');
  const w = s.report.hypothesis_inputs.winner_hooks.find(h => h.hook === 'под ключ');
  assert.ok(w, JSON.stringify(s.report.hypothesis_inputs.winner_hooks));
  assert.equal(w.strength, 'strong');
  assert.equal(s.meta.niche_file, true);
  assert.equal(s.meta.preset_title, 'Пригон авто з США');
});

test('lint_hypotheses.js reads the niche hooks too (a claim about a niche hook is checked)', () => {
  const dir = snapshot({ niche: NICHE });
  writeFileSync(path.join(dir, 'hypotheses.json'), JSON.stringify([{ name: 'H', angle: 'a', evidence: ['e'], headline: 'Авто під ключ', primary_text: 'Поетапна оплата', cta: 'x', destination: 'd', test: 't', metric: 'm', risk: 'r' }]));
  const r = spawnSync('node', [path.join(SCRIPTS, 'lint_hypotheses.js'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

// ---- creatives of the leaders ----------------------------------------------------------

const row = (id, page, daysAgo) => ({ id, page, start: NOW - daysAgo * 86400, active: 'true', fmt: 'IMAGE', variants: 1, image_url: `https://a.fbcdn.net/${id}.jpg` });

test('selectCreatives topAdvertisers: only the N advertisers with the most ads, then the usual rules', () => {
  const rows = [];
  ['A', 'B', 'C', 'D'].forEach((p, i) => { for (let k = 0; k < 4 - i; k++) rows.push(row(p + k, p, 10 + k)); });
  const sel = selectCreatives(rows, { now: NOW, topAdvertisers: 2, limit: 30, perAdvertiser: 3 });
  assert.deepEqual([...new Set(sel.map(s => s.page))], ['A', 'B']);
  assert.equal(sel.length, 6);
  assert.equal(selectCreatives(rows, { now: NOW, limit: 30 }).length, 9, 'without the option every advertiser takes part');
});

test('creatives.js select --top-advertisers', () => {
  const dir = snapshot();
  const r = spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'select', dir, '--top-advertisers', '2', '--limit', '30'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const items = JSON.parse(readFileSync(path.join(dir, 'creatives', 'selection.json'), 'utf8')).items;
  assert.equal(new Set(items.map(i => i.page)).size, 2);
});

// ---- what else can be done -----------------------------------------------------------------

const base = { curated: false, has_image_links: true, has_page_id: true, age_days: 1, manifest: false, downloaded: 0, labeled: 0, sites: false, client: false, hypotheses: false, plan: false, diff: false, eu_country: false, eu: false, preset: true, niche: false, pages_of: false, rate_limited: 0, queries: 10 };
const codes = s => nextSteps({ ...base, ...s }).map(x => x.code);

test('nextSteps: without curation the first step is curation, and creatives wait for it', () => {
  const steps = nextSteps(base);
  assert.equal(steps[0].code, 'curate');
  const cr = steps.find(s => s.code === 'creatives');
  assert.ok(cr && cr.needs, 'creatives say they need curation first');
});

test('nextSteps: creatives are urgent while the links live, a re-collection after a week', () => {
  const fresh = nextSteps({ ...base, curated: true, age_days: 2 }).find(s => s.code === 'creatives');
  assert.equal(fresh.urgent, true);
  assert.ok(codes({ curated: true, age_days: 10 }).includes('creatives_recollect'));
  assert.ok(!codes({ curated: true, age_days: 10 }).includes('creatives'));
  assert.ok(codes({ curated: true, has_image_links: false }).includes('creatives_unavailable'));
  assert.ok(codes({ curated: true, manifest: true, downloaded: 30, labeled: 10 }).includes('creatives_label'));
  assert.ok(!codes({ curated: true, manifest: true, downloaded: 30, labeled: 30 }).some(c => c.startsWith('creatives')));
});

test('nextSteps: all ads of competitors, Meta limit, niche hooks, EU, brief and hypotheses', () => {
  assert.ok(codes({ curated: true }).includes('pages_of'));
  assert.ok(!codes({ curated: true, has_page_id: false }).includes('pages_of'));
  assert.ok(!codes({ curated: true, pages_of: true }).includes('pages_of'));
  const lim = nextSteps({ ...base, rate_limited: 3 }).find(s => s.code === 'rate_limited');
  assert.match(lim.title, /3 из 10/);
  assert.ok(codes({ preset: false, niche: false }).includes('niche_hooks'));
  assert.ok(!codes({ preset: false, niche: true }).includes('niche_hooks'));
  assert.ok(codes({ eu_country: true }).includes('eu'));
  assert.ok(!codes({ eu_country: false }).includes('eu'));
  assert.ok(codes({}).includes('brief'));
  assert.ok(codes({ client: true }).includes('hypotheses'));
  assert.ok(codes({ client: true, hypotheses: true }).includes('test_plan'));
});

test('nextSteps: when everything is done only the comparison in 1-2 weeks is left', () => {
  const all = { curated: true, manifest: true, downloaded: 30, labeled: 30, sites: true, client: true, hypotheses: true, plan: true, pages_of: true, niche: true };
  assert.deepEqual(codes(all), ['compare']);
  assert.deepEqual(codes({ ...all, diff: true }), []);
});

test('loadSnapshot returns next_steps from the files of the folder; HTML shows them escaped', () => {
  const dir = snapshot({ niche: NICHE, extra: { rate_limited_queries: ['авто зі США'] } });
  const s = loadSnapshot(dir, undefined, { now: NOW });
  const c = s.next_steps.map(x => x.code);
  assert.equal(c[0], 'curate');
  assert.ok(c.includes('rate_limited'));
  assert.ok(!c.includes('niche_hooks'));
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ exclude: [] }));
  mkdirSync(path.join(dir, 'x'), { recursive: true });
  const s2 = loadSnapshot(dir, undefined, { now: NOW });
  assert.ok(!s2.next_steps.some(x => x.code === 'curate'));
  const html = buildHtml({ ...s2, generated: '2026-10-07' });
  assert.match(html, /Что ещё можно сделать/);
});

const PYXLSX = spawnSync('python', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
test('xlsx: the summary sheet has the "what else" block', { skip: !PYXLSX && 'openpyxl not installed' }, () => {
  const dir = snapshot({ niche: NICHE });
  const r = spawnSync('python', [path.join(SCRIPTS, 'export_xlsx.py'), dir], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  const chk = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
ws = load_workbook(sys.argv[1])['Сводка']
print(json.dumps([[c for c in r] for r in ws.iter_rows(values_only=True)], ensure_ascii=False, default=str))
`, path.join(dir, 'report.xlsx')], { encoding: 'utf8', env: ENV });
  assert.equal(chk.status, 0, chk.stderr);
  assert.match(chk.stdout, /Что ещё можно сделать/);
  assert.match(chk.stdout, /под ключ/);
});

test('suggest_queries.js drafts a preset from niche.json after curation', () => {
  const dir = snapshot({ niche: NICHE });
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ exclude: [] }));
  const r = spawnSync('node', [path.join(SCRIPTS, 'suggest_queries.js'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.preset_draft.currency, 'USD');
  assert.ok(out.preset_draft.extra_hooks['под ключ']);
  assert.ok(Array.isArray(out.preset_draft.services) && out.preset_draft.services.length >= 1);
});
