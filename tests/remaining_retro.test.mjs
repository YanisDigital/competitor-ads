import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, prioritizeHypotheses, checkFacts } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadNicheConfig } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ad = (id, page, body, q = 'q') => normalizeAd({ ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - 100 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'Title', body: { text: body }, cta_text: 'Shop', link_url: `https://${page.toLowerCase()}.example/`, display_format: 'IMAGE' } }, q);
const PAGES = ['A', 'B', 'C', 'D', 'E', 'F'];

test('A6: a structural hypothesis weighs like a weak one and says it has no competitor data behind it', () => {
  const ranked = prioritizeHypotheses([{ name: 'structure', evidence_strength: 'structural', effort: 1 }, { name: 'moderate', evidence_strength: 'moderate', effort: 2 }]);
  const s = ranked.find(x => x.name === 'structure');
  assert.equal(s.evidence, 1);
  assert.match(s.note, /без доказательств из данных конкурентов/);
  assert.equal(ranked[0].name, 'moderate', 'the one with data of competitors goes first');
});

test('C2: a hook is circular when a query word shares its stem, even with other endings', () => {
  const body = 'Сертифікат у подарунок, замовляйте подарунки і подарок для друзів';
  const rows = PAGES.flatMap(p => [ad(p + '1', p, body, 'подарунки партнерам'), ad(p + '2', p, body, 'подарунки партнерам')]);
  const r = buildReport(rows, { now: NOW });
  const hooks = r.hypothesis_inputs.underused_hooks.concat(r.hypothesis_inputs.winner_hooks).filter(h => /подар/.test(h.hook));
  assert.ok(Object.keys(r.hook_freq).some(k => /подар/.test(k)), 'the base set has a gift hook');
  for (const h of hooks) assert.equal(h.circular, true, h.hook);
  const other = buildReport(rows.map(x => ({ ...x, kws: ['dried flowers'] })), { now: NOW });
  for (const h of other.hypothesis_inputs.underused_hooks.concat(other.hypothesis_inputs.winner_hooks).filter(x => /подар/.test(x.hook))) assert.equal(h.circular, false, h.hook);
});

test('C1: business_type product drops the hooks of salons and courses from the free angles', () => {
  const rows = PAGES.map(p => ad(p + '1', p, 'Запис онлайн, навчання і курси, перший візит безкоштовно'));
  assert.ok('запись/бронь' in buildReport(rows, { now: NOW }).hook_freq);
  const prod = buildReport(rows, { now: NOW, businessType: 'product' }).hook_freq;
  for (const k of ['запись/бронь', 'первый визит', 'обучение/курсы', 'до/после', 'адрес/район']) assert.ok(!(k in prod), k);
  const dir = mkdtempSync(path.join(tmpdir(), 'bt-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'niche.json'), JSON.stringify({ business_type: 'goods' }));
  assert.throws(() => loadNicheConfig(dir), /"business_type" must be "product" or "service"/);
});

test('A5: checkFacts compares the numbers of a hypothesis with the report', () => {
  const r = buildReport(PAGES.map(p => ad(p + '1', p, 'Ручна робота, комплект на подарунок для вас')), { now: NOW });
  const hyp = n => [{ name: 'h', facts: [{ metric: 'advertisers', value: n }] }];
  assert.deepEqual(checkFacts(hyp(6), r), []);
  const bad = checkFacts(hyp(8), r);
  assert.equal(bad[0].code, 'fact_mismatch');
  assert.match(bad[0].message, /8.*6/);
  assert.equal(checkFacts([{ name: 'h', facts: [{ metric: 'nope.nothing', value: 1 }] }], r)[0].code, 'fact_unknown_metric');
  assert.deepEqual(checkFacts([{ name: 'h', facts: [{ metric: 'campaigns.count', value: r.campaigns.count }, { metric: 'formats_by_advertiser.IMAGE', value: 6 }] }], r), []);
});

function lintDir(extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(PAGES.map(p => ad(p + '1', p, 'Ручна робота, комплект на подарунок для вас'))));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  const hyp = { name: 'h1', signal_strength: 'moderate', angle: 'a', evidence: '6 of 6', headline: 'Handmade set', primary_text: 'Handmade dried flower set, ready to gift', cta: 'Shop', destination: 'site', format: 'image', test: 't', metric: 'CTR', risk: 'none', confirm_with_client: ['price'], ...extra };
  writeFileSync(path.join(dir, 'hypotheses.json'), JSON.stringify([hyp]));
  return dir;
}
const lint = dir => spawnSync('node', [path.join(SCRIPTS, 'lint_hypotheses.js'), dir], { encoding: 'utf8' });

test('A5: lint_hypotheses warns when the data changed after the last check, and fails on a wrong fact', () => {
  const dir = lintDir({ facts: [{ metric: 'advertisers', value: 6 }] });
  const first = lint(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(!/WARNING/.test(first.stdout));
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'hypotheses_lint.json'), 'utf8')).stale_numbers, false);
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ include: { A: 'maker', B: 'maker' } }));
  const second = lint(dir);
  assert.match(second.stdout, /WARNING: ads\.csv, curation\.json or niche\.json changed/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'hypotheses_lint.json'), 'utf8')).stale_numbers, true);
  assert.equal(second.status, 1, 'the fact "6 advertisers" is wrong after the cleaning (2 left)');
  assert.match(second.stdout, /fact_mismatch/);
});

const PIL = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
test('B8: contact_sheets.py makes 2x2 sheets and a labeling template from the vocabulary, and never touches creatives.json', { skip: !PIL && 'Pillow is not installed' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sheets-'));
  mkdirSync(path.join(dir, 'creatives'), { recursive: true });
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const rel = `creatives/${i}-1.jpg`;
    spawnSync('python', ['-c', `from PIL import Image; Image.new("RGB",(300,200),(200,50,${40 * i})).save(r"${path.join(dir, rel)}")`]);
    items.push({ id: String(i), page: 'A', kind: i === 5 ? 'carousel' : 'image', status: 'ok', files: [rel] });
  }
  writeFileSync(path.join(dir, 'creatives', 'manifest.json'), JSON.stringify({ items }));
  writeFileSync(path.join(dir, 'creatives.json'), '[]');
  const r = spawnSync('python', ['-I', path.join(SCRIPTS, 'contact_sheets.py'), dir], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(path.join(dir, 'creatives', 'sheets', 'sheet-01.jpg')) && existsSync(path.join(dir, 'creatives', 'sheets', 'sheet-02.jpg')));
  const todo = JSON.parse(readFileSync(path.join(dir, 'creatives.todo.json'), 'utf8'));
  assert.equal(todo.length, 5);
  assert.ok('subject' in todo[0] && !('carousel_story' in todo[0]) && !('hook_type' in todo[0]));
  assert.ok('carousel_story' in todo[4], 'only the carousel gets a story field');
  assert.equal(readFileSync(path.join(dir, 'creatives.json'), 'utf8'), '[]');
});

test('C6: check_sites.py --client refuses a non-public address before opening anything', () => {
  const dir = lintDir();
  const r = spawnSync('python', ['-I', path.join(SCRIPTS, 'check_sites.py'), dir, '--client', 'http://127.0.0.1:8080/'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--client must be a public http\(s\) address|playwright/i);
});
