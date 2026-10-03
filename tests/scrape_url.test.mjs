import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const py = code => spawnSync('python', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); ${code}`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

test('library_url: any words by default, exact phrase on request', () => {
  const r = py(`import scrape; print(scrape.library_url("UA", "пиво на розлив")); print(scrape.library_url("UA", "пиво на розлив", exact=True))`);
  assert.equal(r.status, 0, r.stderr);
  const [plain, exact] = r.stdout.trim().split(/\r?\n/);
  assert.match(plain, /search_type=keyword_unordered/);
  assert.match(exact, /search_type=keyword_exact_phrase/);
  assert.match(exact, /q=%D0%BF%D0%B8%D0%B2%D0%BE%20%D0%BD%D0%B0%20/); // query is URL-encoded
  assert.match(exact, /country=UA&/);
});
