// Runs the checks that live inside the tiktok-ads-niche-report skill folder
// (they work on recorded TikTok responses, so the logic needs no network):
//   tests/run.js           logic, report, exports, lint, comparison, test plan
//   tests/redos_check.js   hostile text must not hang the regexes
//   tests/security_check.py  redirects into private networks must not be requested
//                            (needs Playwright + internet; skipped without them)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(__dirname, '..', 'plugins', 'tiktok-ads-niche-report', 'skills', 'tiktok-ads-niche-report');
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };
const run = (cmd, args, timeout = 120000) => spawnSync(cmd, args, { cwd: SKILL, encoding: 'utf8', env: ENV, timeout });
const HAS_PYTHON = spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0;

test('tiktok: logic, report, exports, lint, comparison and test plan', () => {
  const r = run('node', ['tests/run.js']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\d+ passed, 0 failed/);
});

test('tiktok: regexes stay fast on hostile page text (ReDoS)', () => {
  const r = run('node', ['tests/redos_check.js']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('tiktok: site check never requests a redirect into a private network (SSRF)', { skip: !HAS_PYTHON && 'python is not installed', timeout: 240000 }, (t) => {
  const r = run('python', ['tests/security_check.py'], 240000);
  if (r.status === 77) return t.skip((r.stdout || '').trim());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
