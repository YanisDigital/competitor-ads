import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_PATTERNS, buildQueries, checkClientFit, serviceEconomics, lintHypotheses, seasonWarnings } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(__dirname, '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report');
const SCRIPTS = path.join(SKILL, 'scripts');
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' };
const py = (code, ...args) => spawnSync('python', ['-c', 'import sys, json; sys.path.insert(0, ' + JSON.stringify(SCRIPTS) + '); ' + code, ...args], { encoding: 'utf8', env: ENV });

// ---- 1. creatives are downloaded after the competitors are chosen -----------------

test('scrape --creatives waits for curation.json: pictures of non-competitors are not worth downloading', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'order-'));
  const r1 = py('import scrape; print(scrape.creatives_step(__import__("pathlib").Path(sys.argv[1])))', dir);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.stdout.trim(), 'curate_first');
  writeFileSync(path.join(dir, 'curation.json'), JSON.stringify({ exclude: [] }));
  const r2 = py('import scrape; print(scrape.creatives_step(__import__("pathlib").Path(sys.argv[1])))', dir);
  assert.equal(r2.stdout.trim(), 'fetch');
});

// ---- 2. the makeup preset -----------------------------------------------------------

const preset = JSON.parse(readFileSync(path.join(SKILL, 'presets', 'makeup.json'), 'utf8'));

test('makeup preset: the makeup services all fit into the default 12 queries, in both languages', () => {
  assert.equal(preset.id, 'makeup');
  assert.deepEqual(preset.languages, ['uk', 'ru']);
  const q = buildQueries(preset, { uk: 'Одеса', ru: 'Одесса' }, 12);
  assert.equal(q.length, 12);
  assert.equal(new Set(q).size, 12);
  assert.ok(q.includes('макіяж Одеса') && q.includes('макияж Одесса'));
  assert.ok(q.some(x => /візажист/.test(x)) && q.some(x => /визажист/.test(x)));
  assert.ok(q.some(x => /денний макіяж/.test(x)));
  for (const s of preset.services) for (const lang of preset.languages) assert.ok(s[lang], 'both languages for every service');
});

test('makeup preset: hooks compile and catch occasion, staying power and hair; seasons and the permanent-makeup note are there', () => {
  const hooks = Object.fromEntries(Object.entries(preset.extra_hooks).map(([k, src]) => [k, new RegExp(src)]));
  const hit = (label, text) => Object.entries(hooks).some(([k, re]) => k === label && re.test(text.toLowerCase()));
  const labels = Object.keys(hooks);
  assert.ok(labels.length >= 3);
  const occasion = labels.find(l => hooks[l].test('макіяж на весілля, випускний або фотосесію'));
  const lasting = labels.find(l => hooks[l].test('стійкий макіяж на весь день'));
  const hair = labels.find(l => hooks[l].test('макіяж і зачіска'));
  assert.ok(occasion && lasting && hair, labels.join(' | '));
  assert.ok(!hit(occasion, 'денний макіяж від 1300 грн'));
  assert.match(preset.policy, /перманент/i);
  assert.ok(preset.seasons.length >= 2);
  for (const s of preset.seasons) assert.match(s.from + s.to, /^\d\d-\d\d\d\d-\d\d$/);
  // a window may wrap the new year: the helper already knows
  assert.ok(Array.isArray(seasonWarnings(Date.UTC(2026, 11, 20) / 1000, preset.seasons)));
  assert.ok(preset.noise.some(w => /курс|навчан|обучен/.test(w)));
});

// ---- 3. "курс" in laser epilation is a series of procedures, not a course --------------

test('hook "обучение/курсы": a course of procedures is not training, a real course still is', () => {
  const re = HOOK_PATTERNS['обучение/курсы'];
  for (const t of ['ціна фіксується на весь курс', 'лазерна епіляція: курс 6 процедур', 'курс лазерної епіляції зі знижкою', 'цена фиксируется на курс', 'повний курс сеансів', 'підписуйся, щоб бути в курсі акцій']) assert.equal(re.test(t), false, t);
  for (const t of ['курс «майстер манікюру»', 'базовий курс для початківців', 'навчання перманентному макіяжу', 'курс по таргету для новачків', 'онлайн-курс з smm', 'запишись на курс по smm', 'обучение с нуля', 'course for beginners', 'курс підвищення кваліфікації', 'авторський курс'])
    assert.equal(re.test(t), true, t);
});

// ---- 4. a client brief for services -----------------------------------------------------

test('checkClientFit: service facts (experience, address, booking link, first visit, portfolio) gate their hooks', () => {
  const none = Object.fromEntries(checkClientFit({}, ['опыт/годы', 'адрес/район', 'запись/бронь', 'первый визит', 'портфолио/работы']).map(x => [x.hook, x]));
  for (const h of Object.keys(none)) assert.equal(none[h].status, 'unknown', h);
  assert.deepEqual(none['запись/бронь'].missing, ['booking_url']);
  const c = { experience_years: 5, address: 'вул. Приклад, 1', booking_url: 'https://book.example/x', first_visit_offer: false, portfolio_ready: true };
  const fit = Object.fromEntries(checkClientFit(c, ['опыт/годы', 'адрес/район', 'запись/бронь', 'первый визит', 'портфолио/работы']).map(x => [x.hook, x.status]));
  assert.deepEqual(fit, { 'опыт/годы': 'ready', 'адрес/район': 'ready', 'запись/бронь': 'ready', 'первый визит': 'blocked', 'портфолио/работы': 'ready' });
});

test('checkClientFit: the generic beauty hooks reuse the e-commerce facts (reviews, discount, bonus, deadline, guarantee)', () => {
  const fit = Object.fromEntries(checkClientFit({ reviews_count: 12, reviews_quotable: true, max_discount_pct: 0, bonus: false, real_deadline: true, guarantee_days: null },
    ['отзывы/рейтинг', 'процент/скидка', 'акция', 'подарок/сертификат', 'дедлайн/ограничение', 'гарантия']).map(x => [x.hook, x.status]));
  assert.deepEqual(fit, { 'отзывы/рейтинг': 'ready', 'процент/скидка': 'blocked', 'акция': 'blocked', 'подарок/сертификат': 'blocked', 'дедлайн/ограничение': 'ready', 'гарантия': 'unknown' });
});

test('lintHypotheses: a booking claim without a confirmed link is a warning for a service client', () => {
  const h = { name: 'H', angle: 'a', evidence: ['e'], headline: 'Макіяж від 1300 грн', primary_text: 'Запис онлайн у зручний час.', cta: 'Записатися', destination: 'd', test: 't', metric: 'm', risk: 'r' };
  const warn = lintHypotheses([h], { client: { product: 'x', booking_url: null } })[0].findings.map(f => f.code);
  assert.ok(warn.includes('claims_unconfirmed_hook'), warn.join(','));
  const ok = lintHypotheses([h], { client: { product: 'x', booking_url: 'https://book.example/x' } })[0].findings.map(f => f.code);
  assert.ok(!ok.includes('claims_unconfirmed_hook'), ok.join(','));
});

test('serviceEconomics: lifetime value and the break-even price of a client and of a booking', () => {
  const e = serviceEconomics({ avg_check: 1300, visits_per_year: 6, retention_months: 12, margin_pct: 50, booking_to_visit_pct: 70 });
  assert.equal(e.ltv, 7800);
  assert.equal(e.gross_profit_per_client, 3900);
  assert.equal(e.break_even_cpa_client, 3900);
  assert.equal(e.break_even_cpa_booking, 2730);
  assert.deepEqual(e.missing, []);
  const p = serviceEconomics({ avg_check: 1300, visits_per_year: 1, retention_months: 12 });
  assert.equal(p.ltv, 1300);
  assert.equal(p.break_even_cpa_client, null);
  assert.deepEqual(p.missing, ['margin_pct', 'booking_to_visit_pct']);
  assert.equal(serviceEconomics(null).ltv, null);
  assert.equal(serviceEconomics({ avg_check: 0, visits_per_year: 3, retention_months: 6, margin_pct: 50 }).ltv, 0);
});

test('client_fit.js asks service questions and prints the economics', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'svc-'));
  const csv = 'id,page,start,active,fmt,variants,cta,link,platforms,kws,title,body\n"1","A","2026-09-01","true","IMAGE","1","x","https://a.example/","facebook","q","t","Запис онлайн, 📍 вул. Приклад, 1. 5 років досвіду"';
  writeFileSync(path.join(dir, 'ads.csv'), csv);
  writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ product: 'Макіяж', avg_check: 1300, visits_per_year: 4, retention_months: 12, margin_pct: 40 }));
  const r = spawnSync('node', [path.join(SCRIPTS, 'client_fit.js'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.economics.ltv, 5200);
  assert.equal(out.economics.break_even_cpa_client, 2080);
  assert.deepEqual(out.economics.missing, ['booking_to_visit_pct']);
  assert.ok(Array.isArray(out.questions));
});
