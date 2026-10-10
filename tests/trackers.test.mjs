// Ad-click tracker links are never taken for an advertiser's site (so check_sites.py never opens them),
// and a preset id cannot point outside presets/. Both plugins.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, buildReport, isTrackerLink } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadNicheConfig } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const META = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const TIKTOK = path.join(__dirname, '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report', 'scripts');
const ttTracker = require(path.join(TIKTOK, 'collector.js')).isTrackerLink;

const TRACKERS = [
  'https://ad.doubleclick.net/ddm/trackclk/N1/B2',
  'https://track.shop-a.example/5548c06d',
  'https://trkv.shop-b.example/6ed1f32f?tw_adid=1',
  'https://tracking.shop-c.example/x',
  'https://click.shop-d.example/x',
  'https://x.onelink.me/abc'
];
const SITES = [
  'https://shop-a.example/products/x',
  'https://www.salon-a.example/',
  'https://trackhub.example/',        // "track" inside a longer first label is an ordinary site
  'https://clickhouse.example/',
  'https://wa.me/380000000000'
];

for (const [name, fn] of [['meta', isTrackerLink], ['tiktok', ttTracker]]) {
  test(`${name}: isTrackerLink tells ad-click trackers from ordinary sites`, () => {
    for (const u of TRACKERS) assert.equal(fn(u), true, u);
    for (const u of SITES) assert.equal(fn(u), false, u);
  });
}

const NOW = 1_790_000_000;
const ad = (id, page, link) => normalizeAd({
  ad_archive_id: id, page_id: 'p' + page, page_name: page, is_active: true, start_date: NOW - 5 * 86400, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title: 'T', body: { text: 'Body ' + id }, cta_text: 'Learn more', link_url: link, display_format: 'IMAGE' }
}, 'q');

test('meta report: a page that links only through a tracker has no landing and is flagged; a normal page keeps its landing', () => {
  const r = buildReport([ad('1', 'Alpha', 'https://track.shop-a.example/5548c06d'), ad('2', 'Beta', 'https://beta.example/offer?utm_source=x')], { now: NOW });
  const alpha = r.top_pages.find(p => p.page === 'Alpha');
  const beta = r.top_pages.find(p => p.page === 'Beta');
  assert.equal(alpha.landing, '');
  assert.equal(alpha.tracker, true);
  assert.equal(beta.landing, 'https://beta.example/offer');
  assert.ok(!beta.tracker);
});

test('meta: a preset id with a path is refused (no file outside presets/)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-'));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ preset: 'beauty' }));
  assert.throws(() => loadNicheConfig(dir, '../../../.claude-plugin/plugin'), /Bad preset id/);
  assert.throws(() => loadNicheConfig(dir, 'a/b'), /Bad preset id/);
  assert.ok(loadNicheConfig(dir, 'beauty').config);
});

test('meta scrape.py: load_preset refuses a path as preset id', { skip: spawnSync('python', ['--version']).status !== 0 && 'python is not installed' }, () => {
  const code = `import sys; sys.path.insert(0, r'${META}'); import scrape\ntry:\n    scrape.load_preset('../../../.claude-plugin/plugin')\nexcept SystemExit as e:\n    print(e)\n`;
  const r = spawnSync('python', ['-I', '-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.match(r.stdout + r.stderr, /Bad preset id/);
});
