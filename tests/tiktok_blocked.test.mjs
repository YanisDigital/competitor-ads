// TikTok: a captcha or login wall in the middle of a run saves the finished queries as a partial snapshot
// (it used to lose them); the run still stops and nothing is done to get around it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readFileSync as read } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SKILL = path.join(__dirname, '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report');
const SCRIPTS = path.join(SKILL, 'scripts');
const C = require(path.join(SCRIPTS, 'collector.js'));
const { loadSnapshot } = require(path.join(SCRIPTS, 'report.js'));
const HARNESS = path.join(__dirname, 'tiktok_blocked_harness.py');
const HAS_PYTHON = spawnSync('python', ['--version']).status === 0;

const search = JSON.parse(read(path.join(SKILL, 'tests', 'fixtures', 'library_search.json'), 'utf8'));
const CSV = C.toCsv(search.data.slice(0, 4).map(it => C.normalizeLibraryAd(it, 'q1')));

function runHarness(blockAt) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ttblk-'));
  const csv = path.join(dir, 'fake.csv');
  writeFileSync(csv, CSV);
  const out = path.join(dir, 'out');
  const r = spawnSync('python', [HARNESS, SCRIPTS, csv, out, String(blockAt)], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const line = r.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
  assert.ok(line, 'harness printed no result: ' + r.stdout + r.stderr);
  return { out, result: JSON.parse(line), stdout: r.stdout };
}

test('tiktok: a captcha at query 3 of 4 saves the two finished queries as a partial snapshot', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { out, result, stdout } = runHarness(3);
  assert.equal(result.code, 3, 'exit code 3 = partial snapshot');
  assert.equal(result.calls, 3, 'no query after the block, no retry');
  assert.ok(['ads.csv', 'report.json', 'run.json'].every(f => result.files.includes(f)));
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
  assert.ok(step && step.urgent);
  assert.match(step.why, /ещё 2 не выполнены/);
});

test('tiktok: a captcha on the very first query saves nothing', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { result } = runHarness(1);
  assert.notEqual(result.code, 0);
  assert.deepEqual(result.files, []);
});

test('tiktok: a normal run is unchanged', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const { out, result } = runHarness(99);
  assert.equal(result.code, 0);
  assert.equal(result.calls, 4);
  const run = JSON.parse(readFileSync(path.join(out, 'run.json'), 'utf8'));
  assert.deepEqual(run.queries, ['q1', 'q2', 'q3', 'q4']);
  assert.ok(!('blocked' in run) && !('queries_remaining' in run));
  assert.ok(!loadSnapshot(out).warnings.some(w => w.code === 'collection_stopped'));
});
