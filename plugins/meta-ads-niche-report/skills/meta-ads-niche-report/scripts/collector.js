(() => {
  // ==========================================================================
  // Config: hook detection patterns.
  // Each key is a display label (shown to the user in hook_freq); each value
  // is a regex matched (case-insensitive, lowercased text) against
  // "title + body" of an ad. Patterns cover Ukrainian, Russian and English,
  // since Ads Library results mix all three depending on advertiser/locale.
  // ==========================================================================
  const HOOK_PATTERNS = {
    'цена в грн': /\d[\d\s]*\s*(грн|₴|uah)/,
    'процент/скидка': /(\d+\s*%|знижк|скидк|discount|sale)/,
    'акция': /(акці|акци|promo)/,
    'первый визит': /(перш\S* (візит|процедур|знайомств)|перв\S* (визит|процедур|знакомств)|нов\S* клієнт|нов\S* клиент|first visit|new client)/,
    'бесплатно': /(безкоштовн|бесплатн|\bfree\b)/,
    'подарок/сертификат': /(подарун|подарок|сертифікат|сертификат|\bgift\b|certificate)/,
    'гарантия': /(гарант|guarantee)/,
    'отзывы/рейтинг': /(відгук|отзыв|рейтинг|review|rating)/,
    'опыт/годы': /(досвід|опыт|\d+\s*(років|лет|роки|года)|years? of experience)/,
    'дедлайн/ограничение': /(тільки до|только до|до \d{1,2}[.\s]|залишилось|осталось|обмежен|ограничен|limited time|last chance|only until)/,
    'рассрочка': /(розстроч|рассроч|частин|installment)/,
    'запись/бронь': /(запис|запиш|бронь|бронюй|book now|sign up)/,
    'обучение/курсы': /(навчан|обучен|курс|\bcourse\b|training)/,
    'до/после': /(до і після|до и после|before.*after)/,
    'адрес/район': /(📍|вул\.|вулиц|ул\.|улиц|просп|пров\.|район|метро|адрес|адреса)/
  };

  // ==========================================================================
  // Pure functions — no DOM/window access, safe to unit-test in Node.
  // ==========================================================================

  const pick = (x) => (x && typeof x === 'object') ? (x.text || '') : (x || '');

  // Resolves an Ads Library link to a bare domain, unwrapping the
  // l.facebook.com/l.php?u=... redirect wrapper along the way.
  function unwrapUrl(u) {
    try {
      let x = new URL(u);
      if (/facebook\.com$/.test(x.hostname) && x.searchParams.get('u')) x = new URL(x.searchParams.get('u'));
      return x;
    } catch (e) {
      return null;
    }
  }

  function domainOf(u) {
    const x = unwrapUrl(u);
    return x ? x.hostname.replace(/^(www|l|m)\./, '') : '';
  }

  const MARKETPLACES = /(^|\.)(prom\.ua|rozetka\.com\.ua|olx\.ua|kasta\.ua|amazon\.com|etsy\.com|ebay\.com|walmart\.com|temu\.com|aliexpress\.com|shop\.tiktok\.com)$/;
  const APP_STORES = /^(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)$/;
  const AFFILIATE_LINKS = /^(urlgeni\.us|geni\.us|amzlink\.to|amzn\.to|a\.co|howl\.link|shrsl\.com|go\.magik\.ly|shop-links\.co)$/;
  // Signals of a brick-and-mortar business: CTAs and phrases that only make
  // sense for a physical location.
  // Strong signals flag a page on a single ad; weak ones (phrases an online
  // store also uses, e.g. "visit us", "book now") only when at least half of
  // the page's ads have one. A single weak phrase flagged an online store.
  const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  const LOCAL_STRONG_CTA = /(get directions|call now|get quote)/i;
  const LOCAL_STRONG_TEXT = new RegExp('(locally owned|established in|walk.?ins? welcome|free estimates?|service center|dealership|law firm|attorneys?\\b|serving [A-Z][a-z]+|located (?:in|at|on)\\b|\\b[A-Z][a-z]+,\\s?(?:' + US_STATES + ')\\b|\\b(?:' + US_STATES + ')\\s\\d{5}\\b)');
  const LOCAL_WEAK = /(stop by|visit us|come in\b|our (?:store|shop|location)|book now)/i;
  const strongLocal = r => LOCAL_STRONG_CTA.test(r.cta || '') || LOCAL_STRONG_TEXT.test((r.title || '') + ' ' + (r.body || ''));
  const weakLocal = r => LOCAL_WEAK.test((r.cta || '') + ' ' + (r.title || '') + ' ' + (r.body || ''));
  const PLATFORM_DOORS = ['Маркетплейс', 'Установка приложения'];
  const SHORT_LINKS =/^(bit\.ly|tinyurl\.com|cutt\.ly|rebrand\.ly|goo\.gl|ow\.ly|is\.gd|shorturl\.at|t\.ly)$/;

  // Finds the first card (DCO / carousel) whose title or body is non-empty.
  function firstNonEmptyCard(cards) {
    for (const c of cards) {
      const title = pick(c && c.title);
      const body = pick(c && c.body);
      if (title || body) return { title, body, cta_text: c.cta_text, link_url: c.link_url };
    }
    return null;
  }

  // Turns a raw Ads Library node (ad_archive_id + snapshot) into a flat
  // record. DCO ads carry an unresolved "{{product.name}}" template in
  // snapshot.body/title; the real text lives in snapshot.cards[], so when a
  // template placeholder is detected we substitute the first non-empty
  // card's text instead and record how many cards the ad has (ncards).
  function normalizeAd(node, kw) {
    const s = node.snapshot || {};
    const cards = Array.isArray(s.cards) ? s.cards : [];
    let title = pick(s.title);
    let body = pick(s.body);
    let cta = s.cta_text || '';
    let link = s.link_url || '';
    const isTemplated = title.includes('{{') || body.includes('{{');
    if (isTemplated || (!title && !body && cards.length)) {
      const card = firstNonEmptyCard(cards);
      if (card) {
        title = isTemplated || !title ? card.title || title : title;
        body = isTemplated || !body ? card.body || body : body;
        cta = cta || card.cta_text || '';
        link = link || card.link_url || '';
      }
    }
    if (!cta && cards[0]) cta = cards[0].cta_text || '';
    if (!link && cards[0]) link = cards[0].link_url || '';
    // Catalog/DPA ads keep placeholders like {{product.brand}} with no card
    // text to fall back on. Strip them and flag the ad so it isn't mistaken
    // for real copy.
    const catalog = title.includes('{{') || body.includes('{{');
    if (catalog) {
      title = title.replace(/\{\{[^}]*\}\}/g, '').replace(/\s*\|\s*$/, '').trim();
      body = body.replace(/\{\{[^}]*\}\}/g, '').trim();
    }
    return {
      catalog,
      id: node.ad_archive_id,
      page_id: node.page_id || s.page_id,
      page: node.page_name || s.page_name,
      active: node.is_active,
      start: node.start_date,
      end: node.end_date,
      title,
      body: body.slice(0, 500),
      cta,
      link,
      cats: (s.page_categories || []).join('|'),
      platforms: (node.publisher_platform || []).join('|'),
      fmt: s.display_format || '',
      variants: node.collation_count || 1,
      ncards: cards.length,
      kws: kw ? [kw] : []
    };
  }

  // The Ads Library prints "~73 results" in the UI language; match English,
  // Ukrainian and Russian so the captured-vs-shown completeness check still
  // works when Facebook isn't set to English.
  function resultCountOf(text) {
    const m = String(text || '').match(/[~≈]?\s*\d[\d,. ]*\s*(?:results?|результат\S*)/i);
    return m ? m[0].trim() : '0 results';
  }

  // Builds search queries from a niche preset (presets/*.json) and a city
  // written per language, e.g. cities = { uk: 'Одеса', ru: 'Одесса' }.
  // Services alternate across languages so a small `max` still covers every
  // service in at least one language before repeating.
  function buildQueries(preset, cities, max = 12) {
    const out = [];
    for (const lang of preset.languages) {
      preset.services.forEach((s, i) => {
        const name = s[lang];
        if (!name) return;
        out.push({ i, q: (name + ' ' + ((cities && (cities[lang] || cities.en)) || '')).trim() });
      });
    }
    out.sort((a, b) => a.i - b.i);
    return [...new Set(out.map(o => o.q))].slice(0, max);
  }

  // Classifies where an ad's link/CTA sends the viewer.
  function classifyDoor(rec) {
    const d = domainOf(rec.link);
    const cta = rec.cta || '';
    // Order matters. Off-platform messengers (wa.me, t.me) win over the
    // generic "Message" CTA. But a "Send message" CTA on an ad whose link is
    // just instagram.com/facebook.com is a Direct/Messenger ad: Meta fills
    // link_url with the profile URL there, so the domain alone would
    // misreport most small-business ads as "profile" ads.
    if (d === 'wa.me' || d === 'api.whatsapp.com' || /whatsapp/i.test(cta)) return 'WhatsApp';
    if (d === 't.me') return /bot\/?$/i.test(unwrapUrl(rec.link).pathname) ? 'Telegram-бот' : 'Telegram';
    if (d === 'm.me' || /message/i.test(cta)) return 'Директ/Messenger';
    if (d === 'instagram.com') return 'Instagram-профиль';
    if (/^(facebook\.com|fb\.com|fb\.me)$/.test(d)) return 'Facebook-страница';
    if (MARKETPLACES.test(d)) return 'Маркетплейс';
    if (APP_STORES.test(d)) return 'Установка приложения';
    if (AFFILIATE_LINKS.test(d)) return 'Партнёрская ссылка';
    if (SHORT_LINKS.test(d)) return 'Короткая ссылка';
    if (/call/i.test(cta)) return 'Звонок';
    if (d) return 'Сайт';
    return 'Без ссылки';
  }

  // Aggregates normalized rows into the report shape consumed by SKILL.md's
  // Step 5-7. `opts.now` (unix seconds) lets tests pin "today" instead of
  // depending on the wall clock; defaults to Date.now() otherwise.
  function buildReport(rows, opts = {}) {
    const longDays = opts.longDays || 90;
    const now = opts.now || Date.now() / 1000;
    // Defensive dedup: callers normally pass rows already unique by id
    // (Object.values(M.store)), but buildReport shouldn't double-count if
    // the same ad shows up twice (e.g. rows collected across two runs).
    // Last occurrence wins, matching how window.__mai.store is written.
    rows = [...new Map(rows.map(r => [r.id, r])).values()];
    const age = r => Math.round((now - r.start) / 86400);
    const cnt = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const pages = {};
    for (const r of rows) {
      const p = pages[r.page] || (pages[r.page] = { page: r.page, page_id: r.page_id, library_url: r.page_id ? 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&view_all_page_id=' + r.page_id : '', ads: 0, oldest_days: 0, newest_days: Infinity, doors: new Set(), sites: new Set(), cats: r.cats });
      p.ads++;
      p.oldest_days = Math.max(p.oldest_days, age(r));
      p.newest_days = Math.min(p.newest_days, age(r));
      p.doors.add(classifyDoor(r));
      const d = domainOf(r.link);
      if (d && !/instagram|facebook|fb\.com|fb\.me|m\.me|wa\.me|t\.me/.test(d) && !MARKETPLACES.test(d) && !APP_STORES.test(d) && !SHORT_LINKS.test(d) && !AFFILIATE_LINKS.test(d)) p.sites.add(d);
      if (strongLocal(r)) p.local = true;
      if (weakLocal(r)) p.weak = (p.weak || 0) + 1;
    }
    const pageList = Object.values(pages)
      .map(({ weak, ...p }) => ({ ...p, local: !!p.local || (weak || 0) >= p.ads / 2, platform: [...p.doors].every(d => PLATFORM_DOORS.includes(d)), doors: [...p.doors].join(', '), sites: [...p.sites].join(', ') }))
      .sort((a, b) => b.ads - a.ads);
    // opts.onlineOnly (set by online-niche presets): drop brick-and-mortar
    // pages and big platforms (Amazon, eBay, app-install ads) from the
    // longrun and samples lists. They are still counted and flagged.
    const outOfNiche = new Set(opts.onlineOnly ? pageList.filter(p => p.local || p.platform).map(p => p.page) : []);
    const shopify_stores = pageList.filter(p => /(^|, )[^,]*\.myshopify\.com/.test(p.sites)).map(p => ({ page: p.page, sites: p.sites }));
    const text = r => ((r.title || '') + ' ' + (r.body || '')).toLowerCase();
    const freq = {};
    // opts.extraHooks: { label: regexSource } from a niche preset.
    // opts.baseHooks === false: only the preset's hooks (e.g. a US preset
    // shouldn't report Ukrainian-language hooks that are all zero).
    const hooks = opts.baseHooks === false ? {} : { ...HOOK_PATTERNS };
    for (const [k, src] of Object.entries(opts.extraHooks || {})) hooks[k] = new RegExp(src);
    for (const [k, p] of Object.entries(hooks)) freq[k] = rows.filter(r => p.test(text(r))).length;
    // opts.noise: words from a preset. Pages whose ads mention them are
    // suggested for exclude(); the caller decides, nothing is dropped here.
    const noiseWords = (opts.noise || []).map(w => w.toLowerCase());
    const noiseCount = {};
    if (noiseWords.length) for (const r of rows) if (noiseWords.some(w => text(r).includes(w))) noiseCount[r.page] = (noiseCount[r.page] || 0) + 1;
    const noise_candidates = Object.entries(noiseCount).map(([page, ads]) => ({ page, ads_matching: ads, ads_total: pages[page].ads })).sort((a, b) => b.ads_matching - a.ads_matching);
    const buckets = { '<7': 0, '7-30': 0, '30-90': 0, '90-365': 0, '>365': 0 };
    rows.forEach(r => { const a = age(r); buckets[a < 7 ? '<7' : a < 30 ? '7-30' : a < 90 ? '30-90' : a < 365 ? '90-365' : '>365']++; });
    const snip = r => ((r.title ? r.title + ' | ' : '') + (r.body || '')).replace(/\s+/g, ' ').slice(0, 160);
    // Max 2 longrun entries per advertiser, so one advertiser running many
    // copies of the same creative can't fill the whole list.
    const perPage = {};
    // Ranked by creative variants first (many variants of one ad = active
    // testing/scaling), then by age.
    const longrun = rows.filter(r => age(r) >= longDays && !outOfNiche.has(r.page)).sort((a, b) => (b.variants - a.variants) || (a.start - b.start))
      .filter(r => (perPage[r.page] = (perPage[r.page] || 0) + 1) <= 2).slice(0, 25)
      .map(r => ({ page: r.page, days: age(r), fmt: r.fmt, variants: r.variants, door: classifyDoor(r), id: r.id, url: 'https://www.facebook.com/ads/library/?id=' + r.id, text: snip(r) }));
    // One sample per advertiser: the oldest ad, i.e. the most battle-tested one.
    const seen = new Set();
    const samples = rows.filter(r => !outOfNiche.has(r.page)).sort((a, b) => a.start - b.start)
      .filter(r => !seen.has(r.page) && seen.add(r.page)).slice(0, 35).map(r => ({ page: r.page, text: snip(r) }));
    // Prices mentioned in ad text, in opts.currency (UAH by default, USD for
    // US presets); "X instead of Y" / "was X now Y" pairs and "N% off"
    // mentions give the typical discount.
    const currency = String(opts.currency || 'UAH').toUpperCase();
    const num = s => +String(s).replace(/\s/g, '').replace(',', '.');
    const amounts = [];
    const discounts = [];
    const pctOff = [];
    let adsWithPrice = 0;
    for (const r of rows) {
      const t = text(r);
      const found = currency === 'USD'
        ? [...t.matchAll(/\$\s?(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:\.\d{1,2})?)\s?(?:usd|dollars?)\b/g)].map(m => num(m[1] || m[2])).filter(n => n >= 1 && n <= 10000)
        : [...t.matchAll(/(\d[\d\s]{0,6}\d|\d)\s*(?:грн|₴|uah|гривен|гривень)/g)].map(m => num(m[1])).filter(n => n >= 10 && n <= 100000);
      if (found.length) { adsWithPrice++; amounts.push(...found); }
      const pairs = currency === 'USD'
        ? [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)\s*\(?\s*(?:instead of|was|reg\.?|regularly)\s*\$?\s?(\d+(?:\.\d+)?)/g)].map(m => [m[1], m[2]])
            .concat([...t.matchAll(/was\s*\$\s?(\d+(?:\.\d+)?)\s*[,—–-]?\s*now\s*(?:only\s*)?\$\s?(\d+(?:\.\d+)?)/g)].map(m => [m[2], m[1]]))
        : [...t.matchAll(/(\d[\d\s]{0,6})\s*(?:грн|₴)?\s*\(?(?:замість|вместо|instead of)\s*(\d[\d\s]{0,6})/g)].map(m => [m[1], m[2]]);
      for (const [n, o] of pairs) {
        const nw = num(n), old = num(o);
        if (old > nw && nw > 0) discounts.push(Math.round((1 - nw / old) * 100));
      }
      for (const m of t.matchAll(/(\d{1,2})\s*%\s*(?:off|знижк|скидк)|(?:знижк\S*|скидк\S*|save)\s*(?:до\s*|up to\s*)?-?(\d{1,2})\s*%|(?:^|\s)-(\d{1,2})\s*%/g)) {
        pctOff.push(+(m[1] || m[2] || m[3]));
      }
    }
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
    const prices = {
      currency,
      ads_with_price: adsWithPrice,
      min: amounts.length ? Math.min(...amounts) : null, median: med(amounts), max: amounts.length ? Math.max(...amounts) : null,
      discount_pairs: discounts.length, median_discount_pct: med(discounts),
      pct_off_mentions: pctOff.length, median_pct_off: med(pctOff)
    };
    // The same ad copy running on several different pages: a page network or
    // a copied creative. Key = first 70 alphanumeric chars of title+body.
    const clusters = {};
    for (const r of rows) {
      const key = text(r).replace(/[^a-zа-яіїєґ0-9]/g, '');
      if (key.length < 30) continue;
      const c = clusters[key.slice(0, 70)] || (clusters[key.slice(0, 70)] = { text: snip(r), pages: new Set(), ads: 0, oldest_days: 0 });
      c.pages.add(r.page); c.ads++; c.oldest_days = Math.max(c.oldest_days, age(r));
    }
    const creative_clusters = Object.values(clusters).filter(c => c.pages.size >= 2)
      .map(c => ({ ...c, pages: [...c.pages] })).sort((a, b) => b.pages.length - a.pages.length || b.oldest_days - a.oldest_days).slice(0, 15);
    // Different pages sending traffic to the same own site: one store, several pages.
    const bySite = {};
    for (const p of pageList) for (const s of p.sites.split(', ').filter(Boolean)) (bySite[s] = bySite[s] || []).push(p.page);
    const store_groups = Object.entries(bySite).filter(([, pgs]) => pgs.length >= 2).map(([site, pgs]) => ({ site, pages: pgs })).sort((a, b) => b.pages.length - a.pages.length).slice(0, 15);
    return {
      ads: rows.length,
      advertisers: pageList.length,
      single_ad_advertisers: pageList.filter(p => p.ads === 1).length,
      doors: cnt(rows.map(classifyDoor)),
      ctas: cnt(rows.map(r => r.cta || '(нет)')),
      platforms: cnt(rows.flatMap(r => (r.platforms || '').split('|').filter(Boolean))),
      formats: cnt(rows.map(r => r.fmt || '?')),
      age_buckets: buckets,
      hook_freq: freq,
      catalog_ads: rows.filter(r => r.catalog).length,
      local_pages: pageList.filter(p => p.local).map(p => p.page),
      platform_pages: pageList.filter(p => p.platform).map(p => p.page),
      shopify_stores,
      creative_clusters,
      store_groups,
      noise_candidates,
      prices,
      top_pages: pageList.slice(0, 15),
      longrun,
      samples
    };
  }

  // Serializes rows to CSV (quoted, internal quotes doubled, whitespace
  // collapsed so multi-line ad bodies stay on one CSV line).
  function toCsv(rows) {
    const cols = ['id', 'page', 'start', 'active', 'fmt', 'variants', 'cta', 'link', 'platforms', 'kws', 'title', 'body'];
    const esc = v => {
      let s = String(Array.isArray(v) ? v.join('; ') : (v ?? '')).replace(/\s+/g, ' ');
      // Ad text/page names/CTAs are untrusted third-party input. A value
      // starting with = + - @ is read as a formula by Excel/Sheets when the
      // CSV is opened — prefix it with a quote so it's treated as text.
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = rows.map(r => cols.map(c => esc(c === 'start' ? new Date(r.start * 1000).toISOString().slice(0, 10) : r[c])).join(','));
    return [cols.join(',')].concat(lines).join('\n');
  }

  // Inverse of toCsv: reads an ads.csv back into rows shaped like the store.
  // Undoes the formula-injection quote prefix. Fields never contain newlines
  // (toCsv collapses whitespace), so a line-based parse is safe.
  function parseCsv(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const cols = lines[0].split(',');
    const field = v => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
    return lines.slice(1).map(l => {
      const v = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(m => field(m[1].replace(/""/g, '"')));
      const o = {};
      cols.forEach((k, i) => { o[k] = v[i]; });
      o.start = Date.parse(o.start + 'T00:00:00Z') / 1000;
      o.variants = +o.variants || 1;
      o.kws = (o.kws || '').split('; ').filter(Boolean);
      return o;
    });
  }

  // Compares two snapshots (arrays of rows) of the same queries, taken at
  // opts.prevTs and opts.currTs (unix seconds). An ad missing from the newer
  // snapshot is NOT necessarily stopped: the library shows only the top of
  // each result list (~120 ads). A stop is "high" confidence only if one of
  // the ad's queries was re-run and that run was not saturated (fewer than
  // opts.cap ads), i.e. it would have listed the ad if it were still active.
  function diffSnapshots(prev, curr, opts = {}) {
    const cap = opts.cap || 90;
    const interval_days = Math.round((opts.currTs - opts.prevTs) / 86400);
    const P = new Map(prev.map(r => [r.id, r]));
    const C = new Map(curr.map(r => [r.id, r]));
    const kwCount = rows => { const m = {}; rows.forEach(r => (r.kws || []).forEach(k => { m[k] = (m[k] || 0) + 1; })); return m; };
    const kwCurr = kwCount(curr);
    const ageAtPrev = r => Math.round((opts.prevTs - r.start) / 86400);
    const url = id => 'https://www.facebook.com/ads/library/?id=' + id;
    const snip = r => ((r.title ? r.title + ' | ' : '') + (r.body || '')).replace(/\s+/g, ' ').slice(0, 140);
    const reliable = r => (r.kws || []).some(k => k in kwCurr && kwCurr[k] < cap);

    const stopped = prev.filter(r => !C.has(r.id)).map(r => ({
      page: r.page, id: r.id, url: url(r.id), age_at_prev: ageAtPrev(r), variants: r.variants,
      confidence: reliable(r) ? 'high' : 'low', text: snip(r)
    }));
    const stoppedHigh = stopped.filter(s => s.confidence === 'high');
    const fresh = curr.filter(r => !P.has(r.id));
    const survivors = curr.filter(r => P.has(r.id));

    // Young tests (< 30 days old at the first snapshot) that are gone vs still running.
    const young = prev.filter(r => ageAtPrev(r) < 30 && reliable(r));
    const youngGone = young.filter(r => !C.has(r.id)).length;

    const count = rows => rows.reduce((m, r) => (m[r.page] = (m[r.page] || 0) + 1, m), {});
    const pp = count(prev), pc = count(curr);
    const highIds = new Set(stoppedHigh.map(s => s.id));
    const gonePages = Object.keys(pp).filter(p => !(p in pc) && prev.filter(r => r.page === p).every(r => highIds.has(r.id)));
    const newPages = Object.keys(pc).filter(p => !(p in pp)).map(p => ({ page: p, ads: pc[p] })).sort((a, b) => b.ads - a.ads);
    const grew = Object.keys(pc).filter(p => p in pp && pc[p] - pp[p] >= 3).map(p => ({ page: p, prev: pp[p], curr: pc[p] })).sort((a, b) => (b.curr - b.prev) - (a.curr - a.prev));

    return {
      interval_days,
      prev_ads: prev.length, curr_ads: curr.length,
      survived: survivors.length,
      new_ads: { count: fresh.length, top: fresh.sort((a, b) => b.variants - a.variants).slice(0, 25).map(r => ({ page: r.page, id: r.id, url: url(r.id), variants: r.variants, text: snip(r) })) },
      stopped: { count: stopped.length, high_confidence: stoppedHigh.length, top: stopped.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) || b.variants - a.variants).slice(0, 25) },
      young_tests: { ads: young.length, gone: youngGone, gone_share: young.length ? Math.round(100 * youngGone / young.length) / 100 : null },
      scaling: survivors.filter(r => r.variants > P.get(r.id).variants).map(r => ({ page: r.page, id: r.id, url: url(r.id), variants_prev: P.get(r.id).variants, variants_curr: r.variants })).sort((a, b) => (b.variants_curr - b.variants_prev) - (a.variants_curr - a.variants_prev)).slice(0, 25),
      pages: { new: newPages.slice(0, 25), gone: gonePages.slice(0, 25), grew: grew.slice(0, 25) }
    };
  }

  // ==========================================================================
  // Browser glue — installs window.__mai, intercepts fetch/XHR, drives
  // scroll. Skipped entirely outside a browser (e.g. when required in Node
  // for tests), since `window` won't exist there.
  // ==========================================================================
  function installBrowser() {
    if (typeof window === 'undefined') return null;
    if (window.__mai) return 'already installed: ' + Object.keys(window.__mai.store).length + ' ads in store';
    const M = window.__mai = { ads: {}, store: {} };
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.ad_archive_id && o.snapshot) M.ads[o.ad_archive_id] = o;
      for (const k in o) walk(o[k]);
    };
    const eat = (t) => {
      if (!t || !t.includes('ad_archive_id')) return;
      for (const line of t.split('\n')) { try { walk(JSON.parse(line)); } catch (e) {} }
    };
    // Scans <script type="application/json"> tags for the SSR-embedded ad
    // batch (the "first load" data path from CLAUDE.md section 2). Exposed
    // as a closure, not just a one-off call, because a CLI driver that
    // installs this file via page.add_init_script runs it before the DOM
    // exists — the scan finds nothing at install time there. M.collect()
    // re-runs it on every call so that path still gets picked up once the
    // page has actually rendered, without duplicating this logic in Python.
    const scanEmbeddedJson = () => document.querySelectorAll('script[type="application/json"]').forEach(s => eat(s.textContent));
    scanEmbeddedJson();
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) {
      if (String(u).includes('graphql')) this.addEventListener('load', () => eat(this.responseText));
      return oo.call(this, m, u, ...r);
    };
    const of = window.fetch;
    window.fetch = async function (...a) {
      const r = await of.apply(this, a);
      try { const u = (a[0] && a[0].url) || String(a[0]); if (u.includes('graphql')) r.clone().text().then(eat); } catch (e) {}
      return r;
    };
    // Adaptive: keeps scrolling until the buffer stops growing for 3 rounds
    // in a row (late GraphQL responses used to be missed by a fixed number
    // of rounds), capped at `n` rounds. Each round waits 1.2s.
    M.scroll = async (n = 15) => {
      let idle = 0, last = Object.keys(M.ads).length;
      // At least 5 rounds and 4 idle rounds before stopping: the first page
      // after opening loads slowly and stopped early in a live run
      // (30 ads vs 114 on the next queries).
      for (let i = 0; i < n && (idle < 4 || i < 5); i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 1200));
        const now = Object.keys(M.ads).length;
        idle = now > last ? 0 : idle + 1;
        last = now;
      }
      window.scrollTo(0, 0);
      return Object.keys(M.ads).length + ' ads buffered';
    };
    M.collect = (kw) => {
      scanEmbeddedJson();
      let n = 0;
      for (const [id, node] of Object.entries(M.ads)) {
        const rec = normalizeAd(node, kw);
        const prevKws = (M.store[id] && M.store[id].kws) || [];
        rec.kws = (kw && !prevKws.includes(kw)) ? prevKws.concat([kw]) : prevKws.slice();
        M.store[id] = rec;
        n++;
      }
      M.ads = {};
      const shown = resultCountOf(document.body.innerText);
      return { kw, captured: n, library_says: shown, total_unique: Object.keys(M.store).length };
    };
    M.exclude = (names) => { let k = 0; for (const [id, r] of Object.entries(M.store)) if (names.includes(r.page)) { delete M.store[id]; k++; } return k + ' removed'; };
    M.buildQueries = buildQueries;
    M.report = (opts = {}) => buildReport(Object.values(M.store), opts);
    M.csv = () => toCsv(Object.values(M.store));
    return 'installed: ' + Object.keys(M.ads).length + ' ads buffered from first page';
  }

  const installResult = installBrowser();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HOOK_PATTERNS, pick, domainOf, resultCountOf, buildQueries, firstNonEmptyCard, normalizeAd, classifyDoor, buildReport, toCsv, parseCsv, diffSnapshots };
  }

  return installResult;
})();
