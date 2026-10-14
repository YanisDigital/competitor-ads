// Early products, refinements from the first live run: supplement and brand red flags,
// one product sold under several names, readable product names, the preset's queries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, earlyProducts } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESET = JSON.parse(readFileSync(path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;
const cfg = { ...PRESET.products };

const ad = (id, page, daysAgo, link, title, body = '', variants = 1) => normalizeAd({
  ad_archive_id: String(id), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: variants, snapshot: { title, body: { text: body }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, 'q');
const run = rows => earlyProducts(rows, { now: NOW, currency: 'USD', config: cfg });
const flagsOf = text => Object.entries(PRESET.products.red_flags).filter(([, s]) => new RegExp(s, 'i').test(text)).map(([k]) => k);

test('red flags: supplements and conditions the first live run missed are caught, home words are not', () => {
  for (const t of ['Ethiopian black seed oil your body needs', 'relieve gout naturally', 'diagnosed with dementia at 67', 'Lion\'s Mane keeps your brain sharp',
    'Natural support for your daily routine', 'tart cherry extract', 'I told my gynecologist', 'herbal capsules']) {
    assert.deepEqual(flagsOf(t), ['здоровье/медицина'], t);
  }
  for (const t of ['Screw extractor set for stripped screws', 'Oil stain remover for the garage floor', 'Under sink organizer', 'Dryer lint trap', 'Grout cleaner spray']) {
    assert.deepEqual(flagsOf(t), [], t);
  }
});

test('red flags: known brands and "official" wording are flagged, also from the page name and the domain', () => {
  assert.deepEqual(flagsOf('LifeStraw Go Series 650 ml'), ['известный бренд']);
  assert.deepEqual(flagsOf('Yeti Rambler tumbler'), ['известный бренд']);
  assert.deepEqual(flagsOf('Our official store, family owned since 1998'), ['бренд/патент']);
  const r = run([
    ad(1, 'LifeStraw', 20, 'https://lifestraw.com/products/lifestraw-go-series-650-ml', 'Two filters in one bottle', 'Safe water wherever you go, every trip', 3),
    ad(2, 'Store Q', 20, 'https://store-q.example/products/water-bottle-filter', 'Clean water on the trail, no boiling', 'Filters bacteria in one squeeze, fits any backpack', 3)
  ]);
  const life = r.top.find(p => p.handle === 'lifestraw-go-series-650-ml');
  assert.deepEqual(life.red_flags, ['известный бренд']);
  assert.equal(life.early, false);
  assert.equal(r.top.find(p => p.handle === 'water-bottle-filter').early, true, 'an ordinary dropshipped product stays');
});

test('grouping: the same body under different titles and handles is one product (one product sold under several names)', () => {
  const body = 'Premium Easy Rivet Set. Provides a modifiable way to fasten firewall additions, off-road modifications, body panels and bicycle attachments';
  const r = run([
    ad(1, 'Store A', 20, 'https://a.example/products/molly-bolt', 'Molly Bolt', body, 2),
    ad(2, 'Store B', 21, 'https://b.example/products/rivet-nut-set', '30PCS Rivet Nut Set', body),
    ad(3, 'Store C', 22, 'https://c.example/products/hollow-wall-anchors', 'Hollow Wall Anchors', body),
    ad(4, 'Store D', 23, 'https://d.example/products/button-rivet-kit', 'Button Rivet Kit', body)
  ]);
  assert.equal(r.found, 1, 'one product, not four');
  assert.equal(r.top[0].stores, 4);
  assert.equal(r.top[0].early, false, 'four stores are too many');
});

test('grouping: short or different bodies are not merged', () => {
  const r = run([
    ad(1, 'Store A', 20, 'https://a.example/products/one-thing', 'One', 'Great product, buy now'),
    ad(2, 'Store B', 20, 'https://b.example/products/other-thing', 'Other', 'Great product, buy now')
  ]);
  assert.equal(r.found, 2);
});

test('names: a handle that reads as words is the name, gibberish falls back to the ad text', () => {
  const r = run([
    ad(1, 'Store A', 20, 'https://a.example/products/c-shaped-under-sink-organizer', 'Under sink organizer', 'Fits around the pipes and doubles your storage space'),
    ad(2, 'Store B', 20, 'https://b.example/products/hqasj', 'Loose cabinet door? Fix it in a minute', 'Stripped screw holes repaired for good without a new cabinet'),
    ad(3, 'Store C', 20, 'https://c.example/products/towel', 'Upgrade your shower', 'A towel that dries in minutes and never gets musty again')
  ]);
  const names = Object.fromEntries(r.top.map(p => [p.handle, p.name]));
  assert.equal(names['c-shaped-under-sink-organizer'], 'c shaped under sink organizer');
  assert.match(names.hqasj, /Loose cabinet door/);
  assert.equal(names.towel, 'towel');
});

test('preset: the generic open-find phrases that triggered a captcha twice are gone, 15 queries remain', () => {
  const q = PRESET.services.map(s => s.en);
  assert.equal(q.length, 15);
  for (const bad of ['tired of', 'finally a solution', 'genius invention']) assert.ok(!q.includes(bad), bad);
  assert.ok(q.every(x => x.split(' ').length >= 2), 'every query is a specific phrase of two words or more');
});
