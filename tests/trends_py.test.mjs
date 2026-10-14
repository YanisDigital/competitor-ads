// trends.py: which phrases it asks Google Trends about, the checks of what goes into the URL, the politeness limits.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const py = code => spawnSync('python', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); ${code}`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const cli = (...args) => spawnSync('python', [path.join(SCRIPTS, 'trends.py'), ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

test('pick_phrases: the preset services in the page language, without a city', () => {
  const r = py(`import trends; p = trends.load_preset("dentistry"); print(json.dumps([trends.pick_phrases(p, {}, "uk", 3), trends.pick_phrases(p, {}, "ru", 2)], ensure_ascii=False))`);
  assert.equal(r.status, 0, r.stderr);
  const [uk, ru] = JSON.parse(r.stdout);
  assert.deepEqual(uk, ['стоматологія', 'імплантація зубів', 'брекети']);
  assert.deepEqual(ru, ['стоматология', 'имплантация зубов']);
});

test('pick_phrases: without a preset the queries of run.json, pages-of labels skipped', () => {
  const r = py(`import trends; print(json.dumps(trends.pick_phrases(None, {"queries": ["ремонт  iphone", "page: Some Shop", "ремонт iphone", "заміна екрана"]}, "uk", 5), ensure_ascii=False))`);
  assert.deepEqual(JSON.parse(r.stdout), ['ремонт iphone', 'заміна екрана']);
});

test('validate_geo and validate_hl: only codes go into the URL', () => {
  const ok = py(`import trends; print(trends.validate_geo("ua-51"), trends.validate_geo("PL"), trends.validate_hl("uk"), trends.validate_hl("en-US"))`);
  assert.equal(ok.stdout.trim(), 'UA-51 PL uk en-US');
  for (const bad of ['validate_geo("UA&x=1")', 'validate_geo("Ukraine")', 'validate_hl("uk&gprop=youtube")', 'validate_hl("ukr")']) {
    const r = py(`import trends; trends.${bad}`);
    assert.notEqual(r.status, 0, bad);
  }
});

test('load_preset: an id that is not a plain name is not read as a path', () => {
  const r = py(`import trends; print(trends.load_preset("nope-not-a-preset")); trends.load_preset("../x")`);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /None|Bad preset id/);
});

test('trends.py refuses a delay under 10 seconds, too many phrases, and a missing folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trends-py-'));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ country: 'UA', queries: ['x y'] }));
  let r = cli(dir, '--delay', '5');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /never|not allowed|under 10/i);
  r = cli(dir, '--max-phrases', '40');
  assert.notEqual(r.status, 0);
  r = cli(path.join(dir, 'missing'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No such folder/);
});

test('trends.py needs phrases when the folder has none', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trends-py-'));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ country: 'UA' }));
  const r = cli(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No phrases/);
});

test('make_parser: a 5-year answer (over the Windows command-line limit) goes through stdin', () => {
  const r = py(`
import trends, pathlib
tl = {"default": {"timelineData": [{"time": str(1633824000 + i * 604800), "formattedTime": "Oct 10 – 16, 2021", "value": [i % 100], "formattedValue": [str(i % 100)], "hasData": [True]} for i in range(262)]}}
rel = {"default": {"rankedList": [{"rankedKeyword": [{"query": "a b", "value": 100, "formattedValue": "100"}]}, {"rankedKeyword": [{"query": "c d", "value": 120, "formattedValue": "+120%"}]}]}}
pre = ")]}'," + chr(10)
got = {"multiline": pre + json.dumps(tl) + " " * 40000, "related": [pre + json.dumps(rel)], "throttled": 0}
rec = trends.make_parser(pathlib.Path("."))("фраза", "today 5-y", got)
print(len(json.dumps(got)) > 40000, len(rec["timeline"]), rec["related_rising"][0]["query"], rec["related_ok"])`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'True 262 c d True');
});
