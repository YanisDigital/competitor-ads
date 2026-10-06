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

  // An ad the Library marks as no longer running (active_status inactive/all runs).
  const isStoppedAd = r => r.active === false || r.active === 'false';

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
  // Links to the creative itself: the full-size picture (for a video, its
  // preview frame) and the HD video, else SD. Taken from the snapshot, then
  // from the first card (carousel / dynamic ads). Meta serves them from a CDN
  // with a signed, expiring address, so they are for a look now, not an
  // archive. Only http(s) is kept: the value ends up in a spreadsheet link.
  // card_image_urls: the picture of every card (a carousel shows up to 5 at
  // a glance), joined with " | ", for the creative analysis (selectCreatives).
  const httpOnly = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
  const MAX_CARDS = 5;
  const cardImage = c => httpOnly(c && c.original_image_url) || httpOnly(c && c.resized_image_url) || httpOnly(c && c.video_preview_image_url);
  function mediaLinks(s, cards) {
    const img = (s.images || [])[0] || {}, vid = (s.videos || [])[0] || {}, card = cards[0] || {};
    return {
      image_url: httpOnly(img.original_image_url) || httpOnly(img.resized_image_url) || httpOnly(vid.video_preview_image_url) || cardImage(card),
      video_url: httpOnly(vid.video_hd_url) || httpOnly(vid.video_sd_url) || httpOnly(card.video_hd_url) || httpOnly(card.video_sd_url),
      card_image_urls: cards.map(cardImage).filter(Boolean).slice(0, MAX_CARDS).join(' | ')
    };
  }

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
      // Size of the advertiser, the link caption, the language-independent
      // button type, Meta's "digitally created media" flag and the profile link.
      page_likes: Number.isFinite(s.page_like_count) ? s.page_like_count : null,
      caption: s.caption || (cards[0] && cards[0].caption) || '',
      cta_type: s.cta_type || (cards[0] && cards[0].cta_type) || '',
      ai_made: typeof node.contains_digital_created_media === 'boolean' ? node.contains_digital_created_media : null,
      page_url: s.page_profile_uri || '',
      ...mediaLinks(s, cards),
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
    // The Library prints the button in the browser's language ("Надіслати
    // повідомлення"), so the English text rules below miss it; cta_type
    // (INSTAGRAM_MESSAGE, WHATSAPP_MESSAGE, CALL_NOW, ...) does not depend on language.
    const type = String(rec.cta_type || '');
    // Order matters. Off-platform messengers (wa.me, t.me) win over the
    // generic "Message" CTA. But a "Send message" CTA on an ad whose link is
    // just instagram.com/facebook.com is a Direct/Messenger ad: Meta fills
    // link_url with the profile URL there, so the domain alone would
    // misreport most small-business ads as "profile" ads.
    if (d === 'wa.me' || d === 'api.whatsapp.com' || /whatsapp/i.test(cta) || /WHATSAPP/.test(type)) return 'WhatsApp';
    if (d === 't.me') return /bot\/?$/i.test(unwrapUrl(rec.link).pathname) ? 'Telegram-бот' : 'Telegram';
    if (d === 'm.me' || /message/i.test(cta) || /MESSAGE/.test(type)) return 'Директ/Messenger';
    if (d === 'instagram.com') return 'Instagram-профиль';
    if (/^(facebook\.com|fb\.com|fb\.me)$/.test(d)) return 'Facebook-страница';
    if (MARKETPLACES.test(d)) return 'Маркетплейс';
    if (APP_STORES.test(d)) return 'Установка приложения';
    if (AFFILIATE_LINKS.test(d)) return 'Партнёрская ссылка';
    if (SHORT_LINKS.test(d)) return 'Короткая ссылка';
    if (/call/i.test(cta) || /^CALL/.test(type)) return 'Звонок';
    if (d) return 'Сайт';
    return 'Без ссылки';
  }

  // Hook regexes for a run: the base set plus a preset's extraHooks
  // ({ label: regexSource }); opts.baseHooks === false drops the base set
  // (e.g. a US preset shouldn't report Ukrainian-language hooks).
  function hookPatterns(opts = {}) {
    const hooks = opts.baseHooks === false ? {} : { ...HOOK_PATTERNS };
    for (const [k, src] of Object.entries(opts.extraHooks || {})) hooks[k] = new RegExp(src);
    return hooks;
  }

  const num = s => +String(s).replace(/\s/g, '').replace(',', '.');
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

  // Currency a country's ads are priced in (the report's price block, the site
  // check). null for countries without a rule: callers then keep the UAH default.
  const CURRENCY_BY_COUNTRY = { UA: 'UAH', KZ: 'KZT', US: 'USD' };
  const currencyForCountry = c => CURRENCY_BY_COUNTRY[String(c || '').toUpperCase()] || null;

  // Prices, "was/instead of" discount pairs and "N% off" mentions in one text
  // (already lowercased). currency: 'UAH' (default), 'USD' or 'KZT' (₸, тг, тенге).
  function priceHits(t, currency) {
    const amounts = currency === 'USD'
      ? [...t.matchAll(/\$\s?(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:\.\d{1,2})?)\s?(?:usd|dollars?)\b/g)].map(m => num(m[1] || m[2])).filter(n => n >= 1 && n <= 10000)
      : currency === 'KZT'
        ? [...t.matchAll(/(\d[\d\s]{0,8}\d|\d)\s*(?:₸|тг(?![а-яё])|тенге|тнг|kzt)/g)].map(m => num(m[1])).filter(n => n >= 100 && n <= 50000000)
        : [...t.matchAll(/(\d[\d\s]{0,6}\d|\d)\s*(?:грн|₴|uah|гривен|гривень)/g)].map(m => num(m[1])).filter(n => n >= 10 && n <= 100000);
    const pairs = currency === 'USD'
      ? [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)\s*\(?\s*(?:instead of|was|reg\.?|regularly)\s*\$?\s?(\d+(?:\.\d+)?)/g)].map(m => [m[1], m[2]])
          .concat([...t.matchAll(/was\s*\$\s?(\d+(?:\.\d+)?)\s*[,—–-]?\s*now\s*(?:only\s*)?\$\s?(\d+(?:\.\d+)?)/g)].map(m => [m[2], m[1]]))
      : currency === 'KZT'
        ? [...t.matchAll(/(\d[\d\s]{0,8})\s*(?:₸|тг|тенге)?\s*\(?(?:вместо|instead of)\s*(\d[\d\s]{0,8})/g)].map(m => [m[1], m[2]])
        : [...t.matchAll(/(\d[\d\s]{0,6})\s*(?:грн|₴)?\s*\(?(?:замість|вместо|instead of)\s*(\d[\d\s]{0,6})/g)].map(m => [m[1], m[2]]);
    const discounts = [];
    for (const [n, o] of pairs) {
      const nw = num(n), old = num(o);
      if (old > nw && nw > 0) discounts.push(Math.round((1 - nw / old) * 100));
    }
    const pctOff = [...t.matchAll(/(\d{1,2})\s*%\s*(?:off|знижк|скидк)|(?:знижк\S*|скидк\S*|save)\s*(?:до\s*|up to\s*)?-?(\d{1,2})\s*%|(?:^|\s)-(\d{1,2})\s*%/g)].map(m => +(m[1] || m[2] || m[3]));
    return { amounts, discounts, pctOff };
  }

  // Facts from a block of text (a landing page's visible text, or the joined
  // text of an advertiser's ads): which hooks appear and which prices.
  function siteFacts(text, opts = {}) {
    const t = String(text || '').toLowerCase();
    const hits = priceHits(t, String(opts.currency || 'UAH').toUpperCase());
    const list = [...new Set(hits.amounts)].sort((a, b) => a - b);
    return {
      hooks: Object.entries(hookPatterns(opts)).filter(([, re]) => re.test(t)).map(([k]) => k),
      prices: { list, min: list.length ? list[0] : null, median: median(list), max: list.length ? list[list.length - 1] : null },
      pct_off: hits.pctOff
    };
  }

  // Ads vs landing page. Not proof: banners, pop-ups and lazy-loaded blocks
  // may be missing from the extracted page text.
  function compareAdVsSite(ad, site) {
    const near = (a, b) => Math.abs(a - b) < 0.005;
    return {
      promised_not_on_site: ad.hooks.filter(h => !site.hooks.includes(h)),
      on_site_not_advertised: site.hooks.filter(h => !ad.hooks.includes(h)),
      ad_prices_not_on_site: ad.prices.list.filter(p => !site.prices.list.some(s => near(s, p))),
      ad_price_range: [ad.prices.min, ad.prices.max],
      site_price_range: [site.prices.min, site.prices.max]
    };
  }

  // What a client must be able to say truthfully before an ad may use a hook.
  // fields: client.json keys read; ok: fact confirmed; no: fact explicitly absent
  // (null/undefined means "not asked yet"). Ads may only promise confirmed facts.
  const has = v => v !== null && v !== undefined;
  const CLIENT_RULES = {
    'отзывы/звёзды': { fields: ['reviews_count', 'reviews_quotable'], ok: c => c.reviews_count > 0 && c.reviews_quotable === true, no: c => c.reviews_count === 0 || c.reviews_quotable === false },
    'гарантия возврата': { fields: ['guarantee_days'], ok: c => c.guarantee_days > 0, no: c => c.guarantee_days === 0 },
    'бесплатная доставка': { fields: ['free_shipping', 'free_shipping_over'], ok: c => c.free_shipping === true || c.free_shipping_over > 0, no: c => c.free_shipping === false && !(c.free_shipping_over > 0) },
    'бонус/подарок': { fields: ['bonus'], ok: c => !!c.bonus, no: c => c.bonus === false || c.bonus === '' },
    'BOGO/комплект': { fields: ['bundles'], ok: c => Array.isArray(c.bundles) && c.bundles.length > 0, no: c => Array.isArray(c.bundles) && c.bundles.length === 0 },
    'оригинал/подделки': { fields: ['has_copies'], ok: c => c.has_copies === true, no: c => c.has_copies === false },
    'скидка %': { fields: ['max_discount_pct'], ok: c => c.max_discount_pct > 0, no: c => c.max_discount_pct === 0 },
    'срочность': { fields: ['real_deadline'], ok: c => c.real_deadline === true, no: c => c.real_deadline === false },
    'ограниченный запас': { fields: ['real_stock_limit'], ok: c => c.real_stock_limit === true, no: c => c.real_stock_limit === false },
    'персонализация': { fields: ['personalization'], ok: c => c.personalization === true, no: c => c.personalization === false }
  };

  // For each hook label: 'ready' (the client confirmed the fact), 'blocked'
  // (the client said it is not true, so no ad may claim it), 'unknown' (not
  // asked yet; missing lists the client.json fields to ask about) or 'n/a'
  // (the hook needs no client fact).
  function checkClientFit(client, hookLabels) {
    const c = client || {};
    return hookLabels.map(hook => {
      const rule = CLIENT_RULES[hook];
      if (!rule) return { hook, status: 'n/a', missing: [] };
      if (rule.ok(c)) return { hook, status: 'ready', missing: [] };
      if (rule.no(c)) return { hook, status: 'blocked', missing: [] };
      return { hook, status: 'unknown', missing: rule.fields.filter(f => !has(c[f])) };
    });
  }

  // ---- Hand curation of a snapshot ------------------------------------------
  // Library searches match ad TEXT, so every query also returns advertisers that
  // are not competitors (a bath house that mentions "beer", glassware shops,
  // event organizers). Matching keywords cannot tell them apart; a person has to
  // read the advertisers. curation.json (next to ads.csv) stores that decision:
  //   { "include": { "Page name": "type" },   // whitelist; values are labels
  //     "exclude": ["Page name"],             // or a blacklist
  //     "types":   { "Page name": "type" },   // labels only
  //     "notes": "free text" }
  // Without the file nothing changes. Returns the kept rows plus what was
  // removed, the labels and any names that match no advertiser (typos).
  function applyCuration(rows, curation) {
    const c = curation || {};
    const include = c.include && typeof c.include === 'object' ? c.include : null;
    const includeSet = include ? new Set(Object.keys(include)) : null;
    const excludeSet = new Set(Array.isArray(c.exclude) ? c.exclude : []);
    const types = { ...(c.types || {}), ...(include || {}) };
    const keep = r => !excludeSet.has(r.page) && (!includeSet || includeSet.has(r.page));
    const kept = rows.filter(keep);
    const present = new Set(rows.map(r => r.page));
    const named = [...new Set([...excludeSet, ...(includeSet || []), ...Object.keys(c.types || {})])];
    return {
      rows: kept,
      excluded_ads: rows.length - kept.length,
      excluded_pages: [...new Set(rows.filter(r => !keep(r)).map(r => r.page))].sort(),
      types,
      not_found: named.filter(p => !present.has(p))
    };
  }

  // Per query: how many ads and advertisers it brought, how many advertisers
  // survived curation (null when there was none) and whether Meta refused
  // "load more" for it. Shows which queries find competitors and which only
  // bring noise. opts: { queries (run order), rateLimited, curated }.
  function queryStats(allRows, keptRows, opts = {}) {
    const queries = [...new Set([...(opts.queries || []), ...allRows.flatMap(r => r.kws || [])])];
    const limited = new Set(opts.rateLimited || []);
    const pagesOf = (rows, q) => new Set(rows.filter(r => (r.kws || []).includes(q)).map(r => r.page));
    return queries.map(q => ({
      query: q,
      ads: allRows.filter(r => (r.kws || []).includes(q)).length,
      advertisers: pagesOf(allRows, q).size,
      relevant_advertisers: opts.curated ? pagesOf(keptRows, q).size : null,
      rate_limited: limited.has(q)
    }));
  }

  // ---- Warnings a reader must see next to the numbers -----------------------
  // A preset may carry `seasons` ([{name, from:'MM-DD', to:'MM-DD', note}], the
  // window may wrap the new year) and `policy` (a short note for niches Meta
  // restricts, e.g. alcohol or health). Everything else comes from the data.
  const SMALL_SAMPLE = 10; // advertisers; below this a "trend" is a few players

  function seasonWarnings(ts, seasons) {
    const d = new Date(ts * 1000);
    const md = String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    return (seasons || []).filter(s => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to))
      .map(s => ({ name: s.name, note: s.note || '' }));
  }

  // info: { advertisers (after curation), queryStats, ts, preset }.
  // Returns [{ code, severity, message }] in the report language (Russian).
  function snapshotWarnings(info) {
    const w = [];
    const add = (code, severity, message) => w.push({ code, severity, message });
    const stats = info.queryStats || [];
    if (info.advertisers < SMALL_SAMPLE) add('small_sample', 'warn', 'В выборке только ' + info.advertisers + ' рекламодателей: выводы про хуки, форматы и «что работает» это гипотезы для проверки, а не тренд ниши.');
    const limited = stats.filter(q => q.rate_limited);
    if (limited.length) add('rate_limited', 'warn', 'Meta отказала в подгрузке следующих страниц по ' + limited.length + ' из ' + stats.length + ' запросов (' + limited.map(q => q.query).join(', ') + '): по ним только первая партия, около 30 самых показываемых объявлений, а не весь рынок.');
    const empty = stats.filter(q => q.ads === 0);
    if (empty.length) add('empty_queries', 'info', 'Запросы без единого объявления: ' + empty.map(q => q.query).join(', ') + '. Либо нишу так не ищут, либо формулировка не та.');
    for (const s of seasonWarnings(info.ts, info.preset && info.preset.seasons)) add('seasonal', 'warn', 'Срез сделан в сезон «' + s.name + '»' + (s.note ? ': ' + s.note : '') + '. Часть рекламы временная, повтори срез после сезона и не принимай её за обычное состояние ниши.');
    if (info.stoppedAds > 0) add('stopped_included', 'info', 'В выборке ' + info.stoppedAds + ' остановленных объявлений: возраст, долгожители и хуки долгожителей считаются только по работающим, остановленные вынесены в отдельный блок (сколько дней показывались).');
    if (info.preset && info.preset.policy) add('policy', 'info', info.preset.policy);
    return w;
  }

  // 'ru' if the query has letters or word endings only Russian uses (ы э ё ъ,
  // -ое/-ый/-ой/-ая/-ие, a lone "с", a double "сс" as in "Одесса"), otherwise
  // 'uk' (Latin and neutral words go to the first preset language). A guess:
  // the result only groups the suggested preset services, a person reviews it.
  const queryLang = q => (/[ыэёъ]|[а-я](ое|ый|ой|ая|ие)(\s|$)|(^|\s)с(\s|$)|[а-я]сс/i.test(q) ? 'ru' : 'uk');

  // Query hygiene after curation: keep a query only if it found at least one
  // competitor. `weak` marks keepers where under a quarter of the advertisers
  // are competitors (mostly noise). preset_services is ready to paste into a
  // preset; a service may have only one language.
  function suggestQueries(stats) {
    const curated = stats.some(q => q.relevant_advertisers !== null && q.relevant_advertisers !== undefined);
    if (!curated) return { curated: false, keep: [], drop: [], preset_services: [], languages: [] };
    const keep = [], drop = [];
    for (const q of stats) {
      if (q.ads === 0) drop.push({ query: q.query, reason: 'no ads' });
      else if (!q.relevant_advertisers) drop.push({ query: q.query, reason: 'no competitors' });
      else keep.push({ query: q.query, relevant_advertisers: q.relevant_advertisers, advertisers: q.advertisers, weak: q.relevant_advertisers / q.advertisers < 0.25 });
    }
    const langs = keep.map(k => queryLang(k.query));
    return {
      curated: true, keep, drop,
      preset_services: keep.map((k, i) => ({ [langs[i]]: k.query })),
      languages: ['uk', 'ru'].filter(l => langs.includes(l))
    };
  }

  // ---- EU transparency (reach and audience of ads delivered in the EU) -------
  // Meta publishes, for ads that were delivered in the EU, the total reach, the
  // targeting (age, gender, places) and the age/gender split of who was actually
  // reached, per country. The Library sends it only when "See ad details" is
  // opened on an ad, one request per ad (scripts/eu_details.py does that); it is
  // not in the search results. Reach is a number of people for that ad: adding
  // ads of one advertiser counts overlapping people twice, so a sum is an upper
  // bound, not an audience size.
  const EU_COUNTRIES = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
  const isEuCountry = c => EU_COUNTRIES.has(String(c || '').trim().toUpperCase());

  // Which ads to open when only `limit` can be: the longest-running ad of every
  // advertiser first (the one that proved itself), then each advertiser's next
  // oldest, so a few big advertisers do not use up the whole budget.
  function pickEuAds(rows, limit) {
    const byPage = new Map();
    for (const r of [...rows].sort((a, b) => a.start - b.start)) {
      if (!byPage.has(r.page)) byPage.set(r.page, []);
      byPage.get(r.page).push(r.id);
    }
    const queues = [...byPage.values()].sort((a, b) => 0); // insertion order = by each page's oldest ad
    const out = [];
    for (let round = 0; out.length < limit; round++) {
      let any = false;
      for (const q of queues) if (round < q.length && out.length < limit) { out.push(q[round]); any = true; }
      if (!any) break;
    }
    return out;
  }

  // Turns the text of a Library response (JSON, one document per line) into a
  // flat record, or null when the response holds no EU reach.
  function parseEuDetails(text) {
    let eu = null, payer = null;
    const visit = o => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(visit); return; }
      if (!eu && Object.prototype.hasOwnProperty.call(o, 'eu_total_reach')) eu = o;
      if (!payer && Array.isArray(o.payer_beneficiary_data) && o.payer_beneficiary_data.length) payer = o.payer_beneficiary_data[0];
      for (const k in o) visit(o[k]);
    };
    for (const line of String(text || '').split('\n')) { try { visit(JSON.parse(line)); } catch (e) { /* not a JSON line */ } }
    if (!eu || !Number.isFinite(eu.eu_total_reach)) return null;
    const places = Array.isArray(eu.location_audience) ? eu.location_audience : [];
    const breakdown = [];
    for (const c of Array.isArray(eu.age_country_gender_reach_breakdown) ? eu.age_country_gender_reach_breakdown : []) {
      for (const g of Array.isArray(c.age_gender_breakdowns) ? c.age_gender_breakdowns : []) {
        breakdown.push({ country: c.country || '', age_range: g.age_range || '', male: +g.male || 0, female: +g.female || 0, unknown: +g.unknown || 0 });
      }
    }
    return {
      eu_total_reach: eu.eu_total_reach,
      targets_eu: eu.targets_eu === true,
      age_min: eu.age_audience && Number.isFinite(eu.age_audience.min) ? eu.age_audience.min : null,
      age_max: eu.age_audience && Number.isFinite(eu.age_audience.max) ? eu.age_audience.max : null,
      gender: typeof eu.gender_audience === 'string' ? eu.gender_audience : '',
      locations: places.filter(p => !p.excluded).map(p => String(p.name || '')),
      excluded_locations: places.filter(p => p.excluded).map(p => String(p.name || '')),
      breakdown,
      payer: payer && payer.payer ? String(payer.payer) : '',
      beneficiary: payer && payer.beneficiary ? String(payer.beneficiary) : ''
    };
  }

  // eu = parsed eu.json ({ ads: { [adId]: parseEuDetails() } }); rows = the ads
  // that count (curation applied): data for other ads is ignored.
  function euSummary(eu, rows) {
    const empty = { ads: 0, per_ad: [], per_page: [], overall: { reach_sum: 0, age_share: {}, gender_share: {} } };
    if (!eu || !eu.ads) return empty;
    const pageOf = new Map(rows.map(r => [r.id, r.page]));
    const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];
    const r2 = x => Math.round(100 * x) / 100;
    const totals = b => {
      const age = {}, g = { male: 0, female: 0, unknown: 0 };
      for (const x of b) { age[x.age_range] = (age[x.age_range] || 0) + x.male + x.female + x.unknown; g.male += x.male; g.female += x.female; g.unknown += x.unknown; }
      return { age, g, all: g.male + g.female + g.unknown };
    };
    const perAd = [], overallAge = {}, overallG = { male: 0, female: 0, unknown: 0 };
    for (const [id, d] of Object.entries(eu.ads)) {
      if (!d || !pageOf.has(id)) continue;
      const t = totals(d.breakdown || []);
      const known = Object.entries(t.age).filter(([k]) => k !== 'Unknown').sort((a, b) => b[1] - a[1]);
      perAd.push({
        id, page: pageOf.get(id), reach: d.eu_total_reach, age_min: d.age_min, age_max: d.age_max, gender: d.gender, countries: d.locations || [],
        top_age_range: known.length ? known[0][0] : '', top_age_share: known.length && t.all ? r2(known[0][1] / t.all) : null,
        female_share: t.all ? r2(t.g.female / t.all) : null, male_share: t.all ? r2(t.g.male / t.all) : null,
        payer: d.payer || '', beneficiary: d.beneficiary || '', url: 'https://www.facebook.com/ads/library/?id=' + id
      });
      for (const [k, v] of Object.entries(t.age)) overallAge[k] = (overallAge[k] || 0) + v;
      for (const k of Object.keys(overallG)) overallG[k] += t.g[k];
    }
    const pages = new Map();
    for (const a of perAd) {
      const p = pages.get(a.page) || { page: a.page, ads: 0, reach_sum: 0, reach_max: 0, age_min: null, age_max: null, genders: new Set(), countries: new Set(), tops: {}, payers: new Set() };
      p.ads++; p.reach_sum += a.reach; p.reach_max = Math.max(p.reach_max, a.reach);
      if (a.age_min !== null) p.age_min = p.age_min === null ? a.age_min : Math.min(p.age_min, a.age_min);
      if (a.age_max !== null) p.age_max = p.age_max === null ? a.age_max : Math.max(p.age_max, a.age_max);
      if (a.gender) p.genders.add(a.gender);
      a.countries.forEach(c => p.countries.add(c));
      if (a.top_age_range) p.tops[a.top_age_range] = (p.tops[a.top_age_range] || 0) + 1;
      if (a.payer) p.payers.add(a.payer);
      pages.set(a.page, p);
    }
    const perPage = [...pages.values()].map(p => ({
      page: p.page, ads: p.ads, reach_sum: p.reach_sum, reach_max: p.reach_max, age_min: p.age_min, age_max: p.age_max,
      genders: [...p.genders], countries: [...p.countries], top_age_range: Object.entries(p.tops).sort((a, b) => b[1] - a[1])[0]?.[0] || '', payers: [...p.payers]
    })).sort((a, b) => b.reach_sum - a.reach_sum);
    const ageTotal = Object.values(overallAge).reduce((a, b) => a + b, 0), gTotal = overallG.male + overallG.female + overallG.unknown;
    const age_share = {};
    for (const k of [...AGE_ORDER, ...Object.keys(overallAge).filter(k => !AGE_ORDER.includes(k))]) if (overallAge[k]) age_share[k] = r2(overallAge[k] / ageTotal);
    return {
      ads: perAd.length, per_ad: perAd.sort((a, b) => b.reach - a.reach), per_page: perPage,
      overall: {
        reach_sum: perAd.reduce((s, a) => s + a.reach, 0), age_share,
        gender_share: gTotal ? { male: r2(overallG.male / gTotal), female: r2(overallG.female / gTotal), unknown: r2(overallG.unknown / gTotal) } : {}
      }
    };
  }

  // How much a pattern is a niche trend rather than one advertiser's habit
  // (hooks, dynamics, creative tags). strong: several unrelated advertisers,
  // none dominating; weak: one or two, or one dominates.
  const strengthOf = (advertisers, top_share) => (advertisers >= 5 && top_share <= 0.5 ? 'strong' : advertisers >= 3 && top_share <= 0.7 ? 'moderate' : 'weak');

  // ---- Creatives (what is on the pictures) -----------------------------------
  // Pictures are not read by this code: a sample is picked here
  // (selectCreatives), downloaded by fetch_creatives.py into creatives/ with a
  // manifest.json, looked at by Claude, who writes creatives.json with the
  // tags below, checked by lintCreatives and summed up per advertiser by
  // creativesSummary. Videos are judged by their preview frame only.
  const CREATIVE_TAGS = {
    subject: { label: 'Что в кадре', values: ['product', 'person_with_product', 'person', 'face_closeup', 'result_before_after', 'process', 'place', 'text_only'],
      names: { product: 'товар', person_with_product: 'человек с товаром', person: 'человек / специалист в кадре', face_closeup: 'лицо крупно', result_before_after: 'результат / до-после', process: 'процесс работы', place: 'место / интерьер', text_only: 'только текст' } },
    text_on_image: { label: 'Текст на картинке', values: ['none', 'headline', 'heavy'], names: { none: 'нет', headline: 'короткий заголовок', heavy: 'много текста' } },
    price_on_image: { label: 'Цена на картинке', type: 'bool' },
    offer_on_image: { label: 'Оффер на картинке', multi: true, values: ['discount', 'gift', 'free', 'deadline', 'none'], names: { discount: 'скидка', gift: 'подарок', free: 'бесплатно', deadline: 'срок акции', none: 'нет' } },
    social_proof: { label: 'Соцдоказательство', multi: true, values: ['review', 'stars', 'numbers', 'none'], names: { review: 'отзыв', stars: 'звёзды / рейтинг', numbers: 'цифры клиентов', none: 'нет' } },
    style: { label: 'Стиль', values: ['pro_photo', 'ugc_phone', 'template_graphic', 'meme', 'ai_generated'], names: { pro_photo: 'профессиональное фото', ugc_phone: 'UGC / съёмка на телефон', template_graphic: 'графика / шаблон', meme: 'мем', ai_generated: 'похоже на ИИ' } },
    brand_visible: { label: 'Видно лого или название', type: 'bool' },
    carousel_story: { label: 'Сюжет карусели', carouselOnly: true, values: ['catalog', 'steps', 'reviews', 'before_after'], names: { catalog: 'каталог товаров', steps: 'шаги / история', reviews: 'отзывы', before_after: 'до-после' } },
    // Video-only fields: labeled from the storyboard of a video's frames (fetch_creatives.py --videos).
    hook_type: { label: 'Хук первых секунд', videoOnly: true, values: ['talking_person', 'result_first', 'text_hook', 'process', 'product', 'place'],
      names: { talking_person: 'человек говорит в камеру', result_first: 'сразу результат', text_hook: 'вопрос / боль текстом', process: 'процесс', product: 'товар', place: 'место / интерьер' } },
    video_format: { label: 'Формат ролика', videoOnly: true, values: ['talking_head', 'ugc_demo', 'slideshow', 'before_after', 'montage', 'animation'],
      names: { talking_head: 'говорящая голова', ugc_demo: 'UGC-демонстрация', slideshow: 'слайд-шоу из фото', before_after: 'до-после', montage: 'монтаж сцен', animation: 'анимация / графика' } },
    subtitles: { label: 'Субтитры или текст поверх', videoOnly: true, type: 'bool' },
    end_cta: { label: 'Призыв или контакты в финале', videoOnly: true, type: 'bool' }
  };
  // A manifest item whose video was cut into frames.
  const hasFrames = item => !!(item && item.video && item.video.status === 'ok');

  // Which moments of a video to look at: the hook (0-3 s), the quarters for
  // the story, the last frame for the call to action; never past the end,
  // never two frames closer than 0.4 s. duration in seconds.
  function videoFramePlan(duration) {
    const d = Number(duration);
    if (!Number.isFinite(d) || d <= 0) return [{ t: 0, label: '0s' }];
    const cand = [[0, '0s'], [1, '1s'], [2, '2s'], [3, '3s'], [d * 0.25, '25%'], [d * 0.5, '50%'], [d * 0.75, '75%']].filter(([t]) => t < d - 0.3);
    const out = [];
    for (const [t, label] of cand.sort((a, b) => a[0] - b[0])) if (!out.length || t - out[out.length - 1].t >= 0.4) out.push({ t: Math.round(t * 100) / 100, label });
    if (!out.length) return [{ t: 0, label: '0s' }]; // a clip shorter than a third of a second
    const end = Math.round((d - 0.25) * 100) / 100;
    while (out.length > 1 && end - out[out.length - 1].t < 0.4) out.pop();
    if (end - out[out.length - 1].t >= 0.4) out.push({ t: end, label: 'end' });
    return out;
  }

  // Orientation as Meta's placements name it.
  function aspectOf(w, h) {
    if (!(w > 0 && h > 0)) return '';
    const r = w / h;
    return r < 0.7 ? '9:16' : r < 0.9 ? '4:5' : r <= 1.1 ? '1:1' : '16:9';
  }
  const durationBucket = d => (d < 15 ? '<15' : d < 30 ? '15-30' : d <= 60 ? '30-60' : '>60');
  const BOOL_NAMES = { true: 'да', false: 'нет' };
  const NOTES_MAX = 200;

  // What to download for an ad: all cards of a carousel (DCO cards are
  // alternatives, a viewer sees one), the preview frame of a video, else the picture.
  function creativeMedia(r) {
    const img = httpOnly(r.image_url || '');
    const cards = String(r.card_image_urls || '').split(' | ').map(httpOnly).filter(Boolean).slice(0, MAX_CARDS);
    if (/carousel/i.test(r.fmt || '') && cards.length >= 2) return { kind: 'carousel', urls: cards };
    if (!img) return null;
    const video = httpOnly(r.video_url || '');
    return video ? { kind: 'video_preview', urls: [img], video_url: video } : { kind: 'image', urls: [img] };
  }

  // The CDN signs each link (query string); the path names the file itself.
  const mediaKey = u => { try { const x = new URL(u); return x.hostname + x.pathname; } catch (e) { return u; } };

  // Which creatives to look at when only `limit` can be: running ads only,
  // each picture once; per advertiser its long-running ads first (>= longDays),
  // then the ones with more variants, then the older; advertisers take turns
  // (most ads first), at most perAdvertiser each. rows: already curated.
  function selectCreatives(rows, opts = {}) {
    const limit = opts.limit || 60, perAdvertiser = opts.perAdvertiser || 3, longDays = opts.longDays || 90;
    const now = opts.now || Date.now() / 1000;
    const age = r => Math.round((now - r.start) / 86400);
    const queues = new Map();
    for (const r of rows) {
      if (isStoppedAd(r)) continue;
      const m = creativeMedia(r);
      if (!m) continue;
      if (!queues.has(r.page)) queues.set(r.page, []);
      queues.get(r.page).push({ id: r.id, page: r.page, fmt: r.fmt || '', kind: m.kind, urls: m.urls, ...(m.video_url ? { video_url: m.video_url } : {}), days: age(r), long_running: age(r) >= longDays, variants: +r.variants || 1 });
    }
    const order = [...queues.values()].sort((a, b) => b.length - a.length);
    for (const q of order) q.sort((a, b) => (b.long_running - a.long_running) || (b.variants - a.variants) || (b.days - a.days));
    const out = [], seen = new Set(), taken = new Map(), pos = new Map();
    let moved = true;
    while (out.length < limit && moved) {
      moved = false;
      for (const q of order) {
        if (out.length >= limit) break;
        const page = q[0].page;
        if ((taken.get(page) || 0) >= perAdvertiser) continue;
        let i = pos.get(page) || 0;
        while (i < q.length && seen.has(mediaKey(q[i].urls[0]))) i++;
        pos.set(page, i + 1);
        if (i >= q.length) continue;
        const { variants, ...item } = q[i];
        seen.add(mediaKey(item.urls[0]));
        taken.set(page, (taken.get(page) || 0) + 1);
        out.push(item);
        moved = true;
      }
    }
    return out;
  }

  const labelList = labels => (Array.isArray(labels) ? labels : (labels && Array.isArray(labels.items) ? labels.items : []));

  // Checks creatives.json against the vocabulary and the downloaded pictures
  // (manifest.json). Returns { errors, warnings, findings: [{ id, severity, code, field, message }] }.
  function lintCreatives(labels, manifest) {
    const f = [];
    const add = (id, severity, code, field, message) => f.push({ id, severity, code, field, message });
    const ok = new Map(((manifest && manifest.items) || []).filter(i => i.status === 'ok').map(i => [String(i.id), i]));
    const seen = new Set();
    for (const l of labelList(labels)) {
      const id = String(l && l.id);
      if (seen.has(id)) { add(id, 'error', 'duplicate_id', 'id', 'This creative is labeled twice.'); continue; }
      seen.add(id);
      const item = ok.get(id);
      if (!item) { add(id, 'error', 'unknown_id', 'id', 'No downloaded creative with this id in creatives/manifest.json.'); continue; }
      for (const [field, t] of Object.entries(CREATIVE_TAGS)) {
        const v = l[field];
        const empty = v === undefined || v === null || v === '';
        if (t.carouselOnly) {
          if (item.kind !== 'carousel') { if (!empty) add(id, 'warn', 'carousel_story_not_carousel', field, 'Only carousels have a story; this creative is a ' + item.kind + '.'); }
          else if (empty) add(id, 'warn', 'carousel_story_missing', field, 'A carousel: say what its cards tell.');
          else if (!t.values.includes(v)) add(id, 'error', 'bad_value', field, 'Unknown value "' + v + '"; allowed: ' + t.values.join(', ') + '.');
          continue;
        }
        if (t.videoOnly && !hasFrames(item)) {
          if (!empty) add(id, 'warn', 'video_tag_not_video', field, 'Only a video cut into frames gets this field; this creative has none.');
          continue;
        }
        if (empty || (t.multi && Array.isArray(v) && !v.length)) { add(id, 'error', 'missing_field', field, 'Required field is empty.'); continue; }
        if (t.type === 'bool') { if (typeof v !== 'boolean') add(id, 'error', 'bad_type', field, 'Must be true or false.'); continue; }
        const vals = t.multi ? (Array.isArray(v) ? v : [v]) : [v];
        if (!t.multi && Array.isArray(v)) { add(id, 'error', 'bad_type', field, 'One value, not a list.'); continue; }
        const bad = vals.filter(x => !t.values.includes(x));
        if (bad.length) add(id, 'error', 'bad_value', field, 'Unknown value ' + bad.map(x => '"' + x + '"').join(', ') + '; allowed: ' + t.values.join(', ') + '.');
        if (t.multi && vals.includes('none') && vals.length > 1) add(id, 'error', 'none_mixed', field, '"none" together with other values.');
      }
      if (l.notes !== undefined && typeof l.notes !== 'string') add(id, 'error', 'bad_type', 'notes', 'Notes must be text.');
      else if (String(l.notes || '').length > NOTES_MAX) add(id, 'warn', 'notes_long', 'notes', 'Notes are ' + l.notes.length + ' characters; keep them under ' + NOTES_MAX + '.');
      const known = new Set(['id', 'notes', ...Object.keys(CREATIVE_TAGS)]);
      const extra = Object.keys(l).filter(k => !known.has(k));
      if (extra.length) add(id, 'warn', 'unknown_field', extra.join(', '), 'Fields outside the vocabulary are ignored.');
    }
    for (const id of ok.keys()) if (!seen.has(id)) add(id, 'info', 'unlabeled', 'id', 'Downloaded but not labeled yet.');
    const rank = { error: 0, warn: 1, info: 2 };
    f.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { errors: f.filter(x => x.severity === 'error').length, warnings: f.filter(x => x.severity === 'warn').length, findings: f };
  }

  // The "what is on the creatives" block: for every tag value, how many
  // labeled creatives and advertisers have it, how concentrated it is
  // (strength, as for hooks: counted per advertiser page) and how many of them
  // are long-running; plus the gallery items and warnings. rows: curated ads
  // (pictures of advertisers dropped later are left out). labels: creatives.json
  // or null; manifest: creatives/manifest.json. opts: { now, longDays }.
  function creativesSummary(rows, labels, manifest, opts = {}) {
    const longDays = opts.longDays || 90, now = opts.now || Date.now() / 1000;
    const byId = new Map(rows.map(r => [String(r.id), r]));
    const all = (manifest && manifest.items) || [];
    const items = all.filter(i => i.status === 'ok' && byId.has(String(i.id)));
    const lab = new Map(labelList(labels).map(l => [String(l.id), l]));
    const share = (n, d) => (d ? Math.round(100 * n / d) / 100 : 0);
    const gallery = items.map(i => {
      const r = byId.get(String(i.id));
      const days = Math.round((now - r.start) / 86400);
      const l = lab.get(String(i.id));
      const tags = l ? Object.fromEntries(Object.keys(CREATIVE_TAGS).filter(k => l[k] !== undefined && l[k] !== null).map(k => [k, l[k]])) : null;
      // The same tags in words, for tables: { field: 'name, name' }.
      const tag_names = tags ? Object.fromEntries(Object.entries(tags).map(([k, val]) => [k, [].concat(val).map(x => (typeof x === 'boolean' ? BOOL_NAMES[x] : CREATIVE_TAGS[k].names[x] || String(x))).join(', ')])) : null;
      // A video cut into frames shows its storyboard instead of the preview frame.
      const vd = hasFrames(i) ? i.video : null;
      const video = vd ? { duration: vd.duration, width: vd.width, height: vd.height, aspect: vd.aspect || aspectOf(vd.width, vd.height), frames: vd.frames || [], storyboard: vd.storyboard || '', storyboard_thumb: vd.storyboard_thumb || '' } : null;
      const first = (a, b) => [a, ...(b || [])].filter(Boolean);
      return { id: String(i.id), page: r.page, kind: i.kind, fmt: r.fmt || '', days, long_running: !isStoppedAd(r) && days >= longDays,
        url: 'https://www.facebook.com/ads/library/?id=' + r.id, files: video ? first(video.storyboard, i.files) : i.files || [], thumbs: video ? first(video.storyboard_thumb, i.thumbs) : i.thumbs || [],
        video, tags, tag_names, notes: l && typeof l.notes === 'string' ? l.notes : '' };
    });
    const done = gallery.filter(g => g.tags);
    const fields = Object.entries(CREATIVE_TAGS).map(([field, t]) => {
      const pool = t.carouselOnly ? done.filter(g => g.kind === 'carousel') : t.videoOnly ? done.filter(g => g.video) : done;
      const values = (t.type === 'bool' ? [true, false] : t.values).map(value => {
        const has = pool.filter(g => (t.multi ? [].concat(g.tags[field] || []) : [g.tags[field]]).includes(value));
        const by = {};
        has.forEach(g => { by[g.page] = (by[g.page] || 0) + 1; });
        const ents = Object.entries(by).sort((a, b) => b[1] - a[1]);
        const top_share = has.length ? share(ents[0][1], has.length) : 0;
        return { value, name: t.type === 'bool' ? BOOL_NAMES[value] : t.names[value], creatives: has.length, share: share(has.length, pool.length), advertisers: ents.length,
          // "none" / "no" is the absence of a device, not a pattern: no strength for it
          top_advertiser: ents.length ? ents[0][0] : null, top_share, strength: value === 'none' || value === false ? null : strengthOf(ents.length, top_share), long_running: has.filter(g => g.long_running).length };
      }).filter(v => v.creatives > 0).sort((a, b) => b.creatives - a.creatives);
      return { field, label: t.label, labeled: pool.length, values };
    }).filter(f => f.values.length);
    const count = s => all.filter(i => i.status === s).length;
    const advertisers = new Set(done.map(g => g.page)).size;
    const failed = all.filter(i => ['expired', 'blocked', 'too_big', 'error'].includes(i.status)).length;
    const warnings = [];
    if (count('expired')) warnings.push({ code: 'creatives_expired', severity: 'warn', message: 'Не скачались ' + count('expired') + ' из ' + all.length + ' креативов: ссылки Meta на картинки уже не действуют. Собери срез заново и сразу запусти fetch_creatives.py.' });
    if (items.length > done.length) warnings.push({ code: 'creatives_unlabeled', severity: 'info', message: 'Скачано ' + items.length + ' креативов, размечено ' + done.length + ': блок «Что на креативах» считается только по размеченным.' });
    if (done.length && advertisers < SMALL_SAMPLE) warnings.push({ code: 'creatives_small', severity: 'warn', message: 'Креативы размечены у ' + advertisers + ' рекламодателей: частоты по картинкам это гипотезы, а не тренд ниши.' });
    // Videos cut into frames: how long and which orientation (from the files, not from labels).
    const cut = gallery.filter(g => g.video);
    const tallyBy = f => cut.reduce((m, g) => { const k = f(g); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const videoFailed = items.filter(i => i.video && i.video.status !== 'ok').length;
    const videos = { analysed: cut.length, failed: videoFailed, durations: tallyBy(g => (Number.isFinite(g.video.duration) ? durationBucket(g.video.duration) : '')), aspects: tallyBy(g => g.video.aspect) };
    if (videoFailed) warnings.push({ code: 'videos_failed', severity: 'info', message: 'Не удалось разобрать на кадры ' + videoFailed + ' видео (ссылка протухла, файл слишком большой или не декодируется): у них остался только кадр-превью.' });
    const tag_fields = Object.entries(CREATIVE_TAGS).map(([field, t]) => ({ field, label: t.label }));
    return { selected: all.length, downloaded: items.length, expired: count('expired'), duplicates: count('duplicate'), failed, labeled: done.length, advertisers, tag_fields, fields, videos, items: gallery, warnings };
  }

  // ---- Hypothesis text checks ----------------------------------------------
  // Heuristics for commonly enforced ad-policy problems and for claims that the
  // client has not confirmed. They flag, they do not certify: Meta reviews
  // ads itself and its policies change, so the final check is Meta's
  // Advertising Standards. Severity: error = fix before use, warn = review,
  // info = good to know.
  const HYP_REQUIRED = ['name', 'angle', 'evidence', 'headline', 'primary_text', 'cta', 'destination', 'test', 'metric', 'risk'];
  const YOU = /\b(you|your|you're)\b|(^|[^а-яіїєґ])(вы|ваш\S*|ты|твой|твоя|у вас|у тебя|ви)(?![а-яіїєґ])/i;
  const ATTR = /\b(overweight|obese|depress\w*|anxi\w*|diabet\w*|bald(?:ing)?|in debt|lonely|infertil\w*|impoten\w*)\b|(лишн\S+ вес|ожирен\S*|депресс\S*|тревожн\S*|диабет\S*|лыс\S*|облыс\S*|долг\S*|одинок\S*|бесплод\S*)/i;
  const TEXT_RULES = [
    { code: 'health_claim', severity: 'warn', re: /\b(cures?|cured|heals?|treats?|miracle|permanent(?:ly)?|100%\s*(?:effective|guaranteed)|guaranteed results?|clinically proven|doctor.recommended)\b|(вылеч\S*|излеч\S*|лечит|чудо\S*|навсегда|назавжди|гарантирован\S* результат|клинически доказан\S*)/i, message: 'Health/result claim: needs substantiation, and Meta restricts absolute or medical claims.' },
    { code: 'before_after', severity: 'warn', re: /before\s*(?:and|&|\/|-)\s*after|до\s*(?:и|\/|-)\s*после|до\s*(?:і|\/|-)\s*після/i, message: 'Before/after wording: restricted, especially for health, weight and body.' },
    { code: 'superlative', severity: 'warn', re: /(#\s?1\b|\bno\.?\s?1\b|\bbest\b|world'?s (?:best|first)|№\s?1|лучш\S+|найкращ\S+)/i, message: 'Superlative ("#1", "best"): needs proof you can show.' },
    { code: 'meta_brand', severity: 'info', re: /\b(facebook|instagram|meta)\b/i, message: 'Mentions a Meta brand name; avoid implying endorsement.' }
  ];
  const nums = (t, re) => [...t.matchAll(re)].map(m => +String(m[1] || m[2]).replace(/,/g, ''));

  // hyps: array of hypothesis objects (hypotheses.json). opts: { client,
  // extraHooks, baseHooks }. Returns [{ name, errors, warnings, findings:
  // [{severity, code, field, message}], visible_text }].
  function lintHypotheses(hyps, opts = {}) {
    const client = opts.client || null;
    const hooks = hookPatterns(opts);
    const SKIP_CLAIM_CHECK = new Set(['персонализация', 'TikTok/вирусность']); // regexes too broad to read as a claim
    return hyps.map((h, i) => {
      const f = [];
      const add = (severity, code, field, message) => f.push({ severity, code, field, message });
      const name = h.name || 'hypothesis #' + (i + 1);
      for (const k of HYP_REQUIRED) {
        const v = h[k];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) add('error', 'missing_field', k, 'Required field is empty.');
      }
      const head = String(h.headline || ''), body = String(h.primary_text || '');
      const all = head + ' ' + body;
      if (head.length > 40) add('warn', 'headline_long', 'headline', 'Headline is ' + head.length + ' characters; about 40 is recommended, longer gets cut off.');
      if (body.length > 125) add('info', 'primary_text_truncated', 'primary_text', 'Only about the first 125 characters show before "See more": the hook and the offer should be inside them.');
      const ph = all.match(/\[[^\]]+\]/g);
      if (ph) add(client ? 'warn' : 'info', 'placeholder', 'headline/primary_text', 'Unfilled placeholders: ' + [...new Set(ph)].join(', ') + (client ? ' (client.json is present: fill them or ask).' : '.'));
      const letters = head.replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ]/g, '');
      if (letters.length >= 8 && head.replace(/[^A-ZА-ЯІЇЄҐ]/g, '').length / letters.length > 0.6) add('warn', 'all_caps', 'headline', 'Headline is mostly capital letters.');
      if ((all.match(/!/g) || []).length > 3) add('warn', 'exclamation', 'primary_text', 'More than 3 exclamation marks.');
      if (YOU.test(all) && ATTR.test(all)) add('error', 'personal_attributes', 'headline/primary_text', 'Addresses the viewer with a personal attribute (weight, health, debt, ...): ads must not imply you know it.');
      for (const r of TEXT_RULES) if (r.re.test(all)) add(r.severity, r.code, 'headline/primary_text', r.message);
      if (/(today only|last day|ends tonight|only \d+ left|hurry|только сегодня|последний день|осталось \d+|лише сьогодні|залишилось \d+)/i.test(all) && !(client && (client.real_deadline === true || client.real_stock_limit === true))) {
        add('warn', 'urgency', 'headline/primary_text', 'Urgency wording without a confirmed real deadline or stock limit (client.json real_deadline / real_stock_limit).');
      }
      if (client) {
        const t = all.toLowerCase();
        if (/guarantee|money.?back|refund|return|гарант|возврат|повернен/i.test(t)) {
          for (const d of nums(t, /(\d+)[\s-]*(?:day|дн|дней|дня|днів)/gi)) if (has(client.guarantee_days) && d > client.guarantee_days) add('error', 'guarantee_days_overstated', 'primary_text', 'States a ' + d + '-day guarantee, client.json confirms ' + client.guarantee_days + '.');
        }
        for (const r of nums(t, /(\d(?:\.\d)?)\s*(?:★|⭐|stars?\b|\/5|out of 5)|rated\s*(\d(?:\.\d)?)/gi)) if (has(client.reviews_rating) && r > client.reviews_rating + 0.05) add('error', 'rating_overstated', 'headline/primary_text', 'States a rating of ' + r + ', client.json confirms ' + client.reviews_rating + '.');
        for (const n of nums(t, /([\d,]{2,})\+?\s*(?:reviews|customers|happy customers|buyers|отзыв\S*|покупател\S*|клиент\S*)/gi)) if (has(client.reviews_count) && n > client.reviews_count) add('error', 'reviews_overstated', 'headline/primary_text', 'States ' + n + ' reviews/customers, client.json confirms ' + client.reviews_count + '.');
        for (const d of nums(t, /(\d{1,2})\s*%\s*off/gi).concat(nums(t, /(?:скидк\S*|знижк\S*)\s*(?:до\s*)?(\d{1,2})\s*%/gi))) if (has(client.max_discount_pct) && d > client.max_discount_pct) add('error', 'discount_overstated', 'headline/primary_text', 'Offers ' + d + '% off, client.json allows at most ' + client.max_discount_pct + '%.');
        const allowed = [client.price, client.free_shipping_over, ...(client.bundles || []).flatMap(b => nums(String(b), /\$\s?(\d+(?:\.\d+)?)/g))].filter(has);
        for (const price of nums(all, /\$\s?(\d+(?:\.\d+)?)/g)) if (allowed.length && !allowed.some(a => Math.abs(a - price) < 0.005)) add('warn', 'price_not_in_brief', 'headline/primary_text', 'Price $' + price + ' is not among the prices in client.json.');
        const labels = Object.keys(hooks).filter(k => !SKIP_CLAIM_CHECK.has(k) && CLIENT_RULES[k] && hooks[k].test(t));
        for (const fit of checkClientFit(client, labels)) {
          if (fit.status === 'blocked') add('error', 'claims_blocked_hook', 'headline/primary_text', 'Text claims "' + fit.hook + '", which the client said is not true.');
          else if (fit.status === 'unknown') add('warn', 'claims_unconfirmed_hook', 'headline/primary_text', 'Text claims "' + fit.hook + '" but client.json does not confirm it (' + fit.missing.join(', ') + ').');
        }
      }
      const rank = { error: 0, warn: 1, info: 2 };
      f.sort((a, b) => rank[a.severity] - rank[b.severity]);
      return { name, errors: f.filter(x => x.severity === 'error').length, warnings: f.filter(x => x.severity === 'warn').length, findings: f, visible_text: body.slice(0, 125) };
    });
  }

  // ---- Prioritization and test plan ----------------------------------------
  // score = evidence * readiness / effort.
  //  evidence: hypothesis.evidence_strength (strong 3, moderate 2,
  //    structural 2, weak or missing 1);
  //  readiness: 1 if the client confirmed the hypothesis' hook (or it needs no
  //    client fact), 0.5 if not asked yet, 0 if the client said it is not
  //    true; halved again while the text has lint errors;
  //  effort: hypothesis.effort 1 (text only), 2 (new creative), 3 (new page or
  //    asset); default 2.
  // opts: { client, lint: { [name]: { errors } } }.
  function prioritizeHypotheses(hyps, opts = {}) {
    const EV = { strong: 3, moderate: 2, structural: 2, weak: 1 };
    const READY = { ready: 1, 'n/a': 1, unknown: 0.5, blocked: 0 };
    const items = hyps.map((h, i) => {
      const fit = h.hook ? checkClientFit(opts.client || null, [h.hook])[0].status : 'n/a';
      const evidence = EV[h.evidence_strength] || 1;
      const effort = [1, 2, 3].includes(+h.effort) ? +h.effort : 2;
      const lintErrors = ((opts.lint || {})[h.name] || {}).errors || 0;
      const blockers = [];
      if (fit === 'blocked') blockers.push('client said this claim is not true');
      if (fit === 'unknown') blockers.push('client fact not confirmed yet');
      if (lintErrors) blockers.push(lintErrors + ' text error(s) to fix');
      return {
        name: h.name, hook: h.hook || null, variable_type: h.variable_type || 'creative', evidence_strength: h.evidence_strength || 'weak',
        evidence, effort, fit, lint_errors: lintErrors,
        score: Math.round(100 * evidence * READY[fit] * (lintErrors ? 0.5 : 1) / effort) / 100,
        launchable: blockers.length === 0, blockers, _i: i
      };
    });
    return items.sort((a, b) => (b.score - a.score) || (b.evidence - a.evidence) || (a._i - b._i))
      .map(({ _i, ...it }, rank) => ({ rank: rank + 1, ...it }));
  }

  // Rounds of at most opts.maxParallel (default 2) tests with different
  // variable types (creative / offer / landing / audience), so simultaneous
  // tests don't confound each other. Tests the client blocked are excluded.
  // Budget per test = variants (2) x events per variant x client.target_cpa;
  // events default to 50 (Meta's usual learning-phase guideline of about 50
  // optimization events per ad set per week; a rule of thumb, verify it) and
  // is null when the target CPA is unknown.
  function planTests(ranked, opts = {}) {
    const client = opts.client || {};
    const events = opts.events || 50, variants = 2, maxParallel = opts.maxParallel || 2;
    const cpa = has(client.target_cpa) ? +client.target_cpa : null;
    const perTest = cpa === null ? null : Math.round(variants * events * cpa);
    const queue = ranked.filter(r => r.score > 0);
    const excluded = ranked.filter(r => r.score === 0).map(r => ({ name: r.name, reason: r.blockers.join('; ') || 'score 0' }));
    const rounds = [];
    while (queue.length) {
      const round = [];
      for (let i = 0; i < queue.length && round.length < maxParallel;) {
        if (round.every(t => t.variable_type !== queue[i].variable_type)) round.push(queue.splice(i, 1)[0]); else i++;
      }
      rounds.push({ round: rounds.length + 1, tests: round.map(t => ({ name: t.name, variable_type: t.variable_type, launchable: t.launchable, blockers: t.blockers })), budget: perTest === null ? null : perTest * round.length });
    }
    return { rounds, excluded, assumptions: { variants_per_test: variants, events_per_variant: events, target_cpa: cpa, per_test_budget: perTest, min_days_per_round: 7, max_parallel_tests: maxParallel } };
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
    // Stopped ads (only present when the run asked for inactive ads) are reported in
    // their own block: "days since it started" is meaningless for them, so every
    // age statistic below is about the ads that still run.
    const liveRows = rows.filter(r => !isStoppedAd(r));
    const stoppedRows = rows.filter(isStoppedAd);
    const cnt = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const pages = {};
    for (const r of rows) {
      const p = pages[r.page] || (pages[r.page] = { page: r.page, page_id: r.page_id, library_url: r.page_id ? 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&view_all_page_id=' + r.page_id : '', ads: 0, oldest_days: 0, newest_days: Infinity, doors: new Set(), sites: new Set(), links: {}, cats: r.cats, page_likes: null, page_url: '' });
      if (Number.isFinite(r.page_likes)) p.page_likes = Math.max(p.page_likes || 0, r.page_likes);
      if (!p.page_url && r.page_url) p.page_url = r.page_url;
      p.ads++;
      if (!isStoppedAd(r)) {
        p.oldest_days = Math.max(p.oldest_days, age(r));
        p.newest_days = Math.min(p.newest_days, age(r));
      }
      p.doors.add(classifyDoor(r));
      const d = domainOf(r.link);
      if (d && !/instagram|facebook|fb\.com|fb\.me|m\.me|wa\.me|t\.me/.test(d) && !MARKETPLACES.test(d) && !APP_STORES.test(d) && !SHORT_LINKS.test(d) && !AFFILIATE_LINKS.test(d)) {
        p.sites.add(d);
        const u = unwrapUrl(r.link);
        if (u) { const k = u.origin + u.pathname; p.links[k] = (p.links[k] || 0) + 1; }
      }
      if (strongLocal(r)) p.local = true;
      if (weakLocal(r)) p.weak = (p.weak || 0) + 1;
    }
    const pageList = Object.values(pages)
      .map(({ weak, links, ...p }) => ({ ...p, landing: Object.entries(links).sort((a, b) => b[1] - a[1])[0]?.[0] || '', local: !!p.local || (weak || 0) >= p.ads / 2, platform: [...p.doors].every(d => PLATFORM_DOORS.includes(d)), doors: [...p.doors].join(', '), sites: [...p.sites].join(', ') }))
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
    for (const [k, p] of Object.entries(hookPatterns(opts))) freq[k] = rows.filter(r => p.test(text(r))).length;
    // opts.noise: words from a preset. Pages whose ads mention them are
    // suggested for exclude(); the caller decides, nothing is dropped here.
    const noiseWords = (opts.noise || []).map(w => w.toLowerCase());
    const noiseCount = {};
    if (noiseWords.length) for (const r of rows) if (noiseWords.some(w => text(r).includes(w))) noiseCount[r.page] = (noiseCount[r.page] || 0) + 1;
    const noise_candidates = Object.entries(noiseCount).map(([page, ads]) => ({ page, ads_matching: ads, ads_total: pages[page].ads })).sort((a, b) => b.ads_matching - a.ads_matching);
    const buckets = { '<7': 0, '7-30': 0, '30-90': 0, '90-365': 0, '>365': 0 };
    liveRows.forEach(r => { const a = age(r); buckets[a < 7 ? '<7' : a < 30 ? '7-30' : a < 90 ? '30-90' : a < 365 ? '90-365' : '>365']++; });
    const snip = r => ((r.title ? r.title + ' | ' : '') + (r.body || '')).replace(/\s+/g, ' ').slice(0, 160);
    // Max 2 longrun entries per advertiser, so one advertiser running many
    // copies of the same creative can't fill the whole list.
    const perPage = {};
    // Ranked by creative variants first (many variants of one ad = active
    // testing/scaling), then by age.
    const longrun = liveRows.filter(r => age(r) >= longDays && !outOfNiche.has(r.page)).sort((a, b) => (b.variants - a.variants) || (a.start - b.start))
      .filter(r => (perPage[r.page] = (perPage[r.page] || 0) + 1) <= 2).slice(0, 25)
      .map(r => ({ page: r.page, days: age(r), fmt: r.fmt, variants: r.variants, door: classifyDoor(r), id: r.id, url: 'https://www.facebook.com/ads/library/?id=' + r.id, text: snip(r) }));
    // One sample per advertiser: the oldest ad, i.e. the most battle-tested one.
    const seen = new Set();
    const samples = liveRows.filter(r => !outOfNiche.has(r.page)).sort((a, b) => a.start - b.start)
      .filter(r => !seen.has(r.page) && seen.add(r.page)).slice(0, 35).map(r => ({ page: r.page, text: snip(r) }));
    // Ads that stopped: how long they ran (end - start), the lower median, how many
    // died within two weeks (a test that did not work) and the longest runs.
    const runDays = r => Math.max(0, Math.round(((r.end || now) - r.start) / 86400));
    const runs = stoppedRows.map(runDays);
    const perStop = {};
    const stopped = {
      ads: stoppedRows.length,
      advertisers: new Set(stoppedRows.map(r => r.page)).size,
      median_run_days: median(runs),
      short_lived: runs.filter(d => d < 14).length,
      top: stoppedRows.filter(r => !outOfNiche.has(r.page)).sort((a, b) => runDays(b) - runDays(a))
        .filter(r => (perStop[r.page] = (perStop[r.page] || 0) + 1) <= 2).slice(0, 15)
        .map(r => ({ page: r.page, run_days: runDays(r), fmt: r.fmt, variants: r.variants, door: classifyDoor(r), id: r.id, url: 'https://www.facebook.com/ads/library/?id=' + r.id, text: snip(r) }))
    };
    // Prices mentioned in ad text, in opts.currency (UAH by default, USD for
    // US presets); "X instead of Y" / "was X now Y" pairs and "N% off"
    // mentions give the typical discount.
    const currency = String(opts.currency || 'UAH').toUpperCase();
    const amounts = [];
    const discounts = [];
    const pctOff = [];
    let adsWithPrice = 0;
    for (const r of rows) {
      const h = priceHits(text(r), currency);
      if (h.amounts.length) { adsWithPrice++; amounts.push(...h.amounts); }
      discounts.push(...h.discounts);
      pctOff.push(...h.pctOff);
    }
    const med = median;
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
      c.pages.add(r.page); c.ads++; if (!isStoppedAd(r)) c.oldest_days = Math.max(c.oldest_days, age(r));
    }
    const creative_clusters = Object.values(clusters).filter(c => c.pages.size >= 2)
      .map(c => ({ ...c, pages: [...c.pages] })).sort((a, b) => b.pages.length - a.pages.length || b.oldest_days - a.oldest_days).slice(0, 15);
    // Different pages sending traffic to the same own site: one store, several pages.
    const bySite = {};
    for (const p of pageList) for (const s of p.sites.split(', ').filter(Boolean)) (bySite[s] = bySite[s] || []).push(p.page);
    const store_groups = Object.entries(bySite).filter(([, pgs]) => pgs.length >= 2).map(([site, pgs]) => ({ site, pages: pgs })).sort((a, b) => b.pages.length - a.pages.length).slice(0, 15);
    // Inputs for the "ready-made ad hypotheses" report section: what the niche
    // under-uses, and what long-running ads have more often than the rest.
    // Evidence only; writing the hypotheses is Claude's job (see SKILL.md).
    const share = (n, d) => (d ? Math.round(100 * n / d) / 100 : 0);
    const hp = hookPatterns(opts);
    const longRows = liveRows.filter(r => age(r) >= longDays && !outOfNiche.has(r.page));
    const restRows = liveRows.filter(r => !(age(r) >= longDays && !outOfNiche.has(r.page)));
    const tally = (rs, f) => rs.reduce((m, r) => (m[f(r)] = (m[f(r)] || 0) + 1, m), {});
    const top = (rs, f, n) => Object.entries(tally(rs, f)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, share: share(v, rs.length) }));
    const enough = longRows.length >= 5;
    // A hook seen mostly at one advertiser is that advertiser's habit, not a
    // niche trend, and pages sharing a site are one advertiser. So evidence is
    // counted per advertiser (pages merged through store_groups).
    const parent = {};
    const find = x => { if (parent[x] === undefined) parent[x] = x; return parent[x] === x ? x : (parent[x] = find(parent[x])); };
    for (const pgs of Object.values(bySite)) if (pgs.length >= 2) for (const q of pgs.slice(1)) parent[find(q)] = find(pgs[0]);
    const kwText = [...new Set(rows.flatMap(r => r.kws || []))].map(k => k.toLowerCase());
    const evidence = (re, rs) => {
      const m = rs.filter(r => re.test(text(r)));
      const byE = {};
      m.forEach(r => { const e = find(r.page); byE[e] = (byE[e] || 0) + 1; });
      const ents = Object.entries(byE).sort((x, y) => y[1] - x[1]);
      const seenE = new Set();
      const examples = [...m].sort((x, y) => (y.variants - x.variants) || (x.start - y.start))
        .filter(r => !seenE.has(find(r.page)) && seenE.add(find(r.page))).slice(0, 3)
        .map(r => ({ page: r.page, url: 'https://www.facebook.com/ads/library/?id=' + r.id, text: snip(r) }));
      const advertisers = ents.length, top_share = m.length ? share(ents[0][1], m.length) : 0;
      const strength = strengthOf(advertisers, top_share);
      return { ads: m.length, advertisers, top_advertiser: ents.length ? ents[0][0] : null, top_share, strength, circular: kwText.some(k => re.test(k)), examples };
    };
    const rank = { strong: 0, moderate: 1, weak: 2 };
    const hypothesis_inputs = {
      ads_analyzed: rows.length,
      long_running_ads: longRows.length,
      enough_long_ads: enough,
      underused_hooks: Object.entries(freq).map(([hook, n]) => ({ hook, ads: n, share: share(n, rows.length), advertisers: evidence(hp[hook], rows).advertisers, circular: kwText.some(k => hp[hook].test(k)) })).filter(h => h.share <= 0.05).sort((x, y) => x.share - y.share).slice(0, 8),
      winner_hooks: !enough ? [] : Object.entries(hp).map(([hook, re]) => {
        const l = longRows.filter(r => re.test(text(r))).length, o = restRows.filter(r => re.test(text(r))).length;
        const ls = share(l, longRows.length), os = share(o, restRows.length);
        return { hook, long_ads: l, long_share: ls, other_share: os, lift: os ? Math.round(10 * ls / os) / 10 : null, ...evidence(hp[hook], longRows) };
      }).filter(h => h.long_ads >= 3 && (h.lift === null || h.lift >= 1.3)).sort((x, y) => (rank[x.strength] - rank[y.strength]) || (y.long_share - x.long_share)).slice(0, 6),
      winner_formats: enough ? top(longRows, r => r.fmt || '?', 3) : [],
      winner_ctas: enough ? top(longRows, r => r.cta || '(нет)', 3) : [],
      winner_doors: enough ? top(longRows, r => classifyDoor(r), 3) : [],
      price_anchors: { currency, median_price: prices.median, median_pct_off: prices.median_pct_off, median_discount_pct: prices.median_discount_pct }
    };
    return {
      ads: rows.length,
      advertisers: pageList.length,
      single_ad_advertisers: pageList.filter(p => p.ads === 1).length,
      doors: cnt(rows.map(classifyDoor)),
      ctas: cnt(rows.map(r => r.cta || '(нет)')),
      cta_types: cnt(rows.map(r => r.cta_type).filter(Boolean)),
      ai_made_ads: rows.filter(r => r.ai_made === true).length,
      platforms: cnt(rows.flatMap(r => (r.platforms || '').split('|').filter(Boolean))),
      formats: cnt(rows.map(r => r.fmt || '?')),
      age_buckets: buckets,
      hook_freq: freq,
      hypothesis_inputs,
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
      status_counts: { active: liveRows.length, stopped: stoppedRows.length },
      stopped,
      samples
    };
  }

  // Serializes rows to CSV (quoted, internal quotes doubled, whitespace
  // collapsed so multi-line ad bodies stay on one CSV line).
  function toCsv(rows) {
    const cols = ['id', 'page', 'start', 'active', 'fmt', 'variants', 'cta', 'link', 'platforms', 'kws', 'title', 'body', 'page_id', 'page_likes', 'caption', 'cta_type', 'ai_made', 'page_url', 'end', 'image_url', 'video_url', 'card_image_urls'];
    const esc = v => {
      let s = String(Array.isArray(v) ? v.join('; ') : (v ?? '')).replace(/\s+/g, ' ');
      // Ad text/page names/CTAs are untrusted third-party input. A value
      // starting with = + - @ is read as a formula by Excel/Sheets when the
      // CSV is opened — prefix it with a quote so it's treated as text.
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = rows.map(r => cols.map(c => esc(c === 'start' ? new Date(r.start * 1000).toISOString().slice(0, 10) : c === 'end' ? (isStoppedAd(r) && r.end ? new Date(r.end * 1000).toISOString().slice(0, 10) : '') : r[c])).join(','));
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
      // columns added later: files from older versions simply lack them
      o.page_likes = o.page_likes === undefined || o.page_likes === '' ? null : +o.page_likes;
      o.ai_made = o.ai_made === 'true' ? true : o.ai_made === 'false' ? false : null;
      o.end = o.end ? Date.parse(o.end + 'T00:00:00Z') / 1000 : null; // only stopped ads carry a stop date
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
    // Stopped ads (an inactive/all run) are not part of the "running now" feed that
    // the comparison is about.
    prev = prev.filter(r => !isStoppedAd(r));
    curr = curr.filter(r => !isStoppedAd(r));
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

    // Inputs for hypotheses from dynamics (SKILL.md): which hooks the failed
    // young tests had more often than the survivors, which hooks the ads that
    // gained creative variants have, what new advertisers bring, and how the
    // format mix moved. Same caution as the report: counted per advertiser,
    // with a strength label, and failures only from confident stops.
    const round2 = x => Math.round(100 * x) / 100;
    const shareOf = (n, d) => (d ? round2(n / d) : 0);
    const hooksHere = hookPatterns(opts.hookOpts || {});
    const txt = r => ((r.title || '') + ' ' + (r.body || '')).toLowerCase();
    const spread = rs => {
      const by = {};
      rs.forEach(r => { by[r.page] = (by[r.page] || 0) + 1; });
      const e = Object.entries(by).sort((a, b) => b[1] - a[1]);
      const top_share = rs.length ? shareOf(e[0][1], rs.length) : 0;
      const advertisers = e.length;
      return { advertisers, top_advertiser: e.length ? e[0][0] : null, top_share, strength: strengthOf(advertisers, top_share) };
    };
    const goneYoung = young.filter(r => !C.has(r.id));
    const keptYoung = young.filter(r => C.has(r.id));
    const enoughFailures = young.length >= 20 && goneYoung.length >= 5;
    const growers = survivors.filter(r => r.variants > P.get(r.id).variants);
    const newPageSet = new Set(Object.keys(pc).filter(p => !(p in pp)));
    const entrantRows = curr.filter(r => newPageSet.has(r.page));
    const mixOf = rs => rs.reduce((m, r) => { const k = r.fmt || '?'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const [mp, mc] = [mixOf(prev), mixOf(curr)];
    const dynamics = {
      failed_hooks_enough_data: enoughFailures,
      failed_hooks: !enoughFailures ? [] : Object.entries(hooksHere).map(([hook, re]) => {
        const g = goneYoung.filter(r => re.test(txt(r))), k = keptYoung.filter(r => re.test(txt(r)));
        const gs = shareOf(g.length, goneYoung.length), ks = shareOf(k.length, keptYoung.length);
        return { hook, gone_ads: g.length, gone_share: gs, kept_share: ks, lift: ks ? Math.round(10 * gs / ks) / 10 : null, ...spread(g) };
      }).filter(h => h.gone_ads >= 3 && (h.lift === null || h.lift >= 1.5)).sort((a, b) => b.gone_share - a.gone_share).slice(0, 6),
      scaling_hooks: Object.entries(hooksHere).map(([hook, re]) => {
        const m = growers.filter(r => re.test(txt(r)));
        return { hook, ads: m.length, ...spread(m) };
      }).filter(h => h.ads >= 2).sort((a, b) => b.ads - a.ads).slice(0, 6),
      scaling_examples: growers.slice().sort((a, b) => (b.variants - P.get(b.id).variants) - (a.variants - P.get(a.id).variants)).slice(0, 5)
        .map(r => ({ page: r.page, url: url(r.id), variants_prev: P.get(r.id).variants, variants_curr: r.variants, text: snip(r) })),
      new_entrants: {
        pages: newPageSet.size,
        top: Object.entries(count(entrantRows)).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, n]) => n >= 2).map(([page, n]) => {
          const rs = entrantRows.filter(r => r.page === page);
          return { page, ads: n, formats: Object.keys(mixOf(rs)), hooks: Object.entries(hooksHere).filter(([, re]) => rs.some(r => re.test(txt(r)))).map(([h]) => h), example: snip(rs[0]) };
        })
      },
      format_shift: [...new Set([...Object.keys(mp), ...Object.keys(mc)])]
        .map(fmt => ({ fmt, prev_share: shareOf(mp[fmt] || 0, prev.length), curr_share: shareOf(mc[fmt] || 0, curr.length) }))
        .filter(f => Math.abs(f.curr_share - f.prev_share) >= 0.05).sort((a, b) => Math.abs(b.curr_share - b.prev_share) - Math.abs(a.curr_share - a.prev_share))
    };
    return {
      interval_days,
      prev_ads: prev.length, curr_ads: curr.length,
      survived: survivors.length,
      new_ads: { count: fresh.length, top: fresh.sort((a, b) => b.variants - a.variants).slice(0, 25).map(r => ({ page: r.page, id: r.id, url: url(r.id), variants: r.variants, text: snip(r) })) },
      stopped: { count: stopped.length, high_confidence: stoppedHigh.length, top: stopped.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) || b.variants - a.variants).slice(0, 25) },
      young_tests: { ads: young.length, gone: youngGone, gone_share: young.length ? Math.round(100 * youngGone / young.length) / 100 : null },
      scaling: survivors.filter(r => r.variants > P.get(r.id).variants).map(r => ({ page: r.page, id: r.id, url: url(r.id), variants_prev: P.get(r.id).variants, variants_curr: r.variants })).sort((a, b) => (b.variants_curr - b.variants_prev) - (a.variants_curr - a.variants_prev)).slice(0, 25),
      pages: { new: newPages.slice(0, 25), gone: gonePages.slice(0, 25), grew: grew.slice(0, 25) },
      dynamics
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
    // rateLimited counts "Rate limit exceeded" replies since the last collect():
    // Meta sends them instead of the next page of results, so the query then
    // holds only its first batch (~30 ads), not everything the Library counts.
    const M = window.__mai = { ads: {}, store: {}, rateLimited: 0 };
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.ad_archive_id && o.snapshot) M.ads[o.ad_archive_id] = o;
      for (const k in o) walk(o[k]);
    };
    const eat = (t) => {
      if (t && t.includes('Rate limit exceeded')) M.rateLimited++;
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
    // Each tag is eaten once: after an in-page search the first page's tags
    // stay in the DOM, and re-reading them tagged old ads with the new query.
    const seenScripts = new Set();
    const scanEmbeddedJson = () => document.querySelectorAll('script[type="application/json"]').forEach(s => {
      if (seenScripts.has(s)) return;
      seenScripts.add(s);
      eat(s.textContent);
    });
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
        if (M.rateLimited >= 2) break; // more scrolling only sends more refused requests
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
      const rateLimited = M.rateLimited > 0;
      M.rateLimited = 0;
      const shown = resultCountOf(document.body.innerText);
      return { kw, captured: n, library_says: shown, total_unique: Object.keys(M.store).length, rate_limited: rateLimited };
    };
    // Restores records collected on earlier pages (scrape.py opens each query
    // by URL, which starts a new page and a new __mai). Queries are merged.
    M.load = (records) => {
      let n = 0;
      for (const [id, rec] of Object.entries(records || {})) {
        const cur = M.store[id];
        M.store[id] = cur ? { ...rec, kws: [...new Set([...(rec.kws || []), ...(cur.kws || [])])] } : rec;
        n++;
      }
      return n + ' records loaded';
    };
    M.exclude = (names) => { let k = 0; for (const [id, r] of Object.entries(M.store)) if (names.includes(r.page)) { delete M.store[id]; k++; } return k + ' removed'; };
    M.buildQueries = buildQueries;
    M.currencyForCountry = currencyForCountry;
    M.parseEuDetails = parseEuDetails;
    M.videoFramePlan = videoFramePlan; // used by fetch_creatives.py's frame extractor page
    M.aspectOf = aspectOf;
    M.pickEuAds = pickEuAds;
    M.isEuCountry = isEuCountry;
    M.siteFacts = siteFacts;
    M.compareAdVsSite = compareAdVsSite;
    M.report = (opts = {}) => buildReport(Object.values(M.store), opts);
    M.csv = () => toCsv(Object.values(M.store));
    return 'installed: ' + Object.keys(M.ads).length + ' ads buffered from first page';
  }

  const installResult = installBrowser();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HOOK_PATTERNS, pick, domainOf, resultCountOf, buildQueries, firstNonEmptyCard, normalizeAd, classifyDoor, buildReport, toCsv, parseCsv, diffSnapshots, siteFacts, compareAdVsSite, checkClientFit, lintHypotheses, prioritizeHypotheses, planTests, applyCuration, queryStats, currencyForCountry, seasonWarnings, snapshotWarnings, suggestQueries, queryLang, isEuCountry, pickEuAds, parseEuDetails, euSummary, strengthOf, CREATIVE_TAGS, creativeMedia, selectCreatives, lintCreatives, creativesSummary, videoFramePlan, aspectOf };
  }

  return installResult;
})();
