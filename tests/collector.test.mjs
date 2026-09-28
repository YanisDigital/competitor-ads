import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeAd,
  classifyDoor,
  domainOf,
  buildReport,
  toCsv
} from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const DAY = 86400;
const NOW = 1_700_000_000;

function makeNode(overrides = {}) {
  return {
    ad_archive_id: '1',
    page_name: 'Salon A',
    is_active: true,
    start_date: NOW - 10 * DAY,
    end_date: null,
    publisher_platform: ['facebook', 'instagram'],
    collation_count: 1,
    ...overrides,
    snapshot: {
      title: 'Hello',
      body: 'World',
      cta_text: '',
      link_url: '',
      display_format: 'image',
      ...(overrides.snapshot || {})
    }
  };
}

test('normalizeAd maps a plain ad node to a flat record', () => {
  const rec = normalizeAd(makeNode({ snapshot: { cta_text: 'Call now', link_url: 'https://example.com/promo' } }), 'манікюр');
  assert.equal(rec.id, '1');
  assert.equal(rec.page, 'Salon A');
  assert.equal(rec.title, 'Hello');
  assert.equal(rec.cta, 'Call now');
  assert.equal(rec.link, 'https://example.com/promo');
  assert.deepEqual(rec.kws, ['манікюр']);
  assert.equal(rec.ncards, 0);
});

test('normalizeAd resolves DCO template text from the first non-empty card', () => {
  const rec = normalizeAd(makeNode({
    snapshot: {
      title: '{{product.name}}',
      body: '{{product.description}}',
      cards: [
        { title: '', body: '' },
        { title: 'Real title', body: 'Real body', cta_text: 'Book now', link_url: 'https://example.com' }
      ]
    }
  }), 'брови');
  assert.equal(rec.title, 'Real title');
  assert.equal(rec.body, 'Real body');
  assert.equal(rec.cta, 'Book now');
  assert.equal(rec.link, 'https://example.com');
  assert.equal(rec.ncards, 2);
});

test('domainOf unwraps l.facebook.com/l.php redirect links', () => {
  const url = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fpage%3Ffbclid%3D123';
  assert.equal(domainOf(url), 'example.com');
});

test('domainOf returns empty string for missing/invalid links', () => {
  assert.equal(domainOf(''), '');
  assert.equal(domainOf('not a url'), '');
});

test('classifyDoor recognizes WhatsApp, Telegram and Instagram destinations', () => {
  assert.equal(classifyDoor({ cta: '', link: 'https://wa.me/380000000000' }), 'WhatsApp');
  assert.equal(classifyDoor({ cta: '', link: 'https://t.me/somebot' }), 'Telegram');
  assert.equal(classifyDoor({ cta: '', link: 'https://instagram.com/salon' }), 'Instagram-профиль');
  assert.equal(classifyDoor({ cta: 'Send message', link: '' }), 'Директ/Messenger');
  assert.equal(classifyDoor({ cta: '', link: '' }), 'Без ссылки');
  assert.equal(classifyDoor({ cta: '', link: 'https://example.com' }), 'Сайт');
});

test('buildReport aggregates ads, doors and longrun using opts.now', () => {
  const rows = [
    normalizeAd(makeNode({ ad_archive_id: '1', page_name: 'Salon A', start_date: NOW - 5 * DAY, snapshot: { link_url: 'https://wa.me/1' } }), 'k1'),
    normalizeAd(makeNode({ ad_archive_id: '2', page_name: 'Salon B', start_date: NOW - 120 * DAY, snapshot: { link_url: 'https://example.com' } }), 'k1')
  ];
  const report = buildReport(rows, { now: NOW, longDays: 90 });
  assert.equal(report.ads, 2);
  assert.equal(report.advertisers, 2);
  assert.equal(report.doors.WhatsApp, 1);
  assert.equal(report.doors['Сайт'], 1);
  assert.equal(report.longrun.length, 1);
  assert.equal(report.longrun[0].page, 'Salon B');
});

test('toCsv escapes quotes and collapses whitespace in ad text', () => {
  const rows = [normalizeAd(makeNode({
    ad_archive_id: '1',
    snapshot: { title: 'Say "hi"', body: 'Line one\nLine two', cta_text: '', link_url: '' }
  }), 'k1')];
  const csv = toCsv(rows);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"Say ""hi"""/);
  assert.doesNotMatch(lines[1], /\n/);
});
