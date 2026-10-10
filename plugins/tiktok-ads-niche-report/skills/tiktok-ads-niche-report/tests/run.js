#!/usr/bin/env node
// Checks of collector.js on recorded TikTok responses (tests/fixtures).
//   node tests/run.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const C = require('../scripts/collector.js');

const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const json = f => JSON.parse(fx(f));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); }
}

const search = json('library_search.json');
const libRows = search.data.map(it => C.normalizeLibraryAd(it, 'siłownia'));
const NOW = Date.parse('2026-10-09T00:00:00Z') / 1000;

test('library search item normalizes', () => {
  const r = libRows[0];
  assert.strictEqual(r.source, 'library');
  assert.ok(/^\d+$/.test(r.id));
  assert.ok(r.page.length > 0);
  assert.ok(r.start > 1.7e9 && r.last >= r.start);
  assert.strictEqual(r.details, false);
  assert.deepStrictEqual(r.kws, ['siłownia']);
  assert.ok(r.video_url.startsWith('https://'));
});

test('details JSON maps link, CTA, objective, targeting', () => {
  const d = C.detailsFromJson(json('library_details.json'));
  assert.ok(d.link.startsWith('https://'));
  assert.strictEqual(d.cta, 'Order now');
  assert.strictEqual(C.objectiveName(d.objective), 'Продажи/конверсии');
  assert.ok(d.ages.split('|').includes('25-34'));
  assert.ok(!d.ages.split('|').includes('13-17'));
  assert.strictEqual(d.genders, 'female|male');
  assert.ok(d.adv_id.length > 5);
  assert.ok(d.target_countries.includes('DE'));
  assert.strictEqual(d.payer_differs, true); // PAYER EXAMPLE pays for a different advertiser
  assert.ok(!JSON.stringify(d).includes('PAYER EXAMPLE'), 'no payer name anywhere in the parsed details');
  const withUser = C.detailsFromJson({ data: { advertiser: { tt_user: { username: 'example_gym', follower_count: '87.1K' } } } });
  assert.strictEqual(withUser.tt_handle, 'example_gym');
  assert.strictEqual(withUser.tt_followers, 87100);
  const merged = C.mergeDetails(libRows[0], d);
  assert.strictEqual(merged.details, true);
  assert.strictEqual(C.classifyDoor(merged), 'Сайт');
});

test('details page text parses (browser mode)', () => {
  const d = C.parseDetailText(fx('library_detail_page.txt'));
  assert.strictEqual(d.objective, 'App promotion');
  assert.strictEqual(d.cta, 'Go to Google Play');
  assert.ok(d.link.startsWith('https://play.google.com/'));
  assert.strictEqual(d.payer_differs, false); // payer and advertiser are both Advertiser L Limited
  assert.ok(!('paid_by' in d), 'the payer name is not kept');
  assert.strictEqual(d.adv_country, 'China');
  assert.strictEqual(d.tt_handle, 'example_app');
  assert.strictEqual(d.tt_followers, 831900);
  assert.strictEqual(d.reach, '0-1K');
  assert.strictEqual(d.ages, '25-34|35-44');
  assert.strictEqual(d.genders, 'female');
  assert.ok(d.targeting_used.includes('интересы'));
  assert.ok(!d.targeting_used.includes('свои аудитории'));
  assert.ok(d.targeting_used.includes('высокая платёжеспособность') === false);
  assert.strictEqual(C.classifyDoor({ source: 'library', details: true, ...d }), 'Приложение');
});

test('creative center items normalize with industry names', () => {
  const ind = Object.fromEntries(json('cc_filters.json').data.industry.map(x => [String(x.id), x.value]));
  const ms = json('cc_list.json').data.materials;
  const rows = ms.map(m => C.normalizeCcAd(m, '', ind));
  assert.strictEqual(rows[0].source, 'cc');
  assert.ok(rows.every(r => r.ctr_top === null || (r.ctr_top >= 0 && r.ctr_top <= 1)));
  assert.ok(rows.some(r => r.duration > 0));
  assert.ok(rows.every(r => r.video_url === '' || r.video_url.startsWith('https://')));
  const d = C.parseCcDetailText(fx('cc_detail_page.txt'));
  assert.ok(d.link.startsWith('https://shop-b.example/'));
  assert.strictEqual(d.comments, 10);
  assert.strictEqual(d.shares, 1200);
});

test('SKILL.md frontmatter fits claude.ai: no angle brackets, description up to 1024 chars', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const fm = md.match(/^---\r?\n([^]*?)\r?\n---/)[1];
  assert.ok(!/<[^>]*>/.test(fm), 'description contains <...>');
  const desc = fm.match(/^description: '?(.*?)'?\s*$/m)[1];
  assert.ok(desc.length <= 1024, 'description is ' + desc.length + ' chars, claude.ai allows 1024');
});

test('doors', () => {
  const D = o => C.classifyDoor({ source: 'library', details: true, ...o });
  assert.strictEqual(C.classifyDoor({ source: 'library', details: false }), 'Не проверено');
  assert.strictEqual(D({ link: 'https://wa.me/48123' }), 'WhatsApp');
  assert.strictEqual(D({ link: 'https://t.me/shop_bot' }), 'Telegram-бот');
  assert.strictEqual(D({ link: 'https://www.tiktok.com/@gym' }), 'TikTok-профиль');
  assert.strictEqual(D({ link: 'https://allegro.pl/oferta/1' }), 'Маркетплейс');
  assert.strictEqual(D({ link: 'https://apps.apple.com/app/x' }), 'Приложение');
  assert.strictEqual(D({ link: 'https://gym.pl/karnet' }), 'Сайт');
  assert.strictEqual(D({ objective: 'Leads' }), 'Лид-форма');
  assert.strictEqual(D({ cta: 'Send message' }), 'Сообщения');
  assert.strictEqual(D({ objective: 'Reach' }), 'Без ссылки');
});

test('prices per currency', () => {
  assert.deepStrictEqual(C.priceHits('karnet 129 zł, wejście 25 zl', 'PLN').amounts, [129, 25]);
  assert.deepStrictEqual(C.priceHits('nur 49,90 € statt 79 €', 'EUR').amounts, [49.9, 79]);
  assert.deepStrictEqual(C.priceHits('манікюр 450 грн', 'UAH').amounts, [450]);
  assert.deepStrictEqual(C.priceHits('just $19.99 today', 'USD').amounts, [19.99]);
  assert.deepStrictEqual(C.priceHits('1 299 zł', 'PLN').amounts, [1299]);
  assert.deepStrictEqual(C.priceHits('-30% rabatt', 'EUR').pctOff, [30]);
});

test('hooks in several languages', () => {
  const H = C.hookPatterns();
  assert.ok(H['бесплатно'].test('erstes training kostenlos'));
  assert.ok(H['бесплатно'].test('pierwszy trening za darmo'.replace('za darmo', 'darmowy')));
  assert.ok(H['процент/скидка'].test('-20% zniżki'));
  assert.ok(H['запись/бронь'].test('zapisz się dziś'));
  assert.ok(H['POV/сюжетный формат'].test('pov: you finally found a gym'));
  assert.ok(H['хэштеги'].test('#siłownia #fit'));
  assert.ok(!H['обучение/курсы'].test('курс 6 процедур'));
});

test('queries from a preset', () => {
  const preset = { services: [{ pl: 'siłownia', en: 'gym' }, { pl: 'trener personalny', en: 'personal trainer' }, { en: 'pilates' }] };
  const q = C.buildQueries(preset, C.langsForCountry('PL'), { pl: 'Warszawa' }, 12);
  assert.deepStrictEqual(q.map(x => x.q), ['siłownia Warszawa', 'trener personalny Warszawa', 'pilates']);
  assert.strictEqual(q[0].lang, 'pl');
  assert.strictEqual(C.sourceForCountry('PL'), 'library');
  assert.strictEqual(C.sourceForCountry('UA'), 'cc');
  assert.strictEqual(C.currencyForCountry('DE'), 'EUR');
});

function synthLibrary() {
  const day = 86400;
  const mk = (id, page, startDaysAgo, lastDaysAgo, title, extra = {}) => ({ ...C.normalizeLibraryAd({ id: String(id), name: page, first_shown_date: (NOW - startDaysAgo * day) * 1000, last_shown_date: (NOW - lastDaysAgo * day) * 1000, estimated_audience: '1K-10K', subject: 'Sports', title }, 'siłownia'), ...extra });
  const rows = [];
  let id = 100;
  const pages = ['GymA', 'GymB', 'GymC', 'GymD', 'GymE', 'GymF'];
  pages.forEach((p, i) => {
    rows.push(mk(id++, p, 120, 1, 'Pierwszy trening za darmo! Karnet 129 zł ' + p, { details: true, link: 'https://' + p.toLowerCase() + '.pl/karnet', cta: 'Book now', objective: 'Leads', ages: '18-24|25-34', genders: 'female|male', targeting_used: i % 2 ? 'интересы' : '' }));
    rows.push(mk(id++, p, 10, 2, 'Nowy grafik zajęć ' + p));
  });
  rows.push(mk(id++, 'Biuro nieruchomości', 5, 1, 'Mieszkanie z siłownią w budynku'));
  return rows;
}

test('library report: pages, long runs, hooks, targeting', () => {
  const rows = synthLibrary();
  const rep = C.buildReport(rows, { now: NOW, country: 'PL', noise: ['mieszkanie'], cities: ['warszawa'] });
  assert.strictEqual(rep.source, 'library');
  assert.strictEqual(rep.advertisers, 7);
  assert.strictEqual(rep.hypothesis_inputs.long_running_ads, 6);
  assert.ok(rep.longrun.length === 6 && rep.longrun[0].run_days >= 60);
  const free = rep.hypothesis_inputs.winner_hooks.find(h => h.hook === 'бесплатно');
  assert.ok(free && free.strength === 'strong' && free.advertisers === 6);
  assert.strictEqual(rep.prices.currency, 'PLN');
  assert.strictEqual(rep.prices.median, 129);
  assert.strictEqual(rep.doors['Сайт'], 6);
  assert.strictEqual(rep.doors['Не проверено'], 7);
  assert.strictEqual(rep.targeting.ads_with_details, 6);
  assert.strictEqual(rep.noise_candidates[0].page, 'Biuro nieruchomości');
  assert.strictEqual(rep.top_pages[0].landing.startsWith('https://'), true);
});

test('cc report: CTR winners, strength capped', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ ...C.normalizeCcAd({ id: '70000000000000000' + String(i).padStart(2, '0'), ad_title: (i < 10 ? 'Free shipping today! ' : 'New collection ') + 'item ' + i, ctr: i < 10 ? 0.1 : 0.7, like: 100 * i, cost: i % 3, industry_key: 'label_14000000000', objective_key: 'campaign_objective_conversion', video_info: { duration: 15 + i } }, '', { 14000000000: 'Beauty & Personal Care' }), link: 'https://shop' + i + '.com/p' });
  const rep = C.buildReport(rows, { country: 'UA' });
  assert.strictEqual(rep.source, 'cc');
  assert.strictEqual(rep.ctr.top20, 10);
  assert.strictEqual(rep.top_by_ctr[0].ctr_top, 0.1);
  const w = rep.hypothesis_inputs.winner_hooks.find(h => h.hook === 'бесплатно');
  assert.ok(w && w.strength === 'moderate'); // 10 different shops, but Creative Center caps at moderate
  assert.strictEqual(rep.categories['Beauty & Personal Care'], 30);
  assert.strictEqual(rep.prices.currency, 'UAH');
});

test('csv round trip keeps fields', () => {
  const rows = synthLibrary();
  rows[0].title = '=HYPERLINK("x") ' + rows[0].title;
  const back = C.parseCsv(C.toCsv(rows));
  assert.strictEqual(back.length, rows.length);
  assert.strictEqual(back[0].title, rows[0].title);
  assert.strictEqual(back[0].details, true);
  assert.strictEqual(back[1].details, false);
  assert.strictEqual(back[0].start, Date.parse(new Date(rows[0].start * 1000).toISOString().slice(0, 10) + 'T00:00:00Z') / 1000);
  assert.deepStrictEqual(back[0].kws, ['siłownia']);
});

test('curation', () => {
  const rows = synthLibrary();
  const cur = C.applyCuration(rows, { exclude: ['Biuro nieruchomości', 'Typo Page'], exclude_ids: ['100'] });
  assert.strictEqual(cur.rows.length, rows.length - 2);
  assert.deepStrictEqual(cur.not_found, ['Typo Page']);
});

test('hypothesis lint (TikTok rules)', () => {
  const base = { name: 'h', angle: 'a', evidence: 'e', hook_line: 'Pierwszy trening gratis?', scenario: ['hook', 'demo', 'cta'], primary_text: 'Pierwszy trening w [cena] — zapisz się online', cta: 'Book now', destination: 'site', format: 'UGC', test: 't', metric: 'CTR', risk: 'low' };
  const [ok] = C.lintHypotheses([base]);
  assert.strictEqual(ok.errors, 0);
  const [long] = C.lintHypotheses([{ ...base, primary_text: 'x'.repeat(120) }]);
  assert.ok(long.findings.some(f => f.code === 'text_too_long' && f.severity === 'error'));
  const [attr] = C.lintHypotheses([{ ...base, hook_line: 'Masz nadwagę? Ty też?', primary_text: 'Your overweight days are over' }]);
  assert.ok(attr.findings.some(f => f.code === 'personal_attributes'));
  const [ba] = C.lintHypotheses([{ ...base, primary_text: 'Before and after: lose 10 kg in a month' }]);
  assert.ok(ba.findings.some(f => f.code === 'before_after') && ba.findings.some(f => f.code === 'weight_loss'));
  const [cta] = C.lintHypotheses([{ ...base, cta: 'Kliknij tutaj' }]);
  assert.ok(cta.findings.some(f => f.code === 'cta_not_tiktok'));
  const [miss] = C.lintHypotheses([{ name: 'x' }]);
  assert.ok(miss.errors >= 10);
  const client = { guarantee_days: 14, max_discount_pct: 10, reviews_count: 40, reviews_rating: 4.8, reviews_quotable: true, currency: 'PLN', price: 129, real_deadline: false, booking_url: false };
  const [cl] = C.lintHypotheses([{ ...base, primary_text: 'Gwarancja 30 dni, -20% i 4.9★ — zapisz się, 99 zł' }], { client });
  const codes = cl.findings.map(f => f.code);
  assert.ok(codes.includes('guarantee_days_overstated'));
  assert.ok(codes.includes('discount_overstated'));
  assert.ok(codes.includes('rating_overstated'));
  assert.ok(codes.includes('price_not_in_brief'));
  assert.ok(codes.includes('claims_blocked_hook')); // booking_url: false, text says "zapisz się"
});

test('creatives: selection and lint', () => {
  const rows = synthLibrary().map(r => ({ ...r, image_url: 'https://p16-common-sign.tiktokcdn.com/' + r.id + '.jpg', video_url: 'https://library.tiktok.com/api/v1/cdn/1/video/' + r.id }));
  const sel = C.selectCreatives(rows, { limit: 5, perAdvertiser: 1 });
  assert.strictEqual(sel.length, 5);
  assert.ok(sel.every(s => s.kind === 'video'));
  assert.strictEqual(new Set(sel.map(s => s.page)).size, 5);
  assert.ok(sel[0].long_running);
  const manifest = { items: [{ id: sel[0].id, status: 'ok', kind: 'video', video: { status: 'ok', duration: 20 } }, { id: sel[1].id, status: 'ok', kind: 'video' }] };
  const labels = [
    { id: sel[0].id, subject: 'person', style: 'native_ugc', offer_on_screen: ['free'], social_proof: ['none'], brand_visible: true, hook_type: 'question', video_format: 'talking_head', face_first_second: true, text_overlay: true, end_cta: false },
    { id: sel[1].id, subject: 'nope', style: 'native_ugc', offer_on_screen: ['none', 'free'], social_proof: ['none'], brand_visible: 'yes', hook_type: 'question' }
  ];
  const res = C.lintCreatives(labels, manifest);
  const bad = res.findings.filter(f => f.id === sel[1].id && f.severity === 'error').map(f => f.code);
  assert.ok(bad.includes('bad_value') && bad.includes('none_mixed') && bad.includes('bad_type'));
  assert.ok(!res.findings.some(f => f.id === sel[0].id && f.severity === 'error'));
  const sum = C.creativesSummary(rows, labels, manifest, { longDays: 60 });
  assert.strictEqual(sum.labeled, 2);
  assert.ok(sum.fields.find(f => f.field === 'hook_type').values[0].value === 'question');
});

test('frame plan', () => {
  assert.deepStrictEqual(C.videoFramePlan(20).map(p => p.label), ['0s', '1s', '2s', '3s', '25%', '50%', '75%', 'end']);
  assert.deepStrictEqual(C.videoFramePlan(0).map(p => p.label), ['0s']);
});

test('warnings and next steps', () => {
  const stats = C.queryStats(synthLibrary(), synthLibrary(), { queries: ['siłownia', 'gym warszawa'], totals: { 'gym warszawa': 5000 } });
  const w = C.snapshotWarnings({ source: 'library', advertisers: 7, ads: 13, unchecked: 7, queryStats: stats, ts: NOW });
  const codes = w.map(x => x.code);
  assert.ok(codes.includes('small_sample') && codes.includes('wide_queries') && codes.includes('details_missing') && codes.includes('empty_queries'));
  const ccw = C.snapshotWarnings({ source: 'cc', ads: 12, queryStats: [], ts: NOW });
  assert.ok(ccw.some(x => x.code === 'cc_sample'));
  const steps = C.nextSteps({ source: 'library', curated: false, unchecked: 5, age_days: 0 }).map(s => s.code);
  assert.ok(steps.includes('curate') && steps.includes('details') && steps.includes('creatives') && steps.includes('brief') && steps.includes('compare'));
  assert.ok(C.pickForDetails(synthLibrary(), 3).length === 3);
});

test('diff: stops by last-shown date, scaling copies, young tests', () => {
  const day = 86400, T0 = NOW - 21 * day, T1 = NOW;
  const ad = (id, page, title, startDaysBeforeT0, lastAt, kws = ['gym']) => ({ ...C.normalizeLibraryAd({ id: String(id), name: page, title, first_shown_date: (T0 - startDaysBeforeT0 * day) * 1000, last_shown_date: lastAt * 1000 }, ''), kws });
  const prev = [
    ad(1, 'GymA', 'Karnet -50% tylko teraz', 10, T0),        // young, will stop
    ad(2, 'GymA', 'Pierwszy trening gratis', 5, T0),          // young, keeps running and gains copies
    ad(3, 'GymB', 'Siłownia 24/7 blisko ciebie', 100, T0),   // old, keeps running
    ad(4, 'GymC', 'Zapisz się na pilates', 3, T0)            // young, disappears from the list
  ];
  const curr = [
    { ...prev[0], last: T0 + 2 * day },                       // still listed, last shown 19 days ago -> stopped
    { ...prev[1], last: T1 }, ad(21, 'GymA', 'Pierwszy trening gratis', 1, T1), ad(22, 'GymA', 'Pierwszy trening gratis', 0, T1),
    { ...prev[2], last: T1 },
    ad(5, 'GymD', 'Nowy klub w Gdańsku, karnet 99 zł', -5, T1)
  ];
  const d = C.diffSnapshots(prev, curr, { prevTs: T0, currTs: T1, cappedPrev: [], cappedCurr: [] });
  assert.strictEqual(d.interval_days, 21);
  assert.strictEqual(d.stops.confirmed_ads, 1);
  assert.strictEqual(d.stops.stopped_creatives[0].page, 'GymA');
  assert.strictEqual(d.stops.missing_ads, 1);
  assert.strictEqual(d.stops.missing_high_confidence, 1);
  assert.strictEqual(d.scaling.length, 1);
  assert.deepStrictEqual([d.scaling[0].copies_prev, d.scaling[0].copies_curr], [1, 3]);
  assert.deepStrictEqual([d.young_tests.creatives, d.young_tests.gone, d.young_tests.kept], [3, 2, 1]);
  assert.deepStrictEqual(d.pages.new.map(p => p.page), ['GymD']);
  assert.ok(d.pages.gone.some(p => p.page === 'GymC' && p.confidence === 'high'));
  assert.strictEqual(d.dynamics.failed_hooks_enough_data, false);
  const capped = C.diffSnapshots(prev, curr, { prevTs: T0, currTs: T1, cappedCurr: ['gym'] });
  assert.strictEqual(capped.stops.missing_high_confidence, 0);
  assert.ok(capped.pages.missing.some(p => p.page === 'GymC') && !capped.pages.gone.some(p => p.page === 'GymC'));
  const cc = n => C.normalizeCcAd({ id: 'x' + n, ad_title: n % 2 ? 'Free shipping' : 'New', ctr: n / 10, like: n * 10, video_info: { duration: 10 + n } }, '', {});
  const dc = C.diffSnapshots([1, 2, 3].map(cc), [2, 3, 4, 5].map(cc).map(r => ({ ...r, likes: r.likes + 5 })), { prevTs: T0, currTs: T1, source: 'cc' });
  assert.deepStrictEqual([dc.kept, dc.entered.count, dc.dropped.count], [2, 2, 1]);
  assert.strictEqual(dc.likes_growth[0].growth, 5);
});

test('site facts, comparison, pixels, trackers', () => {
  const ad = C.siteFacts('Karnet -50%! Pierwszy trening za darmo, 129 zł', { currency: 'PLN' });
  const site = C.siteFacts('Cennik: karnet 149 zł. Zapisz się online. Opinie 4.8 ★', { currency: 'PLN' });
  const cmp = C.compareAdVsSite(ad, site);
  assert.ok(cmp.promised_not_on_site.includes('бесплатно'));
  assert.ok(cmp.on_site_not_advertised.includes('запись/бронь'));
  assert.deepStrictEqual(cmp.ad_prices_not_on_site, [129]);
  assert.deepStrictEqual(cmp.ad_pct_off_not_on_site, [50]);
  const px = C.pixelsIn('<script src="https://analytics.tiktok.com/i18n/pixel/events.js"></script><script>(function(w,d,s,l,i){})(window,document,"script","dataLayer","GTM-ABC123")</script>');
  assert.deepStrictEqual([px.tiktok, px.meta, px.tag_manager], [true, false, true]);
  assert.ok(C.isTrackerLink('https://ad.doubleclick.net/ddm/trackclk/N1'));
  assert.ok(!C.isTrackerLink('https://gardenclinic.pl/pl/silownia-fitness/'));
});

test('prioritization and TikTok test plan', () => {
  const client = { reviews_count: 40, reviews_quotable: true, guarantee_days: 0, target_cpa: 30 };
  const hyps = [
    { name: 'reviews', hook: 'отзывы/рейтинг', evidence_strength: 'moderate', effort: 2, variable_type: 'creative' },
    { name: 'hook-only', evidence_strength: 'weak', effort: 1, variable_type: 'hook' },
    { name: 'guarantee', hook: 'гарантия', evidence_strength: 'strong', effort: 1, variable_type: 'offer' },
    { name: 'landing', evidence_strength: 'structural', effort: 3, variable_type: 'landing' }
  ];
  const ranked = C.prioritizeHypotheses(hyps, { client, lint: { 'hook-only': { errors: 1 } } });
  assert.strictEqual(ranked.find(r => r.name === 'guarantee').score, 0);
  assert.strictEqual(ranked[0].name, 'reviews');
  const plan = C.planTests(ranked, { client });
  assert.deepStrictEqual(plan.excluded.map(e => e.name), ['guarantee']);
  for (const r of plan.rounds) {
    const fams = r.tests.map(t => (t.variable_type === 'hook' ? 'creative' : t.variable_type));
    assert.strictEqual(new Set(fams).size, fams.length);
  }
  assert.strictEqual(plan.assumptions.per_test_budget, 3000);
});

test('payer names are not stored; payer flag', () => {
  assert.strictEqual(C.payerDiffers('Salon A Sp. z o.o.', 'SALON A SP Z O O'), false);
  assert.strictEqual(C.payerDiffers('SALON B', 'EXAMPLE AGENCY LTD'), true);
  assert.strictEqual(C.payerDiffers('', 'X'), null);
  const row = C.mergeDetails(C.normalizeLibraryAd({ id: '1', name: 'A', title: 't', first_shown_date: 1e12, last_shown_date: 1e12 }, ''), C.detailsFromJson(json('library_details.json')));
  const csv = C.toCsv([row]);
  assert.ok(!csv.includes('PAYER EXAMPLE') && !/paid_by/.test(csv));
  assert.strictEqual(C.parseCsv(csv)[0].payer_differs, true);
  assert.ok(!('paid_by' in C.parseCsv(['"id","paid_by"', '"1","Some Person"'].join('\n'))[0]));
});

test('HTML export: third-party links lose tracking parameters; client budget hidden by default', () => {
  const { buildHtml, cleanUrl } = require('../scripts/export_html.js');
  assert.strictEqual(cleanUrl('https://x.pl/a?ttclid=SECRET&utm_source=tiktok#f'), 'https://x.pl/a');
  assert.strictEqual(cleanUrl('https://u:p@x.pl/a'), '');
  assert.strictEqual(cleanUrl('javascript:alert(1)'), '');
  const rows = synthLibrary();
  const model = {
    report: C.buildReport(rows, { now: NOW, country: 'PL' }), meta: { ts: NOW, country: 'PL', queries: ['gym'] }, rows, warnings: [], query_stats: [], next_steps: [], visuals: null,
    sites: [{ page: 'A', ads: 1, landing: 'https://x.pl/a?ttclid=SECRET', final_url: 'https://x.pl/a?ttclid=SECRET#frag', title: 't', headings: [], pixels: {}, site: { prices: {} }, compare: {} }],
    plan: { ranked: [], plan: { rounds: [{ round: 1, tests: [], budget: 74321 }], excluded: [], assumptions: { variants_per_test: 2, events_per_variant: 50, target_cpa: 8123, min_days_per_round: 7, max_parallel_tests: 2, creative_refresh_days: '7–14' } } }
  };
  const html = buildHtml(model);
  assert.ok(!html.includes('SECRET') && !html.includes('ttclid'));
  assert.ok(!html.includes('74321') && !html.includes('8123'));
  const withBudget = buildHtml({ ...model, withBudget: true });
  assert.ok(withBudget.includes('74321') && withBudget.includes('8123'));
  assert.ok(/Content-Security-Policy/.test(html) && !/<script/i.test(html));
});

test('HTML export escapes hostile ad text and names', () => {
  const { buildHtml } = require('../scripts/export_html.js');
  const evil = `<img src=x onerror=alert(1)>"'<script>alert(2)</script>`;
  const rows = synthLibrary().map(r => ({ ...r, page: evil + r.page, title: evil }));
  const html = buildHtml({ report: C.buildReport(rows, { now: NOW, country: 'PL' }), meta: { ts: NOW, country: 'PL', queries: [evil] }, rows, warnings: [{ message: evil }], query_stats: [{ query: evil, ads: 1, advertisers: 1, relevant_advertisers: null, capped: false }], next_steps: [], visuals: null });
  assert.ok(!/<img src=x|<script>alert/i.test(html));
  assert.ok(html.includes('&lt;img src=x'));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
