import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildReport, currencyForCountry, siteFacts, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const NOW = 1_790_000_000;
const row = (id, page, body) => ({ id, page, page_id: 'p' + id, start: NOW - 20 * 86400, active: true, fmt: 'IMAGE', variants: 1, cta: 'x', link: 'https://' + page + '.example/', platforms: 'facebook', kws: ['q'], title: '', body });

test('currencyForCountry maps the countries we work in and returns null for unknown ones', () => {
  assert.equal(currencyForCountry('KZ'), 'KZT');
  assert.equal(currencyForCountry('kz'), 'KZT');
  assert.equal(currencyForCountry('UA'), 'UAH');
  assert.equal(currencyForCountry('US'), 'USD');
  assert.equal(currencyForCountry('DE'), null);
  assert.equal(currencyForCountry(undefined), null);
});

test('KZT: tenge prices in ₸, тг, тенге and KZT forms, and "вместо" discount pairs', () => {
  const rows = [
    row('1', 'a', 'Набор Kabrita за 19 999 тенге'),
    row('2', 'b', 'Пюре 1 200₸ в наличии'),
    row('3', 'c', 'Смесь 7 000 тг вместо 9 000 тг, доставка по Астане'),
    row('4', 'd', 'Каша 850 kzt'),
    row('5', 'e', 'Без цены в тексте')
  ];
  const r = buildReport(rows, { now: NOW, currency: 'KZT' });
  assert.equal(r.prices.currency, 'KZT');
  assert.equal(r.prices.ads_with_price, 4);
  assert.equal(r.prices.min, 850);
  assert.equal(r.prices.max, 19999);
  assert.equal(r.prices.discount_pairs, 1);
  assert.equal(r.prices.median_discount_pct, 22);
});

test('KZT: a tenge price is not read as hryvnia and a hryvnia price is not read as tenge', () => {
  const kzt = buildReport([row('1', 'a', '600 грн')], { now: NOW, currency: 'KZT' });
  assert.equal(kzt.prices.ads_with_price, 0);
  const uah = buildReport([row('1', 'a', '600 тг')], { now: NOW, currency: 'UAH' });
  assert.equal(uah.prices.ads_with_price, 0);
});

test('siteFacts reads tenge prices on a landing page', () => {
  const f = siteFacts('Смесь от 5 500 ₸, набор 12 000 тенге', { currency: 'KZT' });
  assert.deepEqual(f.prices.list, [5500, 12000]);
});

function snapshot(country, preset) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cur-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv([row('1', 'a', 'Набор за 19 999 тенге')]));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country, preset, queries: ['q'] }));
  return dir;
}

test('loadSnapshot takes the currency from the run country when the preset names none', () => {
  assert.equal(loadSnapshot(snapshot('KZ')).report.prices.currency, 'KZT');
  assert.equal(loadSnapshot(snapshot('US')).report.prices.currency, 'USD');
  assert.equal(loadSnapshot(snapshot('UA')).report.prices.currency, 'UAH');
  assert.equal(loadSnapshot(snapshot('DE')).report.prices.currency, 'UAH'); // unknown country keeps the old default
});

test('a preset currency wins over the run country', () => {
  assert.equal(loadSnapshot(snapshot('KZ', 'ecom-dropship-us')).report.prices.currency, 'USD');
});
