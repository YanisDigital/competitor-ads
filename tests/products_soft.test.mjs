// Soft health flags: generic wellness words ("cure", "bloat", "doctor", "pain relief") are a caution next to the
// product, not a reason to drop it or its page; conditions, drugs, supplements and diseases still are.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, buildReport } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { buildHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESET = JSON.parse(readFileSync(path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'presets', 'ecom-problem-solvers-us.json'), 'utf8'));
const NOW = 1_790_000_000;
const DAY = 86400;

let seq = 900;
const ad = (page, daysAgo, link, title, body) => normalizeAd({
  ad_archive_id: String(seq++), page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - daysAgo * DAY, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title, body: { text: body }, cta_text: 'Shop now', link_url: link, display_format: 'IMAGE' }
}, title);
const red = t => Object.entries(PRESET.products.red_flags).filter(([, s]) => new RegExp(s, 'i').test(t)).map(([k]) => k);
const soft = t => Object.values(PRESET.products.soft_flags).some(s => new RegExp(s, 'i').test(t));

test('generic wellness words are soft, conditions and diseases are red', () => {
  for (const t of ['The "Moon Face" Cure', 'Ask your doctor first', 'Diet bloat is real', 'pain relief for tired muscles', 'Improves your posture', 'Detox your shower head']) {
    assert.deepEqual(red(t), [], t + ' is not a red flag');
    assert.ok(soft(t), t + ' is a soft flag');
  }
  for (const t of ['Why your kidney numbers get worse every 90 days', 'My husband started dialysis in July', 'Relief for arthritis and gout', 'diagnosed with stage 3 kidney disease',
    'Support your thyroid', 'Hair loss under stress', 'Take the supplement daily']) {
    assert.deepEqual(red(t), ['здоровье/медицина'], t);
  }
});

const MASSAGER_PAGE = [
  ad('Neck Massager Store', 120, 'https://massager.example/pages/stress-relief', 'The "Moon Face" Cure.', 'The Doc was right. The sensation was crazy. It was a clogged drain.'),
  ad('Neck Massager Store', 119, 'https://massager.example/pages/scm', 'The "Moon Face" Cure.', 'The Doc was right. The sensation was crazy. It was a clogged drain.'),
  ad('Neck Massager Store', 20, 'https://massager.example/pages/stress-relief', 'Diet bloat is real', 'Scale went down but the face stayed the same. A clogged drain of water weight'),
  ad('Kidney Page', 120, 'https://kidney.example/pages/adv', 'Why your kidney numbers get worse', 'My husband started dialysis. It is not what your doctor told you. A clogged drain')
];
const opts = { now: NOW, currency: 'USD', onlineOnly: true, baseHooks: false, products: PRESET.products };

test('a page with only soft health words stays; a page with diseases is excluded', () => {
  const r = buildReport(MASSAGER_PAGE, opts);
  assert.ok(!r.products.excluded_pages.some(e => e.page === 'Neck Massager Store'), 'Neck Massager Store is not excluded');
  assert.ok(r.products.excluded_pages.some(e => e.page === 'Kidney Page'), 'the kidney page is');
  assert.ok(r.longrun.some(x => x.page === 'Neck Massager Store'));
  assert.ok(!r.longrun.some(x => x.page === 'Kidney Page'));
});

test('a product with a soft flag stays in the list with a caution, not a reason', () => {
  const rows = [
    ad('Store M', 20, 'https://store-m.example/products/neck-massager', 'Neck massager for tired muscles', 'Pain relief after a long day at the desk. The doctor was right about stretching, compact and rechargeable. $59'),
    ad('Store M2', 21, 'https://store-m2.example/products/neck-massager-2', 'Neck massager for tired muscles', 'Pain relief after a long day at the desk. The doctor was right about stretching, compact and rechargeable. $59')
  ];
  const r = buildReport(rows, opts);
  const p = r.products.top.find(x => x.handle === 'neck-massager');
  assert.ok(p, 'the product is in the list');
  assert.deepEqual(p.red_flags, []);
  assert.equal(p.early, true);
  assert.match(p.caution, /обещание здоровья \(мягкое\): .*pain relief/);
  assert.ok(p.soft_flags[0].words.includes('doctor'));
  assert.ok(!p.reasons.some(x => /красный флаг/.test(x)));
  const html = buildHtml({ report: r, doors: {}, meta: { query_stats: [] }, rows: [], query_stats: [], warnings: [], next_steps: [], images: {}, generated: '2026-10-12' });
  assert.match(html, /осторожно: обещание здоровья/);
});
