import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

// Runs collector.js's browser glue (window.__mai) inside a vm sandbox with a
// fake page: no real browser, no network. Fixtures are synthetic.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR = readFileSync(path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts', 'collector.js'), 'utf8');
// One line per JSON document, like the live page (eat() parses line by line).
const fixture = (name) => JSON.stringify(JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')));

function fakePage(embeddedJson, graphqlText = '') {
  const scripts = embeddedJson.map(text => ({ textContent: text }));
  const window = {
    scrollTo() {},
    fetch: async () => ({ clone: () => ({ text: async () => graphqlText }) })
  };
  const document = {
    body: { innerText: '', scrollHeight: 0 },
    querySelectorAll: (sel) => (sel === 'script[type="application/json"]' ? scripts : [])
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.open = function () {};
  const ctx = vm.createContext({ window, document, XMLHttpRequest, setTimeout, console });
  vm.runInContext(COLLECTOR, ctx);
  // A page-side request through the (intercepted) fetch; resolves once the
  // interceptor has read the response body.
  const pageFetch = async (url) => { await window.fetch(url); await new Promise(r => setTimeout(r, 0)); };
  return Object.assign(window.__mai, { pageFetch });
}

test('collect does not re-attribute an embedded ad batch to later queries', () => {
  // In-page search keeps the first page's SSR JSON in the DOM; a second
  // collect() used to re-read it and tag those ads with the new query.
  const M = fakePage([fixture('basic-ad.json')]);
  assert.equal(M.collect('first').captured, 1);
  const second = M.collect('second');
  assert.equal(second.captured, 0);
  assert.deepEqual([...Object.values(M.store)[0].kws], ['first']);
});

test('load carries the store over to a freshly opened page and merges queries', () => {
  const first = fakePage([fixture('basic-ad.json')]);
  first.collect('first');
  const dumped = JSON.parse(JSON.stringify(first.store));

  // Next query opened by URL: a new page, a new __mai, the same ad again.
  const second = fakePage([fixture('basic-ad.json'), fixture('whatsapp-ad.json')]);
  assert.match(second.load(dumped), /^1 /);
  const res = second.collect('second');
  assert.equal(res.captured, 2);
  assert.equal(res.total_unique, 2);
  const merged = Object.values(second.store).find(r => r.kws.includes('first'));
  assert.deepEqual([...merged.kws], ['first', 'second']);
});

test('collect reports when Meta rate-limits the pagination requests', async () => {
  // Live headless runs got this 114-byte reply to every "load more" request,
  // so a query with ~94 results silently stopped at the first 30.
  const limited = '{"errors":[{"message":"Rate limit exceeded","severity":"CRITICAL","code":1675004}],"extensions":{"is_final":true}}';
  const M = fakePage([fixture('basic-ad.json')], limited);
  await M.pageFetch('/api/graphql/');
  const res = M.collect('q');
  assert.equal(res.captured, 1);
  assert.equal(res.rate_limited, true);
  assert.equal(M.collect('q2').rate_limited, false); // reset per query
});
