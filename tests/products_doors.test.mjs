// Early products: only ads that lead to the advertiser's own store count (products.doors). Affiliate links to
// Amazon, marketplaces, phone calls and messages are not a store selling the product.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, buildReport, classifyDoor } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TT = require(path.join(__dirname, '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report', 'scripts', 'collector.js'));
const PRESET = JSON.parse(readFileSync(path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 1200;
const ad = (page, daysAgo, link, title, cta = 'Shop now', ctaType = 'SHOP_NOW') => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title, body: { text: 'Hair catcher for every shower drain, no more clogs' }, cta_text: cta, cta_type: ctaType, link_url: link, display_format: 'IMAGE' }
}, title);

const ROWS = [
  ad('Own Store', 120, 'https://own-store.example/products/hair-catcher', 'Hair catcher'),
  ad('Affiliate Page', 120, 'https://urlgeni.us/amzn/haircatcher', 'Hair catcher'),
  ad('Amazon Seller', 120, 'https://www.amazon.ca/dp/B000000', 'Hair catcher'),
  ad('Wholesale Page', 120, 'https://www.alibaba.com/product-detail/hair-catcher.html', 'Hair catcher'),
  ad('Call Page', 120, '', 'Hair catcher', 'Call now', 'CALL_NOW'),
  ad('Shower Pros', 20, 'https://own-2.example/products/hair-catcher-pro', 'Hair catcher pro'),
  ad('Pro Marble polishing and tile cleaning', 120, 'https://pro-marble.example/', 'Hair catcher'),
  ad('Clear Water Conditioning', 120, 'https://clear-water.example/', 'Hair catcher')
];

test('marketplaces: every Amazon domain, Alibaba, SHEIN, DHgate, Wish (both plugins)', () => {
  for (const u of ['https://www.amazon.ca/dp/1', 'https://www.amazon.co.uk/dp/1', 'https://www.alibaba.com/x', 'https://us.shein.com/x', 'https://www.dhgate.com/x', 'https://www.wish.com/x']) {
    assert.equal(classifyDoor({ link: u, cta: 'Shop now' }), 'Маркетплейс', u);
  }
  for (const u of ['https://www.alibaba.com/x', 'https://us.shein.com/x', 'https://www.dhgate.com/x', 'https://www.wish.com/x']) {
    assert.equal(TT.classifyDoor({ source: 'library', details: true, link: u }), 'Маркетплейс', 'tiktok ' + u);
  }
});

test('only ads leading to the own store count in the lists and the products; the rest is counted by door', () => {
  const r = buildReport(ROWS, { now: NOW, currency: 'USD', onlineOnly: true, baseHooks: false, products: PRESET.products });
  const long = r.longrun.map(x => x.page);
  assert.ok(long.includes('Own Store'));
  for (const n of ['Affiliate Page', 'Amazon Seller', 'Wholesale Page', 'Call Page']) assert.ok(!long.includes(n), n);
  assert.deepEqual(r.products.doors_kept, ['Сайт']);
  assert.equal(r.products.other_door_ads, 4);
  assert.deepEqual(r.products.other_doors, { 'Партнёрская ссылка': 1, 'Маркетплейс': 2, 'Звонок': 1 });
  assert.ok(!r.products.top.some(p => p.pages.includes('Affiliate Page')));
  assert.equal(r.ads, ROWS.length, 'the counts hold every ad');
  const html = buildHtml({ report: r, doors: {}, meta: { query_stats: [] }, rows: [], query_stats: [], warnings: [], next_steps: [], images: {}, generated: '2026-10-12' });
  assert.match(html, /ещё 4 ведут в другое место \(Маркетплейс 2/);
});

test('service companies by page name: marble polishing, tile cleaning, water conditioning; a product store with "Pros" stays', () => {
  const r = buildReport(ROWS, { now: NOW, currency: 'USD', onlineOnly: true, baseHooks: false, products: PRESET.products });
  const ex = r.products.excluded_pages.map(e => e.page);
  assert.ok(ex.includes('Pro Marble polishing and tile cleaning'));
  assert.ok(ex.includes('Clear Water Conditioning'));
  assert.ok(!ex.includes('Shower Pros') && !ex.includes('Own Store'));
});

test('without products.doors every door counts (other presets)', () => {
  const r = buildReport(ROWS, { now: NOW, currency: 'USD', products: { ...PRESET.products, doors: undefined } });
  assert.equal(r.products.doors_kept, null);
  assert.equal(r.products.other_door_ads, 0);
});
