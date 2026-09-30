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

  // Prices, "was/instead of" discount pairs and "N% off" mentions in one text
  // (already lowercased). currency: 'UAH' (default) or 'USD'.
  function priceHits(t, currency) {
    const amounts = currency === 'USD'
      ? [...t.matchAll(/\$\s?(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:\.\d{1,2})?)\s?(?:usd|dollars?)\b/g)].map(m => num(m[1] || m[2])).filter(n => n >= 1 && n <= 10000)
      : [...t.matchAll(/(\d[\d\s]{0,6}\d|\d)\s*(?:грн|₴|uah|гривен|гривень)/g)].map(m => num(m[1])).filter(n => n >= 10 && n <= 100000);
    const pairs = currency === 'USD'
      ? [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)\s*\(?\s*(?:instead of|was|reg\.?|regularly)\s*\$?\s?(\d+(?:\.\d+)?)/g)].map(m => [m[1], m[2]])
          .concat([...t.matchAll(/was\s*\$\s?(\d+(?:\.\d+)?)\s*[,—–-]?\s*now\s*(?:only\s*)?\$\s?(\d+(?:\.\d+)?)/g)].map(m => [m[2], m[1]]))
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
    const cnt = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const pages = {};
    for (const r of rows) {
      const p = pages[r.page] || (pages[r.page] = { page: r.page, page_id: r.page_id, library_url: r.page_id ? 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&view_all_page_id=' + r.page_id : '', ads: 0, oldest_days: 0, newest_days: Infinity, doors: new Set(), sites: new Set(), links: {}, cats: r.cats });
      p.ads++;
      p.oldest_days = Math.max(p.oldest_days, age(r));
      p.newest_days = Math.min(p.newest_days, age(r));
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
      c.pages.add(r.page); c.ads++; c.oldest_days = Math.max(c.oldest_days, age(r));
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
    const longRows = rows.filter(r => age(r) >= longDays && !outOfNiche.has(r.page));
    const restRows = rows.filter(r => !(age(r) >= longDays && !outOfNiche.has(r.page)));
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
      // strong: several unrelated advertisers, none dominating; weak: one or two, or one dominates
      const strength = advertisers >= 5 && top_share <= 0.5 ? 'strong' : advertisers >= 3 && top_share <= 0.7 ? 'moderate' : 'weak';
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
    M.siteFacts = siteFacts;
    M.compareAdVsSite = compareAdVsSite;
    M.report = (opts = {}) => buildReport(Object.values(M.store), opts);
    M.csv = () => toCsv(Object.values(M.store));
    return 'installed: ' + Object.keys(M.ads).length + ' ads buffered from first page';
  }

  const installResult = installBrowser();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HOOK_PATTERNS, pick, domainOf, resultCountOf, buildQueries, firstNonEmptyCard, normalizeAd, classifyDoor, buildReport, toCsv, parseCsv, diffSnapshots, siteFacts, compareAdVsSite, checkClientFit, lintHypotheses, prioritizeHypotheses, planTests };
  }

  return installResult;
})();
