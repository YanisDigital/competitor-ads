import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeAd, toCsv, snapshotWarnings, nextSteps } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const NOW = 1_790_000_000;
const ad = (id, page, q) => normalizeAd({ ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - 20 * 86400, publisher_platform: ['facebook'],
  snapshot: { title: 'Dried flowers', body: { text: 'Dried flowers bouquet' }, cta_text: 'Shop now', link_url: `https://${page.toLowerCase()}.example/`, display_format: 'IMAGE' } }, q);

function snap(curation, pages = ['Shop A', 'Shop B', 'Gift C', 'Gift D']) {
  const dir = mkdtempSync(path.join(tmpdir(), 'confirm-'));
  const rows = pages.flatMap((p, i) => [ad(p + '1', p, 'dried flowers'), ad(p + '2', p, i < 2 ? 'dried flowers' : 'gifts for partners')]);
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['dried flowers', 'gifts for partners'] }));
  if (curation) writeFileSync(path.join(dir, 'curation.json'), JSON.stringify(curation));
  return dir;
}
const codes = s => s.warnings.map(w => w.code);

test('curation without confirmed: a warning and a first urgent step; confirmed removes both', () => {
  const cur = { include: { 'Shop A': 'maker', 'Shop B': 'maker' }, criterion: 'sells dried flower decor' };
  const s = loadSnapshot(snap(cur), undefined, { now: NOW });
  assert.ok(codes(s).includes('unconfirmed'));
  assert.ok(!codes(s).includes('no_criterion'));
  assert.equal(s.next_steps[0].code, 'confirm');
  assert.equal(s.next_steps[0].urgent, true);
  assert.equal(s.meta.curation.criterion, 'sells dried flower decor');
  const ok = loadSnapshot(snap({ ...cur, confirmed: true }), undefined, { now: NOW });
  assert.ok(!codes(ok).includes('unconfirmed'));
  assert.ok(!ok.next_steps.some(x => x.code === 'confirm'));
  assert.equal(ok.meta.curation.confirmed, true);
});

test('curation without criterion gets an info warning; no curation gets neither', () => {
  const s = loadSnapshot(snap({ include: { 'Shop A': 'maker' }, confirmed: true }), undefined, { now: NOW });
  assert.ok(codes(s).includes('no_criterion'));
  const none = loadSnapshot(snap(null), undefined, { now: NOW });
  assert.ok(!codes(none).includes('unconfirmed') && !codes(none).includes('no_criterion'));
});

test('more than three business types among competitors: mixed_types', () => {
  const inc = { 'Shop A': 'maker', 'Shop B': 'shop', 'Gift C': 'gifts', 'Gift D': 'packaging' };
  const s = loadSnapshot(snap({ include: inc, criterion: 'x', confirmed: true }), undefined, { now: NOW });
  assert.ok(codes(s).includes('mixed_types'));
  const few = loadSnapshot(snap({ include: { 'Shop A': 'maker', 'Shop B': 'maker' }, criterion: 'x', confirmed: true }), undefined, { now: NOW });
  assert.ok(!codes(few).includes('mixed_types'));
});

test('noisy_queries: a query where under 30% of advertisers are competitors is named', () => {
  const stats = [{ query: 'gifts for partners', ads: 69, advertisers: 39, relevant_advertisers: 1 }, { query: 'dried flowers', ads: 20, advertisers: 6, relevant_advertisers: 5 }, { query: 'tiny', ads: 2, advertisers: 2, relevant_advertisers: 0 }];
  const w = snapshotWarnings({ advertisers: 12, queryStats: stats, curated: true, ts: NOW, curation: { confirmed: true, criterion: 'x', types_kept: 1 } });
  const n = w.find(x => x.code === 'noisy_queries');
  assert.ok(n && /gifts for partners/.test(n.message) && /1 из 39/.test(n.message));
  assert.ok(!/dried flowers/.test(n.message) && !/tiny/.test(n.message), 'good and tiny queries are not named');
  assert.ok(!snapshotWarnings({ advertisers: 12, queryStats: stats, curated: false, ts: NOW }).some(x => x.code === 'noisy_queries'), 'without curation nothing to judge');
});

test('nextSteps: under 10 competitors puts widening first (all ads of competitors + product synonyms), creatives wait for confirmation', () => {
  const base = { curated: true, confirmed: true, has_image_links: true, has_page_id: true, age_days: 1, preset: true, advertisers: 7 };
  const steps = nextSteps(base);
  const few = steps.find(s => s.code === 'few_competitors');
  assert.ok(few && few.urgent && /--pages-of/.test(few.how) && /синоним/.test(few.how));
  assert.ok(!nextSteps({ ...base, advertisers: 12 }).some(s => s.code === 'few_competitors'));
  assert.ok(!/--pages-of/.test(nextSteps({ ...base, pages_of: true }).find(s => s.code === 'few_competitors').how), 'already collected: only synonyms');
  const cr = nextSteps({ ...base, confirmed: false }).find(s => s.code === 'creatives');
  assert.match(cr.needs, /подтвержден/);
  assert.equal(nextSteps({ ...base, confirmed: true }).find(s => s.code === 'creatives').needs, '');
});
