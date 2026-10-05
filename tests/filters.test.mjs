import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const py = code => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const url = args => { const r = py('import scrape; print(scrape.library_url("UA", "q"' + (args ? ', ' + args : '') + '))'); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

test('defaults send no language and no sort, and keep media_type=all', () => {
  const u = url('');
  assert.match(u, /media_type=all/);
  assert.doesNotMatch(u, /content_languages|sort_data/);
});

test('language: one or several two-letter codes, in the order given', () => {
  assert.match(url('language=["uk"]'), /content_languages\[0\]=uk(&|$)/);
  const two = url('language=["uk", "ru"]');
  assert.match(two, /content_languages\[0\]=uk/);
  assert.match(two, /content_languages\[1\]=ru/);
});

test('media: video and meme go as they are, "image" goes as image_and_meme (plain image returns nothing)', () => {
  assert.match(url('media="video"'), /media_type=video(&|$)/);
  assert.match(url('media="meme"'), /media_type=meme(&|$)/);
  assert.match(url('media="image"'), /media_type=image_and_meme(&|$)/);
  assert.doesNotMatch(url('media="image"'), /media_type=image(&|$)/);
});

test('sort: relevancy adds the monthly-grouped relevancy mode, impressions is the default and adds nothing', () => {
  const rel = url('sort="relevancy"');
  assert.match(rel, /sort_data\[mode\]=relevancy_monthly_grouped/);
  assert.match(rel, /sort_data\[direction\]=desc/);
  assert.doesNotMatch(url('sort="impressions"'), /sort_data/);
});

test('every filter also reaches the "all ads of a page" link', () => {
  const r = py('import scrape; print(scrape.page_library_url("UA", "123", "all", None, None, ["uk"], "video", "relevancy"))');
  assert.equal(r.status, 0, r.stderr);
  const u = r.stdout.trim();
  assert.match(u, /view_all_page_id=123/);
  assert.match(u, /active_status=all/);
  assert.match(u, /content_languages\[0\]=uk/);
  assert.match(u, /media_type=video/);
  assert.match(u, /relevancy_monthly_grouped/);
});

test('bad language codes, media types and sort modes stop the run before a URL is built', () => {
  for (const bad of ['["ukr"]', '["u"]', '["uk&x=1"]', '["1k"]', '[""]']) {
    assert.notEqual(py('import scrape; scrape.window_params(language=' + bad + ')').status, 0, 'language ' + bad);
  }
  assert.notEqual(py('import scrape; scrape.window_params(media="gif")').status, 0);
  assert.notEqual(py('import scrape; scrape.window_params(sort="newest")').status, 0);
  assert.notEqual(py('import scrape; scrape.window_params(media="video&x=1")').status, 0);
});

test('language codes are lower-cased and de-duplicated', () => {
  assert.match(url('language=["UK", "uk", "Ru"]'), /content_languages\[0\]=uk.*content_languages\[1\]=ru/);
  assert.doesNotMatch(url('language=["UK", "uk"]'), /content_languages\[1\]/);
});
