// TikTok 0.1.6: the same three checks as Meta 0.15.7: hooks of local businesses off for online niches, the search-noise
// check for every slice (the Library matches any word of a query, also in the advertiser's name), an empty-market verdict.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report', 'scripts');
const C = require(path.join(SCRIPTS, 'collector.js'));
const { loadSnapshot } = require(path.join(SCRIPTS, 'report.js'));
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 7000;
const ad = (page, title, query = 'siłownia', daysAgo = 20) => C.normalizeLibraryAd({
  id: String(seq++), name: page, first_shown_date: (NOW - daysAgo * DAY) * 1000, last_shown_date: (NOW - 2 * DAY) * 1000, estimated_audience: '1K-10K', title
}, query);

test('queryMatch: word endings, the advertiser name does not count, Creative Center ads and ads without a query give null', () => {
  const m = (title, q, ignore) => C.queryMatch({ title, kws: [q], source: 'library' }, null, ignore);
  assert.equal(m('Trening na siłowni od zera', 'siłownia'), true, 'siłownia / siłowni');
  assert.equal(m('Czytaj nowy rozdział audiobooka', 'klub fitness'), false);
  assert.equal(C.queryMatch({ title: 'Klub fitness', page: 'Klub Czytelnika', kws: ['siłownia'], source: 'library' }), false, 'the name of the advertiser is not the text');
  assert.equal(m('Karnet od 99 zł', 'siłownia Warszawa', ['Warszawa']), false, 'the city is ignored, the other word is not there');
  assert.equal(m('Siłownia w Warszawie', 'siłownia Warszawa', ['Warszawa']), true);
  assert.equal(C.queryMatch({ title: 'x', kws: ['Top Ads'], source: 'cc' }), null);
  assert.equal(C.queryMatch({ title: 'x', kws: [], source: 'library' }), null);
});

test('local: false and skip_hooks drop base hooks of a business with an address and appointments', () => {
  const rows = [ad('A', 'Egipt all inclusive, zapisz się dziś', 'wycieczki')];
  const all = Object.keys(C.buildReport(rows, { now: NOW, source: 'library' }).hook_freq);
  for (const h of ['первый визит/заказ', 'запись/бронь', 'до/после', 'адрес/район']) assert.ok(all.includes(h), h);
  const online = Object.keys(C.buildReport(rows, { now: NOW, source: 'library', local: false }).hook_freq);
  for (const h of ['первый визит/заказ', 'запись/бронь', 'до/после', 'адрес/район']) assert.ok(!online.includes(h), h);
  assert.ok(online.includes('бесплатно'));
  assert.ok(!Object.keys(C.buildReport(rows, { now: NOW, source: 'library', skipHooks: ['акция'] }).hook_freq).includes('акция'));
});

const NOISE = Array.from({ length: 30 }, (_, i) => ad('Novel ' + i, 'Przeczytaj rozdział ' + i + ' historii miłosnej', 'siłownia'));
const GOOD = [ad('Gym One', 'Siłownia w centrum, pierwszy trening gratis', 'siłownia'), ad('Gym Two', 'Nowa siłownia otwarta', 'siłownia')];

function snapshot(rows, extra = {}, curation, niche) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ttn-'));
  writeFileSync(path.join(dir, 'ads.csv'), C.toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), source: 'library', country: 'PL', queries: ['siłownia'], ...extra }));
  if (curation) writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curation));
  if (niche) writeFileSync(path.join(dir, 'niche.json'), JSON.stringify(niche));
  return dir;
}

test('a slice that is not cleaned yet gets the noise warning; with query_match the noise leaves the report; after curation no warning', () => {
  const rows = [...NOISE, ...GOOD];
  const plain = loadSnapshot(snapshot(rows));
  assert.deepEqual(plain.query_check, { loose_ads: 30, ads_checked: 32, enforced: false });
  const warn = plain.warnings.find(w => w.code === 'loose_matches');
  assert.ok(warn);
  assert.match(warn.message, /30 из 32 объявлений \(94%\)/);
  assert.equal(plain.report.ads, 32, 'not enforced: the report is unchanged');
  const on = loadSnapshot(snapshot(rows, {}, null, { query_match: true }));
  assert.equal(on.report.ads, 2);
  assert.equal(on.query_check.enforced, true);
  assert.ok(on.warnings.some(w => w.code === 'loose_excluded'));
  assert.ok(!loadSnapshot(snapshot(rows, {}, { include: { 'Gym One': 'зал', 'Gym Two': 'зал' } })).warnings.some(w => w.code === 'loose_matches'));
});

test('the cities of run.json are not required in the ad text', () => {
  const rows = [ad('Gym One', 'Karnet od 99 zł, trening bez limitu', 'siłownia Warszawa')];
  assert.equal(loadSnapshot(snapshot(rows, { queries: ['siłownia Warszawa'] })).query_check.loose_ads, 1);
  assert.equal(loadSnapshot(snapshot(rows, { queries: ['siłownia Warszawa'], cities: ['Warszawa'] })).query_check.loose_ads, 1, 'siłownia is still missing');
  const rows2 = [ad('Gym One', 'Siłownia, karnet od 99 zł', 'siłownia Warszawa')];
  assert.equal(loadSnapshot(snapshot(rows2, { queries: ['siłownia Warszawa'] })).query_check.loose_ads, 1, 'without the city rule the city word is missing');
  assert.equal(loadSnapshot(snapshot(rows2, { queries: ['siłownia Warszawa'], cities: ['Warszawa'] })).query_check.loose_ads, 0);
});

test('after curation two advertisers or fewer: empty_market and two next steps; without curation or with more nothing changes', () => {
  const s = loadSnapshot(snapshot([...NOISE.slice(0, 5), ...GOOD], {}, { include: { 'Gym One': 'зал' } }));
  assert.ok(s.warnings.some(w => w.code === 'empty_market'));
  assert.ok(!s.warnings.some(w => w.code === 'small_sample'));
  assert.deepEqual(s.next_steps.map(x => x.code), ['empty_market', 'compare']);
  assert.ok(!loadSnapshot(snapshot(NOISE.slice(0, 5))).warnings.some(w => w.code === 'empty_market'), 'not curated');
  const many = loadSnapshot(snapshot(NOISE.slice(0, 5), {}, { include: Object.fromEntries(NOISE.slice(0, 5).map(r => [r.page, 'x'])) }));
  assert.ok(!many.warnings.some(w => w.code === 'empty_market'), 'five advertisers are not an empty market');
});
