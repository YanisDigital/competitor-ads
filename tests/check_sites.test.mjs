import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');

// Literal IPs only: no DNS and no network access needed.
test('check_sites only opens public http(s) addresses', () => {
  const urls = ['http://127.0.0.1/', 'http://localhost/', 'http://192.168.1.1/admin', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'file:///etc/passwd', 'ftp://8.8.8.8/', 'javascript:alert(1)', '', 'http://8.8.8.8/'];
  const res = spawnSync('python', ['-c', `
import sys, json
sys.path.insert(0, sys.argv[1])
import check_sites
print(json.dumps([check_sites.is_public_url(u) for u in json.loads(sys.argv[2])]))
`, SCRIPTS, JSON.stringify(urls)], { encoding: 'utf8' });
  if (res.status !== 0 && /No module named/.test(res.stderr)) return; // playwright not required, but python must run
  assert.equal(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.deepEqual(got, [false, false, false, false, false, false, false, false, false, false, true]);
});
