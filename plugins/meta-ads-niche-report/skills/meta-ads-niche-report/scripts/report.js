#!/usr/bin/env node
// Rebuilds the full report for a snapshot folder from its ads.csv, using the
// same code as the collector (collector.js) and the snapshot's niche settings:
// the preset (run.json -> presets/<id>.json) and, on top of it, the folder's own
// niche.json (hooks, noise words, currency... for a niche without a preset). If
// the folder has a curation.json (hand-made list of advertisers to keep or drop,
// see applyCuration in collector.js) the report is built from the kept
// advertisers only. As a CLI it prints
// {report, doors, meta, query_stats, warnings, eu, visuals, next_steps} as
// JSON to stdout; as a module it exports loadSnapshot() and loadNicheConfig().
// Used by export_xlsx.py and export_html.js so exports always reflect the
// current report logic, even for folders scraped with an older version.
//
//   node report.js out/ecom-dropship-us/2026-09-30 [preset-id]
const fs = require('fs');
const path = require('path');
const { parseCsv, buildReport, classifyDoor, applyCuration, queryStats, snapshotWarnings, nextSteps, currencyForCountry, euSummary, creativesSummary, isEuCountry, queryMatch } = require('./collector.js');

const readJson = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

// The niche settings of a snapshot: the preset named in run.json (or presetId),
// then the folder's niche.json on top of it (its extra_hooks are added to the
// preset's, its other fields win). config is null when there is neither.
// Every hook must be a valid regular expression; a broken one names itself.
// A regular expression from niche.json runs over third-party text (ads, pages up to 30,000 characters): refuse one that
// backtracks badly on hostile input (nested or unbounded repeats). Each probe runs in a vm with a 300 ms timeout, so even an
// exponential expression cannot hang this check. Bounded quantifiers such as \\d{1,6} are fine.
const vm = require('vm');
const SLOW_INPUTS = ['1'.repeat(40) + '!', 'a'.repeat(40) + '!', '1 '.repeat(30) + '!', 'a-'.repeat(30) + '!', 'ab'.repeat(30) + '!', '1'.repeat(30000), 'a'.repeat(30000), '1 '.repeat(15000), 'aaaa-'.repeat(6000)];
function checkRegex(label, src, flags) {
  try { new RegExp(src, flags); } catch (e) { throw new Error('niche.json: ' + label + ' is not a valid regular expression: ' + e.message); }
  for (const a of SLOW_INPUTS) {
    try { vm.runInNewContext('new RegExp(src, flags).test(a)', { src, flags, a }, { timeout: 300 }); } catch (e) {
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error('niche.json: ' + label + ' is too slow on a hostile text (nested or unbounded repeats): use bounded quantifiers like \\d{1,6}');
      throw e;
    }
  }
}

// The shape of niche.json, checked before anything reads it, so a wrong type gives a clear message instead of a crash deep in the report.
function validateNiche(n) {
  const bad = (k, want) => { throw new Error('niche.json: "' + k + '" must be ' + want); };
  if (n === null || typeof n !== 'object' || Array.isArray(n)) bad('(the file)', 'an object');
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (n.extra_hooks !== undefined && !isObj(n.extra_hooks)) bad('extra_hooks', 'an object {"hook name": "regular expression"}');
  for (const k of ['noise', 'skip_hooks', 'query_ignore']) if (n[k] !== undefined && !(Array.isArray(n[k]) && n[k].every(x => typeof x === 'string'))) bad(k, 'a list of strings');
  for (const k of ['title', 'currency', 'policy']) if (n[k] !== undefined && typeof n[k] !== 'string') bad(k, 'a string');
  if (n.business_type !== undefined && !['product', 'service'].includes(n.business_type)) bad('business_type', '"product" or "service"');
  for (const k of ['local', 'base_hooks', 'online_only', 'query_match']) if (n[k] !== undefined && typeof n[k] !== 'boolean') bad(k, 'true or false');
  if (n.seasons !== undefined) {
    if (!Array.isArray(n.seasons)) bad('seasons', 'a list: [{"name": "...", "from": "MM-DD", "to": "MM-DD", "note": "..."}] (an object is not accepted)');
    n.seasons.forEach((x, i) => {
      if (!isObj(x) || typeof x.name !== 'string' || !/^[0-9]{2}-[0-9]{2}$/.test(x.from || '') || !/^[0-9]{2}-[0-9]{2}$/.test(x.to || '')) bad('seasons[' + i + ']', '{"name": "...", "from": "MM-DD", "to": "MM-DD"}');
    });
  }
  if (n.products !== undefined && !isObj(n.products)) bad('products', 'an object');
}

function loadNicheConfig(dir, presetId) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const id = presetId || meta.preset;
  if (id && !/^[a-z0-9-]+$/.test(id)) throw new Error('Bad preset id: ' + id);
  const preset = id ? readJson(path.join(__dirname, '..', 'presets', id + '.json')) : null;
  const niche = readJson(path.join(dir, 'niche.json'));
  if (niche !== null) validateNiche(niche);
  for (const [k, src] of Object.entries((niche && niche.extra_hooks) || {})) checkRegex('hook "' + k + '"', src, '');
  const np = (niche && niche.products) || null; // your own flags (brands, categories) live in niche.json, not in the shared preset
  for (const g of ['red_flags', 'page_name_flags', 'soft_flags']) for (const [k, src] of Object.entries((np && np[g]) || {})) checkRegex('products.' + g + ' "' + k + '"', src, 'i');
  const config = preset || niche ? { ...(preset || {}), ...(niche || {}), extra_hooks: { ...((preset && preset.extra_hooks) || {}), ...((niche && niche.extra_hooks) || {}) } } : null;
  if (config && ((preset && preset.products) || np)) {
    const pp = (preset && preset.products) || {};
    config.products = { ...pp, ...(np || {}) };
    for (const g of ['red_flags', 'page_name_flags', 'soft_flags']) config.products[g] = { ...(pp[g] || {}), ...((np && np[g]) || {}) };
  }
  return { config, preset_id: preset ? id : null, niche_file: !!niche };
}

// opts.now (unix seconds) pins "today" for the age of the snapshot in next_steps.
function loadSnapshot(dir, presetOverride, opts0 = {}) {
  const meta = readJson(path.join(dir, 'run.json')) || {};
  const ts = meta.date ? Date.parse(meta.date) / 1000 : fs.statSync(path.join(dir, 'ads.csv')).mtimeMs / 1000;
  const niche = loadNicheConfig(dir, presetOverride); // override is for snapshots without run.json
  const preset = niche.config;

  const allRows = parseCsv(fs.readFileSync(path.join(dir, 'ads.csv'), 'utf8'));
  const curation = readJson(path.join(dir, 'curation.json'));
  const cur = applyCuration(allRows, curation);
  const rows = cur.rows;
  const opts = { longDays: 90, now: ts };
  if (preset) {
    opts.extraHooks = preset.extra_hooks || {};
    opts.noise = preset.noise || [];
    if (preset.currency) opts.currency = preset.currency;
    if (preset.base_hooks === false) opts.baseHooks = false;
    if (preset.online_only) opts.onlineOnly = true;
    if (preset.local === false || preset.online_only) opts.local = false; // an online niche: no "first visit", "before/after", "sign up", "address" among the free angles
    if (Array.isArray(preset.skip_hooks)) opts.skipHooks = preset.skip_hooks;
    if (preset.business_type === 'product') opts.businessType = 'product'; // goods: no hooks of salons and courses among the free angles
    if (preset.query_match === true) opts.queryMatch = true; // keep ads without the query words out of the lists (also under products.query_match)
    opts.queryIgnore = [...(preset.query_ignore || []), ...(meta.cities || [])]; // words of a query that are not about the ad: the city
    if (preset.products) opts.products = preset.products;
  }
  // No preset currency: price the ads in the currency of the run's country (KZ: tenge).
  if (!opts.currency && currencyForCountry(meta.country)) opts.currency = currencyForCountry(meta.country);
  const doors = Object.fromEntries(rows.map(r => [r.id, classifyDoor(r)]));
  // presets with a products block: does each ad's own text hold the words of its query (Excel column)
  // after curation the advertisers are chosen by meaning, and a competitor's ad often lacks the words of the query (a city, a synonym): the column is shown only when the check is enforced
  const queryEnforced = opts.queryMatch === true || !!(preset && preset.products && preset.products.query_match === true);
  const query_match = (!curation || queryEnforced) && rows.some(r => (r.kws || []).length) ? Object.fromEntries(rows.map(r => [r.id, queryMatch(r, null, opts.queryIgnore)])) : null;
  const stats = queryStats(allRows, rows, { queries: meta.queries, rateLimited: meta.rate_limited_queries, curated: !!curation });
  const curationMeta = curation ? { curation: { excluded_ads: cur.excluded_ads, excluded_pages: cur.excluded_pages, kept_pages: new Set(rows.map(r => r.page)).size, types: cur.types, not_found: cur.not_found, disputed: cur.disputed, criterion: cur.criterion, confirmed: cur.confirmed, context: cur.context, notes: curation.notes || '' } } : {};
  const euData = readJson(path.join(dir, 'eu.json')); // EU reach and audience, collected by eu_details.py
  const eu = euData ? euSummary(euData, rows) : null;
  // Pictures downloaded by fetch_creatives.py (creatives/manifest.json) and the
  // tags Claude wrote for them (creatives.json).
  const manifest = readJson(path.join(dir, 'creatives', 'manifest.json'));
  const visuals = manifest ? creativesSummary(rows, readJson(path.join(dir, 'creatives.json')), manifest, { now: ts, longDays: opts.longDays }) : null;
  const report = buildReport(rows, opts);
  const warnings = snapshotWarnings({ advertisers: report.advertisers, queryStats: stats, ts, preset, stoppedAds: report.stopped.ads,
    curated: !!curation, dominant: report.dominant, curation: curation ? { criterion: cur.criterion, confirmed: cur.confirmed, types_kept: cur.types_kept } : null, activeAds: report.status_counts.active, queryCheck: report.query_check,
    blocked: meta.blocked || '', queriesDone: (meta.queries || []).length, queriesPlanned: meta.queries_planned })
    .concat(visuals ? visuals.warnings : []);
  // What the folder already has, for the "what else can be done" block.
  const has = f => fs.existsSync(path.join(dir, f));
  const now = opts0.now || Date.now() / 1000;
  const next_steps = nextSteps({
    curated: !!curation, confirmed: !!curation && cur.confirmed, advertisers: report.advertisers, has_image_links: allRows.some(r => r.image_url), has_page_id: allRows.some(r => r.page_id),
    age_days: Math.max(0, (now - ts) / 86400), manifest: !!manifest, downloaded: visuals ? visuals.downloaded : 0, labeled: visuals ? visuals.labeled : 0,
    sites: has('sites.json'), client: has('client.json') || fs.existsSync(path.join(path.dirname(path.resolve(dir)), 'client.json')),
    hypotheses: has('hypotheses.json'), plan: has('test_plan.json'), diff: has('diff.json'), eu_country: isEuCountry(meta.country), eu: !!euData,
    preset: !!niche.preset_id, niche: niche.niche_file, pages_of: !!meta.pages_of,
    rate_limited: (meta.rate_limited_queries || []).length, queries: (meta.queries || []).length,
    blocked: !!meta.blocked, queries_remaining: (meta.queries_remaining || []).length,
    empty_market: !!curation && report.advertisers <= 2
  });
  return { report, doors, query_match, rows, query_stats: stats, warnings, eu, visuals, next_steps,
    meta: { ...meta, ts, preset_title: preset && preset.title, niche_file: niche.niche_file, niche: preset, ...curationMeta } };
}

module.exports = { loadSnapshot, loadNicheConfig };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const si = argv.indexOf('--save');
  const dir = argv[0];
  const saveTo = si >= 0 ? (argv[si + 1] && !argv[si + 1].startsWith('--') ? argv[si + 1] : path.join(dir || '.', 'report_full.json')) : null;
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1));
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node report.js <snapshot-folder-with-ads.csv> [preset-id] [--save [file]]');
    process.exit(1);
  }
  let snap;
  try {
    snap = loadSnapshot(dir, positional[1]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { report, doors, query_match, meta, query_stats, warnings, eu, visuals, next_steps } = snap;
  const json = JSON.stringify({ report, doors, query_match, meta, query_stats, warnings, eu, visuals, next_steps });
  if (saveTo) {
    fs.writeFileSync(saveTo, json, 'utf8');
    console.log(`Saved: ${saveTo} (the report after curation.json, niche.json and the preset)`);
  } else {
    process.stdout.write(json);
  }
}
