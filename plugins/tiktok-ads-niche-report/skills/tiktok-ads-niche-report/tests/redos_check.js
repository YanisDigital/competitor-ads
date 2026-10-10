#!/usr/bin/env node
// Regex denial-of-service check: text from a third-party site or ad goes through
// the hook and price regexes, so a hostile page must not be able to hang a run.
//   timeout 120 node tests/redos_check.js      (exit 1 when any input is too slow)
const C = require('../scripts/collector.js');

const LIMIT_MS = 500;
const attacks = {
  'digits, no separators (400k)': '1'.repeat(400000),
  'digit-space pairs (400k)': '1 '.repeat(200000),
  'digit-dot pairs (400k)': '1.'.repeat(200000),
  'thousands groups (400k)': '12 345 678, '.repeat(34000),
  'years words (400k)': '2 lat '.repeat(66000),
  'before ... (400k)': 'before '.repeat(57000),
  'vorher ... (400k)': 'vorher '.repeat(57000),
  'plain ad-like text (1M)': 'zamów teraz 129 zł karnet -50% '.repeat(33000)
};

let bad = 0;
for (const [name, text] of Object.entries(attacks)) {
  const t0 = Date.now();
  C.siteFacts(text, { currency: 'PLN' });
  C.priceHits(text.toLowerCase(), 'EUR');
  const capped = text.slice(0, 30000).toLowerCase(); // what siteFacts analyses
  let worst = ['', 0];
  for (const [k, re] of Object.entries(C.hookPatterns())) {
    const s = Date.now();
    re.test(capped);
    const d = Date.now() - s;
    if (d > worst[1]) worst = [k, d];
  }
  const total = Date.now() - t0;
  const ok = total <= LIMIT_MS;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${name.padEnd(32)} total ${String(total).padStart(5)} ms, slowest hook "${worst[0]}" ${worst[1]} ms`);
}
console.log(bad ? `${bad} input(s) slower than ${LIMIT_MS} ms` : `all inputs under ${LIMIT_MS} ms`);
process.exit(bad ? 1 : 0);
