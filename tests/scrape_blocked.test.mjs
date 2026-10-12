// A captcha or login wall in the middle of a run: what was collected is saved as a partial snapshot
// (it used to be lost); the run still stops, nothing is done to get around it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { loadSnapshot } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const HARNESS = path.join(__dirname, 'scrape_blocked_harness.py');
const HAS_PYTHON = spawnSync('python', ['--version']).status === 0;

const NOW = 1_790_000_000;
const rows = ['1', '2', '3'].map(id => normalizeAd({
  ad_archive_id: id, page_id: 'p' + id, page_name: 'Store ' + id, is_active: true, start_date: NOW - 20 * 86400, end_date: NOW, publisher_platform: ['facebook'],
  collation_count: 1, snapshot: { title: 'T ' + id, body: { text: 'Body ' + id }, cta_text: 'Shop now', link_url: `https://s${id}.example/products/x${id}`, display_format: 'IMAGE' }
}, 'q1'));

function runHarness(blockAt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'blk-'));
  const csv = path.join(dir, 'fake.csv');
  writeFileSync(csv, toCsv(rows));
  const out = path.join(dir, 'out');
  const r = spawnSync('python', [HARNESS, SCRIPTS, csv, out, String(blockAt)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const line = r.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
  assert.ok(line, 'harness printed no result: ' + r.stdout + r.stderr);
  return { out, result: JSON.parse(line), stdout: r.stdout };
}

test('a captcha at query 3 of 4 saves the two finished queries as a partial snapshot', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { out, result, stdout } = runHarness(3);
  assert.equal(result.code, 3, 'exit code 3 = partial snapshot');
  assert.equal(result.calls, 3, 'no query after the block, no retry');
  assert.deepEqual(result.files, ['ads.csv', 'report.json', 'run.json']);
  assert.match(stdout, /PARTIAL snapshot: 2 of 4 queries ran/);
  const run = JSON.parse(readFileSync(path.join(out, 'run.json'), 'utf8'));
  assert.deepEqual(run.queries, ['q1', 'q2'], 'only the queries that ran');
  assert.match(run.blocked, /captcha/);
  assert.equal(run.queries_planned, 4);
  assert.deepEqual(run.queries_remaining, ['q3', 'q4']);
  const snap = loadSnapshot(out);
  const warn = snap.warnings.find(w => w.code === 'collection_stopped');
  assert.ok(warn, 'the report warns that the snapshot is partial');
  assert.match(warn.message, /Выполнено 2 из 4/);
  const step = snap.next_steps.find(s => s.code === 'resume');
  assert.ok(step && step.urgent, 'the next steps say how to finish');
  assert.match(step.why, /ещё 2 не выполнены/);
});

test('a captcha on the very first query saves nothing and says so', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { out, result, stdout } = runHarness(1);
  assert.notEqual(result.code, 0);
  assert.deepEqual(result.files, []);
  assert.ok(!existsSync(path.join(out, 'ads.csv')));
  assert.match(stdout + JSON.stringify(result), /Nothing was collected|code/);
});

test('a normal run is unchanged: all queries, exit code 0, no blocked fields', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { out, result } = runHarness(99);
  assert.equal(result.code, 0);
  assert.equal(result.calls, 4);
  const run = JSON.parse(readFileSync(path.join(out, 'run.json'), 'utf8'));
  assert.deepEqual(run.queries, ['q1', 'q2', 'q3', 'q4']);
  assert.ok(!('blocked' in run) && !('queries_remaining' in run));
  assert.ok(!loadSnapshot(out).warnings.some(w => w.code === 'collection_stopped'));
});
