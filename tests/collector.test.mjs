import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  normalizeAd,
  classifyDoor,
  domainOf,
  resultCountOf,
  buildQueries,
  buildReport,
  toCsv,
  parseCsv,
  diffSnapshots
} from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

// All fixtures are synthetic (invented names, invented numbers) — never
// real scraped Ads Library data. No network calls happen in this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadFixture = (name) => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

const REFERENCE_NOW = 1700000000; // fixed "now" so age-bucket math is deterministic

test('normalizeAd maps a plain ad node to a flat record', () => {
  const rec = normalizeAd(loadFixture('basic-ad.json'), 'манікюр');
  assert.equal(rec.id, '1001');
  assert.equal(rec.page, 'Salon A');
  assert.equal(rec.title, 'Манікюр зі знижкою 20%');
  assert.equal(rec.cta, 'Learn more');
  assert.equal(rec.link, 'https://salon-a.example/promo');
  assert.equal(rec.platforms, 'facebook|instagram');
  assert.deepEqual(rec.kws, ['манікюр']);
  assert.equal(rec.ncards, 0);
});

test('normalizeAd resolves DCO template text from the first non-empty card', () => {
  const rec = normalizeAd(loadFixture('dco-ad.json'), 'брови');
  assert.equal(rec.title, 'Манікюр гель-лак');
  assert.equal(rec.body, 'Тільки до кінця тижня знижка 15%');
  assert.equal(rec.cta, 'Book now');
  assert.equal(rec.link, 'https://nailstudio-b.example');
  assert.equal(rec.ncards, 2);
});

test('normalizeAd keeps top-level snapshot text for a carousel (no template)', () => {
  const rec = normalizeAd(loadFixture('carousel-ad.json'), 'стоматологія');
  assert.equal(rec.title, 'Стоматологія без страху');
  assert.match(rec.body, /Розстрочка/);
  assert.equal(rec.cta, 'Sign up');
  assert.equal(rec.link, 'https://dental-c.example');
  assert.equal(rec.ncards, 3);
});

test('domainOf unwraps l.facebook.com/l.php redirect links', () => {
  const rec = normalizeAd(loadFixture('redirect-link-ad.json'), 'брови');
  assert.equal(domainOf(rec.link), 'beautybar-d.example');
});

test('domainOf returns empty string for missing/invalid links', () => {
  assert.equal(domainOf(''), '');
  assert.equal(domainOf('not a url'), '');
});

test('classifyDoor recognizes WhatsApp, Telegram, Messenger, site and no-link cases', () => {
  assert.equal(classifyDoor(normalizeAd(loadFixture('whatsapp-ad.json'), 'k')), 'WhatsApp');
  assert.equal(classifyDoor(normalizeAd(loadFixture('telegram-ad.json'), 'k')), 'Telegram');
  assert.equal(classifyDoor(normalizeAd(loadFixture('messenger-cta-ad.json'), 'k')), 'Директ/Messenger');
  assert.equal(classifyDoor(normalizeAd(loadFixture('redirect-link-ad.json'), 'k')), 'Сайт');
  assert.equal(classifyDoor(normalizeAd(loadFixture('no-link-ad.json'), 'k')), 'Без ссылки');
});

test('buildReport computes age buckets and longrun across the fixture set', () => {
  const fixtureNames = [
    'basic-ad.json', 'dco-ad.json', 'carousel-ad.json', 'redirect-link-ad.json',
    'whatsapp-ad.json', 'telegram-ad.json', 'no-link-ad.json', 'messenger-cta-ad.json'
  ];
  const rows = fixtureNames.map(name => normalizeAd(loadFixture(name), 'k'));
  const report = buildReport(rows, { now: REFERENCE_NOW, longDays: 90 });

  assert.equal(report.ads, 8);
  assert.equal(report.advertisers, 8);
  assert.deepEqual(report.age_buckets, { '<7': 2, '7-30': 2, '30-90': 1, '90-365': 2, '>365': 1 });

  // longrun (age >= 90 days): whatsapp (400d), telegram (200d), redirect-link (120d), oldest first
  assert.equal(report.longrun.length, 3);
  assert.deepEqual(report.longrun.map(r => r.page), ['Fitness Studio E', 'Auto Service F', 'Beauty Bar D']);
});

test('buildReport counts recurring hooks (RU/UA/EN) across the fixture set', () => {
  const fixtureNames = [
    'basic-ad.json', 'dco-ad.json', 'carousel-ad.json', 'redirect-link-ad.json',
    'whatsapp-ad.json', 'telegram-ad.json', 'no-link-ad.json', 'messenger-cta-ad.json'
  ];
  const rows = fixtureNames.map(name => normalizeAd(loadFixture(name), 'k'));
  const report = buildReport(rows, { now: REFERENCE_NOW });

  assert.equal(report.hook_freq['процент/скидка'], 5); // basic, dco, carousel, redirect-link, telegram
  assert.equal(report.hook_freq['гарантия'], 2); // basic, messenger-cta
  assert.equal(report.hook_freq['бесплатно'], 1); // whatsapp
  assert.equal(report.hook_freq['первый визит'], 1); // redirect-link
  assert.equal(report.hook_freq['опыт/годы'], 1); // messenger-cta
});

test('buildReport dedupes rows by id, keeping the last occurrence', () => {
  const first = normalizeAd(loadFixture('basic-ad.json'), 'манікюр');
  const second = normalizeAd(loadFixture('basic-ad.json'), 'салон краси');
  const report = buildReport([first, second], { now: REFERENCE_NOW });
  assert.equal(report.ads, 1);
  assert.equal(report.advertisers, 1);
});

test('classifyDoor: "Send message" with an instagram.com link is Direct, not a profile', () => {
  assert.equal(classifyDoor(normalizeAd(loadFixture('instagram-direct-ad.json'), 'k')), 'Директ/Messenger');
  assert.equal(classifyDoor({ cta: 'Visit Instagram profile', link: 'https://www.instagram.com/x' }), 'Instagram-профиль');
});

test('resultCountOf reads the results counter in English, Ukrainian and Russian', () => {
  assert.equal(resultCountOf('~73 results'), '~73 results');
  assert.equal(resultCountOf('Ukraine ~73 результати'), '~73 результати');
  assert.equal(resultCountOf('~1,200 результатов'), '~1,200 результатов');
  assert.equal(resultCountOf('nothing here'), '0 results');
});

test('buildReport extracts prices, discount pairs, page and ad links', () => {
  const rows = [normalizeAd(loadFixture('instagram-direct-ad.json'), 'k'), normalizeAd(loadFixture('carousel-ad.json'), 'k')];
  const r = buildReport(rows, { now: REFERENCE_NOW, longDays: 1 });
  assert.equal(r.prices.ads_with_price, 1);
  assert.equal(r.prices.min, 600);
  assert.equal(r.prices.median_discount_pct, 20);
  assert.match(r.top_pages.find(p => p.page === 'Studio I').library_url, /view_all_page_id=p9/);
  assert.match(r.longrun[0].url, /ads\/library\/\?id=\d+/);
});

test('buildReport keeps at most 2 longrun entries per advertiser', () => {
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const rows = [1, 2, 3, 4].map(i => ({ ...base, id: 'x' + i, start: REFERENCE_NOW - (100 + i) * 86400 }));
  assert.equal(buildReport(rows, { now: REFERENCE_NOW }).longrun.length, 2);
});

const PRESET_DIR = path.join(__dirname, '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/presets');
const loadPreset = (id) => JSON.parse(readFileSync(path.join(PRESET_DIR, id + '.json'), 'utf8'));

test('every preset is well-formed and its extra_hooks compile', () => {
  const ids = readdirSync(PRESET_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  assert.ok(ids.length >= 7);
  for (const id of ids) {
    const p = loadPreset(id);
    assert.equal(p.id, id);
    assert.ok(p.services.length >= 4);
    for (const s of p.services) for (const lang of p.languages) assert.ok(s[lang], `${id}: missing ${lang}`);
    for (const src of Object.values(p.extra_hooks)) assert.doesNotThrow(() => new RegExp(src));
  }
});

test('buildQueries: services x languages with city per language, capped and deduped', () => {
  const q = buildQueries(loadPreset('beauty'), { uk: 'Одеса', ru: 'Одесса' }, 12);
  assert.equal(q.length, 12);
  assert.equal(q[0], 'салон краси Одеса');
  assert.equal(q[1], 'салон красоты Одесса');
  assert.equal(new Set(q).size, q.length);
  assert.equal(buildQueries(loadPreset('beauty'), { uk: 'Одеса', ru: 'Одесса' }, 4).length, 4);
  assert.equal(buildQueries(loadPreset('beauty'), {}, 2)[0], 'салон краси');
});

test('buildReport applies preset extra hooks, the address hook and flags noise pages', () => {
  const beauty = loadPreset('beauty');
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const rows = [
    { ...base, id: 'a', page: 'Salon', body: '3-етапна стерилізація 📍 вул. Новосельського, 38' },
    { ...base, id: 'b', page: 'School', body: 'Курс манікюру для початківців' }
  ];
  const r = buildReport(rows, { now: REFERENCE_NOW, extraHooks: beauty.extra_hooks, noise: beauty.noise });
  assert.equal(r.hook_freq['стерильность'], 1);
  assert.equal(r.hook_freq['адрес/район'], 1);
  assert.deepEqual(r.noise_candidates.map(n => n.page), ['School']);
});

test('buildQueries: English-only preset with no city', () => {
  const q = buildQueries(loadPreset('ecom-dropship-us'), {}, 3);
  assert.deepEqual(q, ['car door lock cover', 'pet stain remover', 'led car lights']);
});

test('classifyDoor: affiliate links get their own door and are not an advertiser site', () => {
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://amzlink.to/az0abc' }), 'Партнёрская ссылка');
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://urlgeni.us/x' }), 'Партнёрская ссылка');
  const rows = [{ ...normalizeAd(loadFixture('basic-ad.json'), 'k'), link: 'https://amzlink.to/az0abc' }];
  assert.equal(buildReport(rows, { now: REFERENCE_NOW }).top_pages[0].sites, '');
});

test('buildReport flags local and platform pages, and onlineOnly drops them from longrun/samples', () => {
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const old = REFERENCE_NOW - 400 * 86400;
  const rows = [
    { ...base, id: '1', page: 'Local Pet Shop', cta: 'Get directions', link: 'https://localpets.example', start: old, variants: 1 },
    { ...base, id: '2', page: 'Big Market', cta: 'Shop now', link: 'https://www.amazon.com/dp/x', start: old, variants: 1 },
    { ...base, id: '3', page: 'Online Store', cta: 'Shop now', link: 'https://store.myshopify.com/p', start: old, variants: 1 },
    { ...base, id: '4', page: 'Online Store B', cta: 'Shop now', link: 'https://b.example', start: old + 86400, variants: 9 }
  ];
  const all = buildReport(rows, { now: REFERENCE_NOW });
  assert.deepEqual(all.local_pages, ['Local Pet Shop']);
  assert.deepEqual(all.platform_pages, ['Big Market']);
  assert.deepEqual(all.shopify_stores.map(s => s.page), ['Online Store']);
  assert.equal(all.longrun.length, 4);
  const online = buildReport(rows, { now: REFERENCE_NOW, onlineOnly: true });
  assert.deepEqual(online.longrun.map(l => l.page), ['Online Store B', 'Online Store']); // more variants first
  assert.ok(!online.samples.some(s => s.page === 'Local Pet Shop' || s.page === 'Big Market'));
});

test('catalog ads: unresolved {{placeholders}} are stripped and flagged, counted in the report', () => {
  const node = { ad_archive_id: 'c1', page_id: 'p', page_name: 'Shop', start_date: REFERENCE_NOW - 86400,
    snapshot: { title: '#1 Metal Building Company | {{product.brand}}', body: '{{product.name}}', cards: [] } };
  const rec = normalizeAd(node, 'k');
  assert.equal(rec.catalog, true);
  assert.equal(rec.title, '#1 Metal Building Company |'.replace(/\s*\|$/, ''));
  assert.equal(rec.body, '');
  assert.equal(buildReport([rec], { now: REFERENCE_NOW }).catalog_ads, 1);
  // A DCO ad whose template is resolved from a card is not a catalog ad.
  assert.equal(normalizeAd(loadFixture('dco-ad.json'), 'k').catalog, false);
});

test('classifyDoor: app stores and short links get their own doors; tiktok.com is not a marketplace', () => {
  assert.equal(classifyDoor({ cta: 'Install now', link: 'https://apps.apple.com/us/app/x/id1' }), 'Установка приложения');
  assert.equal(classifyDoor({ cta: 'Install now', link: 'https://play.google.com/store/apps/details?id=x' }), 'Установка приложения');
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://bit.ly/4eL3wrX' }), 'Короткая ссылка');
  assert.equal(classifyDoor({ cta: 'Learn more', link: 'https://www.tiktok.com/business' }), 'Сайт');
});

test('buildReport baseHooks:false reports only the preset hooks', () => {
  const r = buildReport([normalizeAd(loadFixture('basic-ad.json'), 'k')], { now: REFERENCE_NOW, baseHooks: false, extraHooks: { x: 'знижк' } });
  assert.deepEqual(Object.keys(r.hook_freq), ['x']);
  assert.equal(r.hook_freq.x, 1);
});

test('buildReport: USD prices, was/now pairs and % off for US presets', () => {
  const us = loadPreset('ecom-dropship-us');
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const rows = [
    { ...base, id: 'a', title: '', body: 'Only $29.99 (was $59.99). 50% OFF today only! Free shipping' },
    { ...base, id: 'b', title: '', body: 'Was $40 now $30 — only 12 left' }
  ];
  const r = buildReport(rows, { now: REFERENCE_NOW, currency: us.currency, extraHooks: us.extra_hooks });
  assert.equal(r.prices.currency, 'USD');
  assert.equal(r.prices.ads_with_price, 2);
  assert.equal(r.prices.min, 29.99);
  assert.equal(r.prices.discount_pairs, 2);
  assert.equal(r.prices.median_pct_off, 50);
  assert.equal(r.hook_freq['бесплатная доставка'], 1);
  assert.equal(r.hook_freq['ограниченный запас'], 1);
});

test('classifyDoor: Telegram bots and marketplaces get their own door', () => {
  assert.equal(classifyDoor({ cta: 'Learn more', link: 'https://t.me/course_signup_bot' }), 'Telegram-бот');
  assert.equal(classifyDoor({ cta: 'Learn more', link: 'https://t.me/channel_name' }), 'Telegram');
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://prom.ua/p123-item.html' }), 'Маркетплейс');
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://www.amazon.com/dp/B0X' }), 'Маркетплейс');
  assert.equal(classifyDoor({ cta: 'Shop now', link: 'https://mystore.com/products/x' }), 'Сайт');
});

test('creative_clusters and store_groups find copied creatives and shared stores', () => {
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const copy = 'Last Day 50% OFF Instant Posture Corrector, had enough of backaches?';
  const rows = [
    { ...base, id: '1', page: 'Page A', title: copy, body: '', link: 'https://shop.example/a' },
    { ...base, id: '2', page: 'Page B', title: copy, body: '', link: 'https://shop.example/b' },
    { ...base, id: '3', page: 'Page C', title: 'A totally different and long enough ad text here', body: '', link: 'https://other.example' }
  ];
  const r = buildReport(rows, { now: REFERENCE_NOW });
  assert.equal(r.creative_clusters.length, 1);
  assert.deepEqual(r.creative_clusters[0].pages.sort(), ['Page A', 'Page B']);
  assert.deepEqual(r.store_groups, [{ site: 'shop.example', pages: ['Page A', 'Page B'] }]);
});

test('local detection: an address is a strong signal, one "visit us" is not', () => {
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k');
  const rows = [
    { ...base, id: '1', page: 'Dealer', cta: 'Shop now', title: '', body: 'Trailers in stock! Melbourne, FL 32901' },
    { ...base, id: '2', page: 'Online', cta: 'Shop now', title: '', body: 'Visit us at our store online' },
    { ...base, id: '3', page: 'Online', cta: 'Shop now', title: '', body: 'Great gadget for your car' },
    { ...base, id: '4', page: 'Online', cta: 'Shop now', title: '', body: 'Another great gadget' }
  ];
  assert.deepEqual(buildReport(rows, { now: REFERENCE_NOW }).local_pages, ['Dealer']);
});

test('parseCsv is the inverse of toCsv, including the formula-injection prefix', () => {
  const base = normalizeAd(loadFixture('basic-ad.json'), 'k1');
  const rows = [{ ...base, kws: ['k1', 'k2'], title: '=SUM(1)', body: 'Say "hi", ok' }];
  const back = parseCsv(toCsv(rows));
  assert.equal(back.length, 1);
  assert.equal(back[0].id, base.id);
  assert.equal(back[0].title, '=SUM(1)');
  assert.equal(back[0].body, 'Say "hi", ok');
  assert.deepEqual(back[0].kws, ['k1', 'k2']);
  assert.equal(back[0].start, Math.floor(base.start / 86400) * 86400);
});

test('diffSnapshots: new, stopped (with confidence), survived, scaling, page changes', () => {
  const DAY = 86400, T0 = REFERENCE_NOW, T1 = T0 + 14 * DAY;
  const mk = (id, page, ageDays, variants, kws) => ({ id, page, start: T0 - ageDays * DAY, variants, kws, title: 't' + id, body: '' });
  const prev = [
    mk('a', 'Store A', 5, 1, ['q1']),      // young test, still running
    mk('b', 'Store B', 3, 1, ['q1']),      // young test, gone, q1 re-run unsaturated -> high
    mk('c', 'Store C', 200, 2, ['q2']),    // old, gone, q2 NOT re-run -> low
    mk('d', 'Store D', 100, 1, ['q1'])     // old, survives and gains variants
  ];
  const curr = [
    mk('a', 'Store A', 19, 1, ['q1']),
    mk('d', 'Store D', 114, 4, ['q1']),
    mk('e', 'Store E', 1, 1, ['q1']),
    mk('f', 'Store E', 1, 1, ['q1']),
    mk('g', 'Store E', 1, 1, ['q1']),
    mk('h', 'Store E', 1, 1, ['q1'])
  ];
  const d = diffSnapshots(prev, curr, { prevTs: T0, currTs: T1, cap: 90 });
  assert.equal(d.interval_days, 14);
  assert.equal(d.survived, 2);
  assert.equal(d.new_ads.count, 4);
  assert.equal(d.stopped.count, 2);
  assert.equal(d.stopped.high_confidence, 1);
  assert.equal(d.stopped.top.find(s => s.id === 'b').confidence, 'high');
  assert.equal(d.stopped.top.find(s => s.id === 'c').confidence, 'low');
  assert.deepEqual(d.young_tests, { ads: 2, gone: 1, gone_share: 0.5 });
  assert.deepEqual(d.scaling.map(s => [s.id, s.variants_prev, s.variants_curr]), [['d', 1, 4]]);
  assert.deepEqual(d.pages.new, [{ page: 'Store E', ads: 4 }]);
  assert.deepEqual(d.pages.gone, ['Store B']);
});

test('diffSnapshots: a saturated re-run cannot prove an ad stopped', () => {
  const DAY = 86400, T0 = REFERENCE_NOW;
  const prev = [{ id: 'x', page: 'P', start: T0 - 5 * DAY, variants: 1, kws: ['q'], title: '', body: '' }];
  const curr = Array.from({ length: 95 }, (_, i) => ({ id: 'n' + i, page: 'Q' + i, start: T0, variants: 1, kws: ['q'], title: '', body: '' }));
  const d = diffSnapshots(prev, curr, { prevTs: T0, currTs: T0 + 7 * DAY, cap: 90 });
  assert.equal(d.stopped.count, 1);
  assert.equal(d.stopped.high_confidence, 0);
  assert.equal(d.young_tests.ads, 0);
});

test('toCsv escapes quotes and collapses newlines, one line per row', () => {
  const rows = [
    normalizeAd(loadFixture('basic-ad.json'), 'k'),
    { ...normalizeAd(loadFixture('no-link-ad.json'), 'k'), title: 'Say "hi"', body: 'Line one\nLine two' }
  ];
  const csv = toCsv(rows);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3); // header + 2 rows
  assert.match(lines[2], /"Say ""hi"""/);
  assert.doesNotMatch(lines[2], /Line one\nLine two/);
});

test('toCsv neutralizes formula-injection payloads in ad text', () => {
  const rows = [{
    ...normalizeAd(loadFixture('no-link-ad.json'), 'k'),
    page: '=HYPERLINK("http://evil.example","Salon")',
    title: '@SUM(1+1)',
    body: '+cmd|\' /C calc\'!A0',
    cta: '-2+3'
  }];
  const line = toCsv(rows).split('\n')[1];
  // Every field that starts with = + - @ must be prefixed with a quote,
  // so spreadsheet apps treat it as text instead of evaluating it.
  assert.match(line, /"'=HYPERLINK/);
  assert.match(line, /"'@SUM/);
  assert.match(line, /"'\+cmd/);
  assert.match(line, /"'-2\+3"/);
});
