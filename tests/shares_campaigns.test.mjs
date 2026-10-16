import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv, buildReport, snapshotWarnings } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const ad = (id, page, body, fmt = 'IMAGE', extra = {}) => normalizeAd({ ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - 3 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'Pack', body: { text: body }, cta_text: 'Shop', link_url: `https://${page.toLowerCase()}.example/`, display_format: fmt, images: [{ original_image_url: `https://a.fbcdn.net/${extra.img || id}.jpg` }], ...(extra.video ? { videos: [{ video_hd_url: `https://v.fbcdn.net/${extra.video}.mp4` }] } : {}) } }, 'q');

// A big advertiser: 12 copies of one video ad (same text, same video) plus 2 different ads; four small ones with 1 image ad each.
const rows = [
  ...Array.from({ length: 12 }, (_, i) => ad('S' + i, 'Packer', 'Ready packaging for your flowers, wholesale prices today', 'VIDEO', { video: 'same', img: 'same' })),
  ad('S20', 'Packer', 'Another totally different packaging offer for you', 'IMAGE'),
  ad('S21', 'Packer', 'Third different packaging text for the shop owners', 'IMAGE'),
  ...['A', 'B', 'C', 'D'].map(p => ad(p + '1', p, 'Dried flower bouquet handmade ' + p + ' unique text here')),
];

test('campaigns: copies of one ad of one advertiser are one campaign; shares are counted by advertiser', () => {
  const r = buildReport(rows, { now: NOW });
  assert.equal(r.ads, 18);
  assert.equal(r.campaigns.count, 7, '1 video campaign + 2 other Packer ads + 4 small ones');
  assert.equal(r.campaigns.copies, 11);
  assert.equal(r.campaigns.groups[0].ads, 12);
  assert.equal(r.formats.VIDEO, 12, 'by ads the video looks like the norm');
  assert.equal(r.formats_by_advertiser.VIDEO, 1, 'by advertisers one of five uses video');
  assert.equal(r.formats_by_advertiser.IMAGE, 5);
  assert.equal(r.fresh.ads, 18);
  assert.equal(r.fresh.campaigns, 7);
  assert.equal(r.dominant.page, 'Packer');
  assert.equal(r.dominant.campaigns, 3);
  assert.ok(r.dominant.share > 0.7);
});

test('catalog ads of one advertiser are one catalog campaign', () => {
  const cat = Array.from({ length: 8 }, (_, i) => ad('K' + i, 'Catalog Shop', '{{product.name}} from {{product.price}}', 'IMAGE', { img: 'k' + i }));
  const r = buildReport([...cat, ad('X1', 'Other', 'Some other advertiser plain text offer')], { now: NOW });
  assert.equal(r.catalog_ads, 8);
  assert.equal(r.campaigns.count, 2);
  assert.equal(r.campaigns.groups[0].catalog, true);
});

test('dominant_advertiser warning: one advertiser with 30% or more of at least 5 ads; not for an even sample', () => {
  const r = buildReport(rows, { now: NOW });
  const w = snapshotWarnings({ advertisers: r.advertisers, queryStats: [], ts: NOW, dominant: r.dominant });
  const d = w.find(x => x.code === 'dominant_advertiser');
  assert.ok(d && /Packer/.test(d.message) && /78%/.test(d.message), JSON.stringify(w));
  const even = buildReport(['A', 'B', 'C', 'D', 'E'].flatMap(p => [ad(p + '1', p, 'text number one ' + p + ' unique offer'), ad(p + '2', p, 'text number two ' + p + ' other offer')]), { now: NOW });
  assert.ok(!snapshotWarnings({ advertisers: even.advertisers, queryStats: [], ts: NOW, dominant: even.dominant }).some(x => x.code === 'dominant_advertiser'));
});

test('loadSnapshot carries the dominant warning; creatives.js select --types picks only that curation type', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shares-'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ include: { Packer: 'supplier', A: 'maker', B: 'maker', C: 'shop', D: 'shop' }, criterion: 'x', confirmed: true }));
  const s = loadSnapshot(dir, undefined, { now: NOW });
  assert.ok(s.warnings.some(w => w.code === 'dominant_advertiser'));
  const run = types => spawnSync('node', [path.join(SCRIPTS, 'creatives.js'), 'select', dir, '--limit', '30', ...types], { encoding: 'utf8' });
  const r = run(['--types', 'maker']);
  assert.equal(r.status, 0, r.stderr);
  const pages = [...new Set(JSON.parse(readFileSync(path.join(dir, 'creatives', 'selection.json'), 'utf8')).items.map(i => i.page))].sort();
  assert.deepEqual(pages, ['A', 'B']);
  const bad = run(['--types', 'nonsense']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Known types: .*maker/);
});
