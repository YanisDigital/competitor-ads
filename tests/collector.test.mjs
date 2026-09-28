import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  normalizeAd,
  classifyDoor,
  domainOf,
  buildReport,
  toCsv
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
