(() => {
  // ==========================================================================
  // TikTok ads collector and report logic: one file for the browser (pasted
  // into the page, installs window.__tti) and for Node (require, used by the
  // CLI scripts and the exports). Two sources:
  //   library  — TikTok Ad Library (library.tiktok.com/ads): EU/EEA, GB, CH, TR.
  //              Keyword search, advertiser names, first/last shown dates,
  //              reach bucket; CTA, link, objective and targeting per ad only
  //              in the ad's details.
  //   cc       — TikTok Creative Center Top Ads: many countries (UA, US, ...),
  //              a curated sample of top auction ads with CTR percentile,
  //              likes, budget level, industry and objective; no advertisers.
  // ==========================================================================

  // Hook detection: label -> regex matched against the lowercased ad text.
  // Languages: uk/ru/en plus the Ad Library markets (de, pl, es, fr, it, tr...).
  const HOOK_PATTERNS = {
    'цена в тексте': /\d[\d\s.,]{0,12}\s?(грн|₴|uah|zł|zl\b|pln|€|eur\b|euro|£|gbp|₺|\btl\b|try\b|chf|kč|czk|lei\b|ron\b|kr\b|sek|dkk|nok|ft\b|huf|\$|usd)|(€|£|\$|₺)\s?\d/,
    'процент/скидка': /(\d{1,3}\s*%|знижк|скидк|discount|\bsale\b|rabatt|rabat|zniżk|promocj|descuento|rebaja|remise|soldes|sconto|indirim)/,
    'акция': /(акці|акци|\bpromo|aktion|okazj|\boferta|\boffre|offerta|kampanya)/,
    'первый визит/заказ': /(перш\S* (візит|процедур|замовлен)|перв\S* (визит|процедур|заказ)|first (visit|order)|new (client|customer)s?|erste[nr]? (besuch|bestellung)|pierwsz\S* (wizyt|zamówieni)|primera (visita|compra)|première (visite|commande)|prima (visita|ordine)|ilk (ziyaret|sipariş))/,
    'бесплатно': /(безкоштовн|бесплатн|\bfree\b|kostenlos|gratis|darmow|za darmo|bezpłatn|gratuit|ücretsiz)/,
    'подарок/сертификат': /(подарун|подарок|сертифікат|сертификат|\bgift|geschenk|gutschein|prezent|voucher|regalo|cadeau|hediye)/,
    'гарантия': /(гарант|guarantee|garantie|gwarancj|garantía|garanzia|garanti\b)/,
    'отзывы/рейтинг': /(відгук|отзыв|рейтинг|review|rating|bewertung|opini|reseña|\bavis\b|recension|yorum|★|⭐)/,
    'опыт/годы': /(досвід|опыт|\d{1,3}\s*(років|лет|роки|года|years|jahre|\blat\b|años|\bans\b|anni|yıl))/,
    'дедлайн/ограничение': /(тільки до|только до|залишилось|осталось|limited time|last chance|only until|today only|nur bis|nur heute|tylko do|tylko dziś|ostatni|solo hasta|solo hoy|jusqu'au|solo fino|son gün|sadece bugün)/,
    'рассрочка': /(розстроч|рассроч|installment|ratenzahlung|\braty\b|klarna|cuotas|plusieurs fois|taksit)/,
    'запись/бронь': /(запис|запиш|бронь|бронюй|book now|book (a|your)|termin|zapisz|rezerw|reserva|réserv|prenota|randevu|sign up)/,
    'доставка': /(доставк|delivery|shipping|versand|lieferung|dostaw|envío|livraison|spedizione|kargo)/,
    'обучение/курсы': /(навчан|обучен|\bcourse\b|\bkurs(e|y)?\b|\bcurso\b|\bcours\b|\bcorso\b|eğitim|(?<!в\s)(?<!весь\s)курс(?!\s*(?:\d|процедур|сеанс|лазер|епіляц|эпиляц|лікуван|лечен)))/,
    'до/после': /(до і після|до и после|before.{0,80}after|vorher.{0,80}nachher|przed i po|antes y después|avant.{0,80}après|prima e dopo|öncesi.{0,80}sonrası)/,
    'адрес/район': /(📍|вул\.|вулиц|ул\.|улиц|район|адрес|straße|str\.|\bul\.|calle|\brue\b|\bvia\b|cadde|mahalle)/,
    'POV/сюжетный формат': /(\bpov\b|storytime|grwm|get ready with me|day in my life|unboxing|распаков|розпаков)/,
    'ссылка в профиле': /(link in bio|ссылк\S* в (профил|био|шапк)|посиланн\S* в (профіл|біо|шапц)|link im profil|link w bio)/,
    'хэштеги': /#[\p{L}\d_]{2,}/u
  };

  // Countries the Ad Library serves (GET /api/v1/support-regions, checked 2026-10).
  const LIBRARY_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'TR']);
  const isLibraryCountry = c => LIBRARY_COUNTRIES.has(String(c || '').trim().toUpperCase());
  const sourceForCountry = c => (isLibraryCountry(c) ? 'library' : 'cc');

  // Languages the ads of a country are usually written in (query building).
  const COUNTRY_LANGS = {
    UA: ['uk', 'ru'], KZ: ['ru', 'kk'], PL: ['pl'], DE: ['de'], AT: ['de'], CH: ['de', 'fr'], LI: ['de'], LU: ['fr', 'de'],
    FR: ['fr'], BE: ['nl', 'fr'], NL: ['nl'], ES: ['es'], IT: ['it'], PT: ['pt'], RO: ['ro'], CZ: ['cs'], SK: ['sk'],
    HU: ['hu'], BG: ['bg'], HR: ['hr'], SI: ['sl'], GR: ['el'], CY: ['el', 'en'], TR: ['tr'], SE: ['sv'], DK: ['da'],
    NO: ['no'], FI: ['fi'], EE: ['et'], LV: ['lv'], LT: ['lt'], IE: ['en'], GB: ['en'], MT: ['en'], IS: ['en'], US: ['en']
  };
  const langsForCountry = c => COUNTRY_LANGS[String(c || '').toUpperCase()] || ['en'];

  const CURRENCY_BY_COUNTRY = {
    UA: 'UAH', KZ: 'KZT', US: 'USD', GB: 'GBP', PL: 'PLN', TR: 'TRY', CH: 'CHF', LI: 'CHF', CZ: 'CZK', RO: 'RON', HU: 'HUF',
    SE: 'SEK', DK: 'DKK', NO: 'NOK', IS: 'ISK', BG: 'BGN'
  };
  const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);
  const currencyForCountry = c => { const k = String(c || '').toUpperCase(); return CURRENCY_BY_COUNTRY[k] || (EURO.has(k) ? 'EUR' : null); };

  // ==========================================================================
  // Pure helpers — no DOM/window access, safe in Node.
  // ==========================================================================
  const httpOnly = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
  const libraryAdUrl = id => 'https://library.tiktok.com/ads/detail/?ad_id=' + id;
  const ccAdUrl = (id, country) => 'https://ads.tiktok.com/business/creativecenter/topads/' + id + '/pc/en' + (country ? '?countryCode=' + country : '');
  const adUrl = (r, country) => (r.source === 'cc' ? ccAdUrl(r.id, country) : libraryAdUrl(r.id));
  const advertiserUrl = (advId, country) => (advId ? 'https://library.tiktok.com/ads?region=' + (country || 'all') + '&adv_biz_ids=' + advId + '&query_type=1' : '');

  function unwrapUrl(u) {
    try { return new URL(u); } catch (e) { return null; }
  }
  function domainOf(u) {
    const x = unwrapUrl(u);
    return x ? x.hostname.replace(/^(www|m|l)\./, '') : '';
  }
  const num = s => +String(s).replace(/\s/g, '').replace(',', '.');
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const share = (n, d) => (d ? Math.round(100 * n / d) / 100 : 0);
  const DAY = 86400;
  // "87.1K" -> 87100; plain numbers pass through; NaN when unreadable.
  const abbrNum = v => { const m = String(v ?? '').trim().match(/^([\d.,]+)\s*([kmb]?)$/i); return m ? Math.round(num(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1)) : NaN; };
  const toSec = ms => (Number.isFinite(+ms) && +ms > 0 ? Math.round(+ms / 1000) : null);
  const AGE_BANDS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];

  // ---- Normalizers ---------------------------------------------------------
  // An Ad Library search item (POST /api/v1/search -> data[]) as a flat row.
  function normalizeLibraryAd(item, kw) {
    const v = (item.videos || [])[0] || {};
    const imgs = (item.image_urls || []).map(httpOnly).filter(Boolean);
    return {
      source: 'library',
      id: String(item.id),
      page: String(item.name || '').trim() || '(без названия)',
      adv_id: '',
      start: toSec(item.first_shown_date),
      last: toSec(item.last_shown_date),
      reach: String(item.estimated_audience || ''),
      category: String(item.subject || ''),
      objective: '', cta: '', link: '',
      title: String(item.title || '').slice(0, 500),
      details: false,
      payer_differs: null, adv_country: '', tt_handle: '', tt_followers: null,
      target_countries: '', target_cities: '', ages: '', genders: '', audience_size: '', targeting_used: '',
      ctr_top: null, likes: null, comments: null, shares: null, cost_level: null, duration: null,
      image_url: httpOnly(v.cover_img) || imgs[0] || '',
      video_url: httpOnly(v.video_url),
      image_urls: v.video_url ? '' : imgs.slice(0, 5).join(' | '),
      audit: String(item.audit_status || ''),
      kws: kw ? [kw] : []
    };
  }

  const OBJECTIVES = [
    [/sale|conversion|purchase|shop/i, 'Продажи/конверсии'], [/lead/i, 'Лиды'], [/traffic/i, 'Трафик'],
    [/app/i, 'Приложение'], [/video|view/i, 'Просмотры видео'], [/reach/i, 'Охват'], [/engag|community|follow|interact/i, 'Вовлечение/подписки']
  ];
  const objectiveName = s => { const t = String(s || ''); if (!t) return ''; for (const [re, n] of OBJECTIVES) if (re.test(t)) return n; return t; };

  // Used-or-not targeting options: what an advertiser narrowed the audience by.
  const TARGETING_FLAGS = [
    ['interest', 'интересы'], ['audience', 'свои аудитории'], ['creator_interactions', 'взаимодействие с авторами'],
    ['video_interactions', 'взаимодействие с видео'], ['languages', 'язык'], ['device_models', 'устройства'], ['high_spending_power', 'высокая платёжеспособность']
  ];
  const usedValue = v => (Array.isArray(v) ? v.length > 0 : !!v && !/^(no|not used|-|none|false)$/i.test(String(v).trim()));

  // Who pays can be a private person (a sole trader): the name is never stored.
  // Only whether the payer differs from the advertiser is kept (an agency, a
  // network or an arbitrage setup pays for someone else's page). null = unknown.
  const normName = x => String(x || '').toLowerCase().replace(/[^\p{L}\d]/gu, '');
  function payerDiffers(advertiser, payer) {
    const a = normName(advertiser), b = normName(payer);
    if (!a || !b) return null;
    return !(a === b || a.includes(b) || b.includes(a));
  }

  // The details JSON of one ad (GET /api/v1/items/<id>/details -> data) as the
  // fields a row gets from its details. Same shape as parseDetailText().
  function detailsFromJson(d) {
    const data = (d && d.data) || d || {};
    const ad = data.ad || {}, adv = data.advertiser || {}, t = data.targeting || {};
    const ages = new Set(), genders = new Set();
    for (const a of t.age || []) for (const b of AGE_BANDS) if (a[b] === true) ages.add(b);
    for (const g of t.gender || []) for (const k of ['female', 'male']) if (g[k] === true) genders.add(k);
    const tu = adv.tt_user && typeof adv.tt_user === 'object' ? adv.tt_user : null;
    const followers = tu ? abbrNum(tu.follower_count ?? tu.followers ?? tu.fans) : NaN;
    const used = TARGETING_FLAGS.filter(([k]) => usedValue(t[k])).map(([, n]) => n);
    return {
      objective: String(ad.advertising_objective || ''),
      cta: String(ad.call_to_action || ''),
      link: httpOnly(ad.external_url),
      adv_id: String(adv.adv_biz_ids || ''),
      payer_differs: payerDiffers(adv.name || ad.name, adv.sponsor),
      adv_country: String(adv.registry_location || ''),
      tt_handle: tu ? String(tu.unique_id || tu.username || tu.nickname || tu.name || '') : '',
      tt_followers: Number.isFinite(followers) ? followers : null,
      target_countries: (t.countries || []).join('|'),
      target_cities: [...(t.cities || []), ...(t.provinces || [])].map(x => (typeof x === 'object' ? x.name || x.label || '' : String(x))).filter(Boolean).join('|'),
      ages: AGE_BANDS.filter(b => ages.has(b)).join('|'),
      genders: [...genders].sort().join('|'),
      audience_size: String(t.target_audience_size || ''),
      targeting_used: used.join('|'),
      reach: String(ad.estimated_audience || (t.location && t.location.total_impressions) || '')
    };
  }

  // The rendered text of an ad's details page (browser mode reads it from a
  // same-origin iframe; the UI must be in English). Best effort: labels the
  // page does not show leave the field empty.
  function parseDetailText(text) {
    const lines = String(text || '').split('\n').map(s => s.replace(/\t/g, ' ').trim()).filter(Boolean);
    const after = (label) => { const i = lines.findIndex(l => l.toLowerCase() === label.toLowerCase() || l.toLowerCase() === label.toLowerCase() + ':'); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };
    const after2 = (label) => { const i = lines.findIndex(l => l.toLowerCase().startsWith(label.toLowerCase())); if (i < 0) return ''; const rest = lines[i].slice(label.length).replace(/^:\s*/, '').trim(); return rest || lines[i + 1] || ''; };
    const used = TARGETING_FLAGS.map(([k, n]) => {
      const label = { interest: 'Interest targeting categories', audience: 'Audience', creator_interactions: 'Creator interactions', video_interactions: 'Video interactions', languages: 'Language', device_models: 'Device', high_spending_power: 'High spending power' }[k];
      return usedValue(after(label)) ? n : null;
    }).filter(Boolean);
    // Reach table rows: "Country Age Gender Reach" with "-" where not broken down.
    const ages = new Set(), genders = new Set();
    const ti = lines.findIndex(l => /^reach by location/i.test(l)), te = lines.findIndex(l => /^additional parameters/i.test(l));
    if (ti >= 0 && te > ti) for (const l of lines.slice(ti + 1, te)) {
      for (const b of AGE_BANDS) if (l.includes(b)) ages.add(b);
      if (/\bfemale\b/i.test(l)) genders.add('female');
      if (/(^|[^e])\bmale\b/i.test(l)) genders.add('male');
    }
    const fi = lines.findIndex(l => /^[\d.,]+[kmb]?\s*followers$/i.test(l));
    const fol = fi >= 0 ? lines[fi].match(/^([\d.,]+)([kmb]?)/i) : null;
    const mult = { k: 1e3, m: 1e6, b: 1e9 };
    const locs = after('Location');
    return {
      objective: after2('Advertising objectives'),
      cta: after('Call to action'),
      link: httpOnly(after('External website linked')),
      adv_id: '',
      payer_differs: payerDiffers(after('Advertiser'), after('Ad paid for by')),
      adv_country: after("Advertiser's registered location"),
      tt_handle: fi > 0 ? lines[fi - 1] : '',
      tt_followers: fol ? Math.round(num(fol[1]) * (mult[(fol[2] || '').toLowerCase()] || 1)) : null,
      target_countries: '',
      target_cities: '',
      target_locations_text: usedValue(locs) ? locs : '',
      ages: AGE_BANDS.filter(b => ages.has(b)).join('|'),
      genders: [...genders].sort().join('|'),
      audience_size: '',
      targeting_used: used.join('|'),
      reach: after2('Unique users seen')
    };
  }

  // Fields from details override the row's empty ones; the row stays the same ad.
  function mergeDetails(row, d) {
    const out = { ...row, details: true };
    for (const [k, v] of Object.entries(d || {})) {
      if (k === 'target_locations_text') continue;
      if (v !== '' && v !== null && v !== undefined) out[k] = v;
    }
    return out;
  }

  // A Creative Center Top Ads material (top_ads/v2/list -> data.materials[]).
  // industries: { 'label_14104000000': 'Skincare', ... } from the filters reply.
  const ccIndustryId = key => String(key || '').replace(/^label_/, '');
  // Top-level Creative Center industries: the link takes the two-digit code (14 -> 14000000000).
  const CC_INDUSTRIES = { 10: 'Education', 11: 'Vehicle & Transportation', 12: 'Baby, Kids & Maternity', 13: 'Financial Services', 14: 'Beauty & Personal Care',
    15: 'Tech & Electronics', 16: 'Appliances', 17: 'Travel', 18: 'Household Products', 19: 'Pets', 20: 'Apps', 21: 'Home Improvement', 22: 'Apparel & Accessories',
    23: 'News & Entertainment', 24: 'Business Services', 25: 'Games', 26: 'Life Services', 27: 'Food & Beverage', 28: 'Sports & Outdoor', 29: 'Health', 30: 'E-Commerce (Non-app)' };
  const COST_NAMES = { 0: 'низкий', 1: 'средний', 2: 'высокий' };
  function normalizeCcAd(m, kw, industries) {
    const vi = m.video_info || {};
    const vu = vi.video_url && typeof vi.video_url === 'object' ? vi.video_url : {};
    const best = ['720p', '540p', '480p', '1080p', '360p'].map(k => httpOnly(vu[k])).find(Boolean) || '';
    const ind = industries || {};
    return {
      source: 'cc',
      id: String(m.id),
      page: String(m.brand_name || '').trim(),
      adv_id: '', start: null, last: null, reach: '',
      category: ind[ccIndustryId(m.industry_key)] || ccIndustryId(m.industry_key),
      objective: String(m.objective_key || '').replace(/^campaign_objective_/, ''),
      cta: '', link: httpOnly(m.landing_page),
      title: String(m.ad_title || '').slice(0, 500),
      details: !!m.landing_page,
      payer_differs: null, adv_country: '', tt_handle: '', tt_followers: null,
      target_countries: Array.isArray(m.country_code) ? m.country_code.join('|') : '', target_cities: '', ages: '', genders: '', audience_size: '', targeting_used: '',
      // ctr: percentile in the industry, "Top 43%" -> 0.43; lower is better.
      ctr_top: Number.isFinite(+m.ctr) && m.ctr !== null && m.ctr !== '' ? +m.ctr : null,
      likes: Number.isFinite(+m.like) ? +m.like : null,
      comments: Number.isFinite(+m.comment) && m.comment !== undefined ? +m.comment : null,
      shares: Number.isFinite(+m.share) && m.share !== undefined ? +m.share : null,
      cost_level: Number.isFinite(+m.cost) ? +m.cost : null, // 0 low, 1 medium, 2 high budget
      duration: Number.isFinite(+vi.duration) ? Math.round(+vi.duration * 10) / 10 : null,
      image_url: httpOnly(vi.cover), video_url: best, image_urls: '', audit: '',
      kws: kw ? [kw] : []
    };
  }

  // Creative Center details page text (browser mode, iframe): landing page,
  // comments, shares.
  function parseCcDetailText(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const after = label => { const i = lines.findIndex(l => l.toLowerCase() === label.toLowerCase()); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };
    const n = s => { const m = String(s || '').match(/^([\d.,]+)\s*([kmb]?)$/i); return m ? Math.round(num(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1)) : null; };
    return { link: httpOnly(after('Landing Page')), comments: n(after('Comments')), shares: n(after('Shares')), likes: n(after('Likes')) };
  }

  // ---- Queries ---------------------------------------------------------------
  // preset.services: [{ pl: 'siłownia', de: 'Fitnessstudio', en: 'gym', uk: ..., ru: ... }].
  // langs: languages of the market (langsForCountry). city: { pl: 'Warszawa', ... }
  // or a string; empty for a nation-wide search. Services alternate across
  // languages so a small max still covers every service once. Returns
  // [{ q, lang }].
  function buildQueries(preset, langs, city, max = 12) {
    const out = [];
    const ls = (langs && langs.length ? langs : ['en']);
    (preset.services || []).forEach((s, i) => {
      let any = false;
      for (const lang of ls) {
        const name = s[lang];
        if (!name) continue;
        any = true;
        const c = typeof city === 'string' ? city : (city && (city[lang] || city.en)) || '';
        out.push({ i, lang, q: (name + (c ? ' ' + c : '')).trim() });
      }
      if (!any && s.en) out.push({ i, lang: 'en', q: s.en });
    });
    out.sort((a, b) => a.i - b.i);
    const seen = new Set();
    return out.filter(o => !seen.has(o.q) && seen.add(o.q)).slice(0, max).map(({ q, lang }) => ({ q, lang }));
  }

  // ---- Where an ad sends the viewer -----------------------------------------
  const MARKETPLACES = /(^|\.)(prom\.ua|rozetka\.com\.ua|olx\.\w+|kasta\.ua|allegro\.pl|amazon\.\w+(\.\w+)?|etsy\.com|ebay\.\w+|temu\.com|aliexpress\.\w+|zalando\.\w+|trendyol\.com|hepsiburada\.com|emag\.\w+|bol\.com|otto\.de|cdiscount\.com)$/;
  const APP_STORES = /^(apps\.apple\.com|itunes\.apple\.com|play\.google\.com|appgallery\.huawei\.com|onelink\.me|app\.adjust\.com|\w+\.onelink\.me)$/;
  const SHORT_LINKS = /^(bit\.ly|tinyurl\.com|cutt\.ly|rebrand\.ly|goo\.gl|ow\.ly|is\.gd|shorturl\.at|t\.ly|linktr\.ee|beacons\.ai|taplink\.cc)$/;
  const PLATFORM_DOORS = ['Маркетплейс', 'Приложение', 'TikTok Shop'];

  function classifyDoor(rec) {
    const d = domainOf(rec.link);
    const cta = String(rec.cta || '');
    const obj = objectiveName(rec.objective);
    if (d === 'wa.me' || d === 'api.whatsapp.com' || /whatsapp/i.test(cta)) return 'WhatsApp';
    if (d === 't.me') { const u = unwrapUrl(rec.link); return u && /bot\/?$/i.test(u.pathname) ? 'Telegram-бот' : 'Telegram'; }
    if (/(^|\.)shop\.tiktok\.com$|^tiktokshop\./.test(d)) return 'TikTok Shop';
    if (/(^|\.)tiktok\.com$/.test(d)) return 'TikTok-профиль';
    if (d === 'instagram.com') return 'Instagram';
    if (/^(facebook\.com|fb\.com|fb\.me|m\.me)$/.test(d)) return 'Facebook';
    if (MARKETPLACES.test(d)) return 'Маркетплейс';
    if (APP_STORES.test(d) || /google play|app store|install|download/i.test(cta)) return 'Приложение';
    if (SHORT_LINKS.test(d)) return 'Мультиссылка/короткая';
    if (d) return 'Сайт';
    if (!rec.details) return 'Не проверено'; // the link is only in the ad's details
    if (obj === 'Лиды') return 'Лид-форма';
    if (/message|contact|chat/i.test(cta)) return 'Сообщения';
    if (/call/i.test(cta)) return 'Звонок';
    if (obj === 'Приложение') return 'Приложение';
    return 'Без ссылки';
  }

  function hookPatterns(opts = {}) {
    const hooks = opts.baseHooks === false ? {} : { ...HOOK_PATTERNS };
    for (const [k, src] of Object.entries(opts.extraHooks || {})) hooks[k] = new RegExp(src, 'u');
    return hooks;
  }

  // Prices in one (lowercased) text in a currency; "N% off" mentions.
  const CURRENCY_RE = {
    UAH: '(?:грн|₴|uah|гривен|гривень)', KZT: '(?:₸|тг(?![а-яё])|тенге|kzt)', USD: '(?:usd|dollars?)', EUR: '(?:€|eur\\b|euro)',
    GBP: '(?:£|gbp)', PLN: '(?:zł|zl\\b|pln)', TRY: '(?:₺|\\btl\\b|try\\b)', CHF: '(?:chf|fr\\.)', CZK: '(?:kč|czk)', RON: '(?:lei\\b|ron\\b)',
    HUF: '(?:ft\\b|huf)', SEK: '(?:kr\\b|sek)', DKK: '(?:kr\\b|dkk)', NOK: '(?:kr\\b|nok)', ISK: '(?:kr\\b|isk)', BGN: '(?:лв|bgn)'
  };
  const CURRENCY_PREFIX = { USD: '\\$', EUR: '€', GBP: '£', TRY: '₺' };
  const MAX_TEXT = 30000; // characters of a text analysed: page and ad text are third-party input for regexes
  function priceHits(t, currency) {
    t = String(t || '').slice(0, MAX_TEXT);
    const cur = CURRENCY_RE[currency] ? currency : 'EUR';
    const n = '(\\d{1,3}(?:[ .\\u00a0]\\d{3}){0,3}(?:[.,]\\d{1,2})?|\\d{1,9}(?:[.,]\\d{1,2})?)';
    const re = new RegExp(n + '\\s?' + CURRENCY_RE[cur] + (CURRENCY_PREFIX[cur] ? '|' + CURRENCY_PREFIX[cur] + '\\s?' + n : ''), 'g');
    const toN = s => num(String(s).replace(/[ . ](?=\d{3}\b)/g, ''));
    const amounts = [...t.matchAll(re)].map(m => toN(m[1] || m[2])).filter(x => x > 0 && x < 1e7);
    const pctOff = [...t.matchAll(/(\d{1,2})\s*%\s*(?:off|знижк|скидк|rabatt|zniżk|descuento|de réduction|sconto|indirim)|(?:знижк\S*|скидк\S*|save|rabatt|zniżk\S*)\s*(?:до\s*|up to\s*|bis zu\s*|do\s*)?-?(\d{1,2})\s*%|(?:^|\s)-(\d{1,2})\s*%/g)].map(m => +(m[1] || m[2] || m[3]));
    return { amounts, pctOff };
  }

  // ---- Landing pages vs ads ----------------------------------------------------
  // Facts from a block of text (a landing page's visible text, or the joined
  // text of an advertiser's ads): which hooks appear, which prices, "N% off".
  function siteFacts(text, opts = {}) {
    const t = String(text || '').slice(0, MAX_TEXT).toLowerCase();
    const hits = priceHits(t, String(opts.currency || 'EUR').toUpperCase());
    const list = [...new Set(hits.amounts)].sort((a, b) => a - b);
    return {
      hooks: Object.entries(hookPatterns(opts)).filter(([k, re]) => k !== 'хэштеги' && re.test(t)).map(([k]) => k),
      prices: { list: list.slice(0, 50), min: list.length ? list[0] : null, median: median(list), max: list.length ? list[list.length - 1] : null },
      pct_off: hits.pctOff
    };
  }

  // Ads vs landing page. A lead, not proof: banners, pop-ups and lazy-loaded
  // blocks may be missing from the page text (and page JavaScript is off by default).
  function compareAdVsSite(ad, site) {
    const near = (a, b) => Math.abs(a - b) < 0.005;
    return {
      promised_not_on_site: ad.hooks.filter(h => !site.hooks.includes(h)),
      on_site_not_advertised: site.hooks.filter(h => !ad.hooks.includes(h)),
      ad_prices_not_on_site: ad.prices.list.filter(p => !site.prices.list.some(s => near(s, p))),
      ad_pct_off_not_on_site: [...new Set(ad.pct_off)].filter(p => !site.pct_off.includes(p)),
      ad_price_range: [ad.prices.min, ad.prices.max],
      site_price_range: [site.prices.min, site.prices.max]
    };
  }

  // Ad-click trackers and redirectors: opening such a link would register a
  // click in the competitor's campaign, so check_sites.py never opens them.
  const TRACKER_HOSTS = /(^|\.)(doubleclick\.net|googleadservices\.com|adform\.net|adsrvr\.org|clickserve\.dartsearch\.net|appsflyer\.com|onelink\.me|adjust\.com|app\.link|bnc\.lt|clickfunnels\.com\/track|awin1\.com|tradedoubler\.com|go2cloud\.org|trk\.\w+)$|^(track|tracking|trk|trkv|trck|clk|clicks?)\d*\./i; // also tracking subdomains: track.<site>, trkv.<site>
  const isTrackerLink = u => TRACKER_HOSTS.test(domainOf(u));

  // Tracking tags seen in a page's HTML (works with page JavaScript off: the
  // script tags are in the markup). TikTok pixel = the advertiser optimizes
  // TikTok for conversions on this site.
  function pixelsIn(html) {
    const h = String(html || '');
    return {
      tiktok: /analytics\.tiktok\.com|ttq\.load\(|tiktok-pixel/i.test(h),
      meta: /connect\.facebook\.net|fbq\(['"]init/i.test(h),
      google: /googletagmanager\.com|gtag\(|google-analytics\.com/i.test(h),
      // A tag manager can load the TikTok / Meta pixel itself: then "not found" means "unknown".
      tag_manager: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(h)
    };
  }

  // ---- Client brief: what the client may truthfully claim ----------------------
  const has = v => v !== null && v !== undefined;
  const CLIENT_RULES = {
    'отзывы/рейтинг': { fields: ['reviews_count', 'reviews_quotable'], ok: c => c.reviews_count > 0 && c.reviews_quotable === true, no: c => c.reviews_count === 0 || c.reviews_quotable === false },
    'гарантия': { fields: ['guarantee_days'], ok: c => c.guarantee_days > 0, no: c => c.guarantee_days === 0 },
    'бесплатно': { fields: ['free_offer'], ok: c => !!c.free_offer, no: c => c.free_offer === false },
    'доставка': { fields: ['free_shipping', 'free_shipping_over'], ok: c => c.free_shipping === true || c.free_shipping_over > 0, no: c => c.free_shipping === false && !(c.free_shipping_over > 0) },
    'подарок/сертификат': { fields: ['bonus'], ok: c => !!c.bonus, no: c => c.bonus === false || c.bonus === '' },
    'процент/скидка': { fields: ['max_discount_pct'], ok: c => c.max_discount_pct > 0, no: c => c.max_discount_pct === 0 },
    'дедлайн/ограничение': { fields: ['real_deadline'], ok: c => c.real_deadline === true, no: c => c.real_deadline === false },
    'опыт/годы': { fields: ['experience_years'], ok: c => c.experience_years > 0, no: c => c.experience_years === 0 },
    'адрес/район': { fields: ['address'], ok: c => !!c.address, no: c => c.address === false },
    'запись/бронь': { fields: ['booking_url'], ok: c => !!c.booking_url, no: c => c.booking_url === false },
    'первый визит/заказ': { fields: ['first_visit_offer'], ok: c => !!c.first_visit_offer, no: c => c.first_visit_offer === false },
    'рассрочка': { fields: ['installment'], ok: c => c.installment === true, no: c => c.installment === false },
    'до/после': { fields: ['before_after_allowed'], ok: c => c.before_after_allowed === true, no: c => c.before_after_allowed === false }
  };
  CLIENT_RULES['акция'] = CLIENT_RULES['процент/скидка'];

  function serviceEconomics(client) {
    const c = client || {};
    const n = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    const [avg, visits, months, margin, show] = ['avg_check', 'visits_per_year', 'retention_months', 'margin_pct', 'booking_to_visit_pct'].map(f => n(c[f]));
    const r2 = x => Math.round(100 * x) / 100;
    const ltv = avg !== null && visits !== null && months !== null ? r2(avg * visits * months / 12) : null;
    const gross = ltv !== null && margin !== null ? r2(ltv * margin / 100) : null;
    return {
      ltv, gross_profit_per_client: gross, break_even_cpa_client: gross,
      break_even_cpa_booking: gross !== null && show !== null ? r2(gross * show / 100) : null,
      missing: ['avg_check', 'visits_per_year', 'retention_months', 'margin_pct', 'booking_to_visit_pct'].filter(f => n(c[f]) === null)
    };
  }

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

  // ---- Curation (curation.json next to ads.csv) ---------------------------------
  // { "include": { "Advertiser": "type" }, "exclude": ["Advertiser"], "types": {...}, "notes": "" }
  function applyCuration(rows, curation) {
    const c = curation || {};
    const include = c.include && typeof c.include === 'object' ? c.include : null;
    const includeSet = include ? new Set(Object.keys(include)) : null;
    const excludeSet = new Set(Array.isArray(c.exclude) ? c.exclude : []);
    const excludeIds = new Set(Array.isArray(c.exclude_ids) ? c.exclude_ids.map(String) : []);
    const types = { ...(c.types || {}), ...(include || {}) };
    const keep = r => !excludeIds.has(String(r.id)) && !excludeSet.has(r.page) && (!includeSet || includeSet.has(r.page));
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

  function queryStats(allRows, keptRows, opts = {}) {
    const queries = [...new Set([...(opts.queries || []), ...allRows.flatMap(r => r.kws || [])])];
    const limited = new Set(opts.limited || []);
    const pagesOf = (rows, q) => new Set(rows.filter(r => (r.kws || []).includes(q)).map(r => r.page || r.id));
    const totals = opts.totals || {};
    return queries.map(q => ({
      query: q,
      ads: allRows.filter(r => (r.kws || []).includes(q)).length,
      library_total: totals[q] ?? null,
      advertisers: pagesOf(allRows, q).size,
      relevant_advertisers: opts.curated ? pagesOf(keptRows, q).size : null,
      capped: limited.has(q)
    }));
  }

  // ---- Warnings next to the numbers ----------------------------------------------
  const SMALL_SAMPLE = 10;
  function seasonWarnings(ts, seasons) {
    const d = new Date(ts * 1000);
    const md = String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    return (seasons || []).filter(s => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to))
      .map(s => ({ name: s.name, note: s.note || '' }));
  }

  // info: { source, advertisers, ads, queryStats, ts, preset, unchecked, details }
  function snapshotWarnings(info) {
    const w = [];
    const add = (code, severity, message) => w.push({ code, severity, message });
    const stats = info.queryStats || [];
    if (info.source === 'cc') {
      add('cc_sample', 'warn', 'Источник — Creative Center (Top Ads): это подборка самых результативных аукционных объявлений, которую делает TikTok, а не вся реклама ниши. Рекламодатели почти всегда скрыты, поиска по нише по сути нет (фильтр по отрасли и слову). Выводы — «что работает в отрасли», а не «что делают конкуренты».');
      if ((info.ads || 0) < 30) add('small_sample', 'warn', 'В выборке только ' + info.ads + ' объявлений: частоты хуков и форматов — гипотезы, не тренд.');
    } else if ((info.advertisers || 0) < SMALL_SAMPLE) {
      add('small_sample', 'warn', 'В выборке только ' + info.advertisers + ' рекламодателей: выводы про хуки, форматы и «что работает» — гипотезы для проверки, а не тренд ниши.');
    }
    const capped = stats.filter(q => q.capped);
    if (capped.length) add('capped', 'info', 'По ' + capped.length + ' из ' + stats.length + ' запросов собрана только часть выдачи (лимит страниц за прогон): ' + capped.map(q => q.query).join(', ') + '.');
    const empty = stats.filter(q => q.ads === 0);
    if (empty.length) add('empty_queries', 'info', 'Запросы без единого объявления: ' + empty.map(q => q.query).join(', ') + '. Либо нишу так не ищут, либо формулировка не та.');
    const wide = stats.filter(q => q.library_total >= 1000);
    if (wide.length) add('wide_queries', 'warn', 'Слишком широкие запросы (TikTok ищет любое из слов): ' + wide.map(q => q.query + ' — ' + q.library_total).join(', ') + '. Собран только верх выдачи; в таких запросах много чужой рекламы. Лучше одно слово услуги или точная фраза.');
    const base = info.creatives || info.ads;
    if (info.source === 'library' && base && info.unchecked / base > 0.3) add('details_missing', 'warn', 'Куда ведёт реклама, CTA, цель и таргетинг известны только для ' + (base - info.unchecked) + ' из ' + base + ' уникальных роликов (детали открывались не для всех). Доли «дверей» и CTA считай по проверенным.');
    for (const s of seasonWarnings(info.ts, info.preset && info.preset.seasons)) add('seasonal', 'warn', 'Срез сделан в сезон «' + s.name + '»' + (s.note ? ': ' + s.note : '') + '. Часть рекламы временная, повтори срез после сезона.');
    if (info.preset && info.preset.policy) add('policy', 'info', info.preset.policy);
    return w;
  }

  // ---- What else can be done with a snapshot --------------------------------------
  const CREATIVE_LINK_DAYS = 2; // TikTok's signed media links live hours to days
  function nextSteps(st) {
    const s = st || {};
    const out = [];
    const add = (code, title, why, how, extra = {}) => out.push({ code, title, why, urgent: false, needs: '', how, ...extra });
    if (s.source === 'library' && !s.curated) add('curate', 'Отобрать конкурентов (curation.json)', 'Поиск идёт по тексту объявлений и названию рекламодателя, поэтому в срезе есть не конкуренты. Без чистки детали, креативы и гипотезы уходят на чужих.', 'Прочитать топ рекламодателей по смыслу, спорных обсудить, решение записать в curation.json рядом с ads.csv.');
    if (s.source === 'cc' && !s.curated) add('curate_cc', 'Убрать нерелевантные объявления (curation.json → exclude_ids)', 'Отрасль в Creative Center широкая: в подборку попадают соседние товары и услуги.', 'Просмотреть объявления, id лишних записать в curation.json → "exclude_ids".');
    if (!s.preset && !s.niche) add('niche_hooks', 'Хуки ниши в niche.json', 'Для ниши нет пресета: посчитаны только базовые хуки.', 'Записать niche.json рядом с ads.csv (extra_hooks, noise, currency) и пересобрать отчёт.');
    if (s.source === 'library' && s.unchecked > 0) add('details', 'Открыть детали лидеров (CTA, ссылка, цель, таргетинг)', 'У ' + s.unchecked + ' объявлений неизвестно, куда ведёт реклама, какой CTA и на кого таргет.', 'python scripts/details.py <срез> --limit 40 (или __tti.details() в браузере).', { needs: s.curated ? '' : 'сначала отобрать конкурентов (curation.json)' });
    if (!s.manifest && s.age_days > CREATIVE_LINK_DAYS) add('creatives_recollect', 'Креативы: ссылки, скорее всего, уже не работают', 'Срезу ' + Math.round(s.age_days) + ' дн., ссылки TikTok на видео и обложки живут недолго.', 'Собрать срез заново и сразу после чистки скачать креативы.');
    else if (!s.manifest) add('creatives', 'Скачать и раскадровать видео лидеров', 'Выводы о креативах сейчас только по тексту: хук первых секунд, формат ролика и подача неизвестны.', 'python scripts/fetch_creatives.py <срез> --top-advertisers 10 --limit 30 --videos 15, затем разметить по references/creatives.md и проверить: node scripts/creatives.js lint <срез>.', { urgent: true, needs: s.curated ? '' : 'сначала чистка (curation.json)' });
    else if (s.labeled < s.downloaded) add('creatives_label', 'Разметить скачанные креативы', 'Скачано ' + s.downloaded + ', размечено ' + s.labeled + '.', 'Просмотреть раскадровки, дописать creatives.json, node scripts/creatives.js lint <срез>.');
    if (s.source === 'cc' && !s.cc_details) add('cc_details', 'Посадочные страницы топ-объявлений', 'В списке Creative Center нет ссылок; они есть в карточке объявления.', 'python scripts/scrape.py ... --details 30 (или __tti.ccDetails() в браузере).');
    if (!s.client) add('brief', 'Бриф клиента, затем гипотезы', 'Гипотезы пишутся под конкретного клиента: без client.json неизвестно, что он может честно обещать.', 'До 5 вопросов клиенту, client.json, node scripts/client_fit.js <срез>.');
    else if (!s.hypotheses) add('hypotheses', 'Гипотезы объявлений по брифу', 'Бриф есть, гипотез ещё нет.', 'Записать hypotheses.json по правилам SKILL.md, затем node scripts/lint_hypotheses.js <срез>.');
    else if (!s.lint) add('lint', 'Автопроверка гипотез', 'Гипотезы есть, но не проверены на правила TikTok и бриф.', 'node scripts/lint_hypotheses.js <срез>.');
    else if (!s.plan) add('test_plan', 'План теста', 'Гипотезы проверены, но порядок запуска и бюджет не посчитаны.', 'Заполнить в hypotheses.json effort и variable_type, затем node scripts/plan_tests.js <срез>.');
    if (!s.sites && (s.source === 'cc' || !s.unchecked || s.curated)) add('sites', 'Проверить сайты лидеров', 'Неизвестно, совпадает ли обещание в рекламе с посадочной, какие там цены и стоит ли пиксель TikTok (оптимизация на конверсии).', 'python scripts/check_sites.py <срез> --top 5', { needs: 'только по просьбе пользователя: открывает сторонние сайты' });
    if (s.source === 'cc' && s.library_country) add('library', 'Полный разбор конкурентов через Ad Library', 'Страна есть в Ad Library: там видны рекламодатели, сроки показа и таргетинг.', 'python scripts/scrape.py --source library ...');
    if (!s.diff) add('compare', 'Повторить срез через 2–4 недели и сравнить', 'Один срез — снимок: что масштабируют (рост копий), какие молодые тесты выключили и кто пришёл новым, видно только в динамике.', 'Тот же пресет и те же запросы без --out (папки по датам), затем node scripts/compare.js out/<ниша>.');
    return out;
  }

  // Query hygiene after curation: keep a query only if it found a competitor.
  function suggestQueries(stats, langOf) {
    const curated = stats.some(q => q.relevant_advertisers !== null && q.relevant_advertisers !== undefined);
    if (!curated) return { curated: false, keep: [], drop: [], preset_services: [] };
    const keep = [], drop = [];
    for (const q of stats) {
      if (q.ads === 0) drop.push({ query: q.query, reason: 'no ads' });
      else if (!q.relevant_advertisers) drop.push({ query: q.query, reason: 'no competitors' });
      else keep.push({ query: q.query, relevant_advertisers: q.relevant_advertisers, advertisers: q.advertisers, weak: q.relevant_advertisers / q.advertisers < 0.25 });
    }
    const lo = langOf || {};
    return { curated: true, keep, drop, preset_services: keep.map(k => ({ [lo[k.query] || 'en']: k.query })) };
  }

  const strengthOf = (advertisers, top_share) => (advertisers >= 5 && top_share <= 0.5 ? 'strong' : advertisers >= 3 && top_share <= 0.7 ? 'moderate' : 'weak');

  // ---- Creatives ----------------------------------------------------------------
  // TikTok ads are short vertical videos: the storyboard of frames is the
  // creative. Tags Claude writes in creatives.json after looking at it.
  const CREATIVE_TAGS = {
    subject: { label: 'Что в кадре (обложка)', values: ['product', 'person_with_product', 'person', 'face_closeup', 'result_before_after', 'process', 'place', 'text_only'],
      names: { product: 'товар', person_with_product: 'человек с товаром', person: 'человек / специалист', face_closeup: 'лицо крупно', result_before_after: 'результат / до-после', process: 'процесс', place: 'место / интерьер', text_only: 'только текст' } },
    style: { label: 'Стиль', values: ['native_ugc', 'creator', 'pro_video', 'template_graphic', 'meme', 'ai_generated'],
      names: { native_ugc: 'нативно, снято на телефон', creator: 'креатор / блогер', pro_video: 'продакшн', template_graphic: 'шаблон / графика', meme: 'мем', ai_generated: 'похоже на ИИ' } },
    offer_on_screen: { label: 'Оффер в кадре', multi: true, values: ['discount', 'gift', 'free', 'deadline', 'price', 'none'], names: { discount: 'скидка', gift: 'подарок', free: 'бесплатно', deadline: 'срок акции', price: 'цена', none: 'нет' } },
    social_proof: { label: 'Соцдоказательство', multi: true, values: ['review', 'stars', 'numbers', 'comments', 'none'], names: { review: 'отзыв', stars: 'звёзды / рейтинг', numbers: 'цифры клиентов', comments: 'ответ на комментарий', none: 'нет' } },
    brand_visible: { label: 'Видно лого или название', type: 'bool' },
    hook_type: { label: 'Хук первых 2–3 секунд', videoOnly: true, values: ['talking_person', 'question', 'pain', 'result_first', 'pov_story', 'product_demo', 'text_hook', 'pattern_interrupt', 'unboxing'],
      names: { talking_person: 'человек говорит в камеру', question: 'вопрос', pain: 'боль / проблема', result_first: 'сразу результат', pov_story: 'POV / история', product_demo: 'товар в действии', text_hook: 'крупный текст-хук', pattern_interrupt: 'неожиданный кадр', unboxing: 'распаковка' } },
    video_format: { label: 'Формат ролика', videoOnly: true, values: ['talking_head', 'ugc_review', 'green_screen', 'tutorial_demo', 'before_after', 'unboxing', 'skit', 'slideshow', 'montage', 'animation'],
      names: { talking_head: 'говорящая голова', ugc_review: 'UGC-отзыв', green_screen: 'зелёный экран', tutorial_demo: 'демонстрация / туториал', before_after: 'до-после', unboxing: 'распаковка', skit: 'сценка', slideshow: 'слайд-шоу', montage: 'нарезка сцен', animation: 'анимация' } },
    face_first_second: { label: 'Лицо в первую секунду', videoOnly: true, type: 'bool' },
    text_overlay: { label: 'Текст поверх видео / субтитры', videoOnly: true, type: 'bool' },
    end_cta: { label: 'Призыв или контакты в финале', videoOnly: true, type: 'bool' }
  };
  const hasFrames = item => !!(item && item.video && item.video.status === 'ok');
  const BOOL_NAMES = { true: 'да', false: 'нет' };
  const NOTES_MAX = 200;

  function videoFramePlan(duration) {
    const d = Number(duration);
    if (!Number.isFinite(d) || d <= 0) return [{ t: 0, label: '0s' }];
    const cand = [[0, '0s'], [1, '1s'], [2, '2s'], [3, '3s'], [d * 0.25, '25%'], [d * 0.5, '50%'], [d * 0.75, '75%']].filter(([t]) => t < d - 0.3);
    const out = [];
    for (const [t, label] of cand.sort((a, b) => a[0] - b[0])) if (!out.length || t - out[out.length - 1].t >= 0.4) out.push({ t: Math.round(t * 100) / 100, label });
    if (!out.length) return [{ t: 0, label: '0s' }];
    const end = Math.round((d - 0.25) * 100) / 100;
    while (out.length > 1 && end - out[out.length - 1].t < 0.4) out.pop();
    if (end - out[out.length - 1].t >= 0.4) out.push({ t: end, label: 'end' });
    return out;
  }
  function aspectOf(w, h) {
    if (!(w > 0 && h > 0)) return '';
    const r = w / h;
    return r < 0.7 ? '9:16' : r < 0.9 ? '4:5' : r <= 1.1 ? '1:1' : '16:9';
  }
  const durationBucket = d => (d < 10 ? '<10' : d < 20 ? '10-20' : d < 35 ? '20-35' : d <= 60 ? '35-60' : '>60');

  function creativeMedia(r) {
    const img = httpOnly(r.image_url || '');
    const video = httpOnly(r.video_url || '');
    const cards = String(r.image_urls || '').split(' | ').map(httpOnly).filter(Boolean).slice(0, 5);
    if (!video && cards.length >= 2) return { kind: 'carousel', urls: cards };
    if (!img) return null;
    return video ? { kind: 'video', urls: [img], video_url: video } : { kind: 'image', urls: [img] };
  }
  const mediaKey = u => { try { const x = new URL(u); return x.hostname + x.pathname; } catch (e) { return u; } };

  // Run length of a Library ad (first to last shown, inclusive) in days.
  const runDays = r => (r.start && r.last ? Math.max(1, Math.round((r.last - r.start) / DAY) + 1) : null);
  // "Still running": last shown within activeDays of the snapshot.
  const isActive = (r, now, activeDays = 7) => r.source === 'cc' || (r.last && now - r.last <= activeDays * DAY);

  // Which creatives to look at when only `limit` can be: per advertiser the
  // longest-running (Library) or the best CTR percentile (Creative Center)
  // first; advertisers take turns; each video once.
  function selectCreatives(rows, opts = {}) {
    const limit = opts.limit || 60, perAdvertiser = opts.perAdvertiser || 3, longDays = opts.longDays || 60;
    const keyOf = r => r.page || 'ad:' + r.id;
    const adsOf = {};
    rows.forEach(r => { adsOf[keyOf(r)] = (adsOf[keyOf(r)] || 0) + 1; });
    const queues = new Map();
    for (const r of rows) {
      const m = creativeMedia(r);
      if (!m) continue;
      const k = keyOf(r);
      if (!queues.has(k)) queues.set(k, []);
      const days = runDays(r);
      queues.get(k).push({ id: r.id, page: r.page || '', source: r.source, kind: m.kind, urls: m.urls, ...(m.video_url ? { video_url: m.video_url } : {}),
        days, long_running: (days || 0) >= longDays, ctr_top: r.ctr_top, likes: r.likes });
    }
    const score = it => (it.source === 'cc' ? -(it.ctr_top ?? 1) : (it.days || 0));
    let order = [...queues.values()].sort((a, b) => (adsOf[keyOf(b[0])] - adsOf[keyOf(a[0])]) || (b.length - a.length) || (Math.max(...b.map(score)) - Math.max(...a.map(score))));
    if (opts.topAdvertisers > 0) order = order.slice(0, opts.topAdvertisers);
    for (const q of order) q.sort((a, b) => score(b) - score(a));
    const out = [], seen = new Set(), taken = new Map(), pos = new Map();
    let moved = true;
    while (out.length < limit && moved) {
      moved = false;
      for (const q of order) {
        if (out.length >= limit) break;
        const k = q[0].page || 'ad:' + q[0].id;
        if ((taken.get(k) || 0) >= perAdvertiser) continue;
        let i = pos.get(k) || 0;
        while (i < q.length && seen.has(mediaKey(q[i].video_url || q[i].urls[0]))) i++;
        pos.set(k, i + 1);
        if (i >= q.length) continue;
        const item = q[i];
        seen.add(mediaKey(item.video_url || item.urls[0]));
        taken.set(k, (taken.get(k) || 0) + 1);
        out.push(item);
        moved = true;
      }
    }
    return out;
  }

  const labelList = labels => (Array.isArray(labels) ? labels : (labels && Array.isArray(labels.items) ? labels.items : []));

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
        if (t.videoOnly && !hasFrames(item)) {
          if (!empty) add(id, 'warn', 'video_tag_not_video', field, 'Only a video cut into frames gets this field.');
          continue;
        }
        if (empty || (t.multi && Array.isArray(v) && !v.length)) { add(id, 'error', 'missing_field', field, 'Required field is empty.'); continue; }
        if (t.type === 'bool') { if (typeof v !== 'boolean') add(id, 'error', 'bad_type', field, 'Must be true or false.'); continue; }
        if (!t.multi && Array.isArray(v)) { add(id, 'error', 'bad_type', field, 'One value, not a list.'); continue; }
        const vals = t.multi ? (Array.isArray(v) ? v : [v]) : [v];
        const bad = vals.filter(x => !t.values.includes(x));
        if (bad.length) add(id, 'error', 'bad_value', field, 'Unknown value ' + bad.map(x => '"' + x + '"').join(', ') + '; allowed: ' + t.values.join(', ') + '.');
        if (t.multi && vals.includes('none') && vals.length > 1) add(id, 'error', 'none_mixed', field, '"none" together with other values.');
      }
      if (l.notes !== undefined && typeof l.notes !== 'string') add(id, 'error', 'bad_type', 'notes', 'Notes must be text.');
      else if (String(l.notes || '').length > NOTES_MAX) add(id, 'warn', 'notes_long', 'notes', 'Notes are ' + l.notes.length + ' characters; keep them under ' + NOTES_MAX + '.');
      const known = new Set(['id', 'notes', 'hook_text', ...Object.keys(CREATIVE_TAGS)]);
      const extra = Object.keys(l).filter(k => !known.has(k));
      if (extra.length) add(id, 'warn', 'unknown_field', extra.join(', '), 'Fields outside the vocabulary are ignored.');
    }
    for (const id of ok.keys()) if (!seen.has(id)) add(id, 'info', 'unlabeled', 'id', 'Downloaded but not labeled yet.');
    const rank = { error: 0, warn: 1, info: 2 };
    f.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { errors: f.filter(x => x.severity === 'error').length, warnings: f.filter(x => x.severity === 'warn').length, findings: f };
  }

  // "What is in the videos": per tag value, how many labeled creatives and
  // advertisers have it (strength as for hooks) and how many are winners
  // (long-running in the Library, top-20% CTR in Creative Center).
  function creativesSummary(rows, labels, manifest, opts = {}) {
    const longDays = opts.longDays || 60, country = opts.country || '';
    const byId = new Map(rows.map(r => [String(r.id), r]));
    const all = (manifest && manifest.items) || [];
    const items = all.filter(i => i.status === 'ok' && byId.has(String(i.id)));
    const lab = new Map(labelList(labels).map(l => [String(l.id), l]));
    const winner = r => (r.source === 'cc' ? r.ctr_top !== null && r.ctr_top <= 0.2 : (runDays(r) || 0) >= longDays);
    const gallery = items.map(i => {
      const r = byId.get(String(i.id));
      const l = lab.get(String(i.id));
      const tags = l ? Object.fromEntries(Object.keys(CREATIVE_TAGS).filter(k => l[k] !== undefined && l[k] !== null).map(k => [k, l[k]])) : null;
      const tag_names = tags ? Object.fromEntries(Object.entries(tags).map(([k, val]) => [k, [].concat(val).map(x => (typeof x === 'boolean' ? BOOL_NAMES[x] : (CREATIVE_TAGS[k].names || {})[x] || String(x))).join(', ')])) : null;
      const vd = hasFrames(i) ? i.video : null;
      const video = vd ? { duration: vd.duration, width: vd.width, height: vd.height, aspect: vd.aspect || aspectOf(vd.width, vd.height), frames: vd.frames || [], storyboard: vd.storyboard || '', storyboard_thumb: vd.storyboard_thumb || '' } : null;
      const first = (a, b) => [a, ...(b || [])].filter(Boolean);
      return { id: String(i.id), page: r.page || '', kind: i.kind, days: runDays(r), ctr_top: r.ctr_top, likes: r.likes, winner: winner(r),
        url: adUrl(r, country), files: video ? first(video.storyboard, i.files) : i.files || [], thumbs: video ? first(video.storyboard_thumb, i.thumbs) : i.thumbs || [],
        video, tags, tag_names, hook_text: l && typeof l.hook_text === 'string' ? l.hook_text : '', notes: l && typeof l.notes === 'string' ? l.notes : '' };
    });
    const done = gallery.filter(g => g.tags);
    const keyOf = g => g.page || 'ad:' + g.id;
    const fields = Object.entries(CREATIVE_TAGS).map(([field, t]) => {
      const pool = t.videoOnly ? done.filter(g => g.video) : done;
      const values = (t.type === 'bool' ? [true, false] : t.values).map(value => {
        const hasIt = pool.filter(g => (t.multi ? [].concat(g.tags[field] || []) : [g.tags[field]]).includes(value));
        const by = {};
        hasIt.forEach(g => { by[keyOf(g)] = (by[keyOf(g)] || 0) + 1; });
        const ents = Object.entries(by).sort((a, b) => b[1] - a[1]);
        const top_share = hasIt.length ? share(ents[0][1], hasIt.length) : 0;
        return { value, name: t.type === 'bool' ? BOOL_NAMES[value] : t.names[value], creatives: hasIt.length, share: share(hasIt.length, pool.length), advertisers: ents.length,
          top_advertiser: ents.length ? ents[0][0] : null, top_share, strength: value === 'none' || value === false ? null : strengthOf(ents.length, top_share), winners: hasIt.filter(g => g.winner).length };
      }).filter(v => v.creatives > 0).sort((a, b) => b.creatives - a.creatives);
      return { field, label: t.label, labeled: pool.length, values };
    }).filter(f => f.values.length);
    const count = s => all.filter(i => i.status === s).length;
    const advertisers = new Set(done.map(keyOf)).size;
    const warnings = [];
    if (count('expired')) warnings.push({ code: 'creatives_expired', severity: 'warn', message: 'Не скачались ' + count('expired') + ' из ' + all.length + ' креативов: ссылки TikTok уже не действуют. Собери срез заново и сразу запусти fetch_creatives.py.' });
    if (items.length > done.length) warnings.push({ code: 'creatives_unlabeled', severity: 'info', message: 'Скачано ' + items.length + ' креативов, размечено ' + done.length + ': блок «Что в роликах» считается только по размеченным.' });
    if (done.length && advertisers < SMALL_SAMPLE) warnings.push({ code: 'creatives_small', severity: 'warn', message: 'Креативы размечены у ' + advertisers + ' рекламодателей/объявлений: частоты по роликам — гипотезы, а не тренд.' });
    const cut = gallery.filter(g => g.video);
    const tallyBy = f => cut.reduce((m, g) => { const k = f(g); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const videoFailed = items.filter(i => i.want_video && i.video && i.video.status !== 'ok').length;
    const videos = { analysed: cut.length, failed: videoFailed, durations: tallyBy(g => (Number.isFinite(g.video.duration) ? durationBucket(g.video.duration) : '')), aspects: tallyBy(g => g.video.aspect) };
    if (videoFailed) warnings.push({ code: 'videos_failed', severity: 'info', message: 'Не удалось разобрать на кадры ' + videoFailed + ' видео: у них осталась только обложка.' });
    const tag_fields = Object.entries(CREATIVE_TAGS).map(([field, t]) => ({ field, label: t.label }));
    return { selected: all.length, downloaded: items.length, expired: count('expired'), failed: all.filter(i => ['expired', 'blocked', 'too_big', 'error'].includes(i.status)).length, labeled: done.length, advertisers, tag_fields, fields, videos, items: gallery, warnings };
  }

  // ---- Hypothesis checks (TikTok) ---------------------------------------------
  // Heuristics for TikTok ad-policy trouble and claims the client has not
  // confirmed. They flag, they do not certify: TikTok reviews every ad and its
  // Advertising Policies change.
  const HYP_REQUIRED = ['name', 'angle', 'evidence', 'hook_line', 'scenario', 'primary_text', 'cta', 'destination', 'format', 'test', 'metric', 'risk'];
  const TIKTOK_CTAS = ['learn more', 'shop now', 'sign up', 'contact us', 'apply now', 'book now', 'download', 'order now', 'get quote', 'send message', 'call now', 'visit store', 'watch now', 'subscribe', 'install now', 'play game', 'get showtimes', 'listen now', 'read more', 'view now', 'interested', 'get tickets now', 'experience now', 'pre-order now', 'view profile', 'join this hashtag', 'shoot with this effect', 'get coupon', 'view video'];
  const YOU = /\b(you|your|you're|du|dein\w*|sie|ihr\w*|ty|twój|twoja|tu|tú|tus|vous|votre|sen|senin)\b|(^|[^а-яіїєґ])(вы|ваш\S*|ты|твой|твоя|твої|у вас|у тебя|ви|тобі|тебе)(?![а-яіїєґ])/i;
  const ATTR = /\b(overweight|obese|fat\b|depress\w*|anxi\w*|diabet\w*|bald(?:ing)?|in debt|lonely|infertil\w*|acne|übergewicht\w*|nadwag\w*|otyły|sobrepeso|surpoids)\b|(лишн\S+ вес|зайв\S+ ваг|ожирен\S*|депресс\S*|депрес\S*|тревожн\S*|тривожн\S*|диабет\S*|діабет\S*|лыс\S*|облыс\S*|долг\S*|борг\S*|одинок\S*|самотн\S*|бесплод\S*|прыщ\S*|акне)/i;
  const TEXT_RULES = [
    { code: 'health_claim', severity: 'warn', re: /\b(cures?|cured|heals?|miracle|permanent(?:ly)?|100%\s*(?:effective|guaranteed)|guaranteed results?|clinically proven|doctor.recommended|heilt|wunder|gwarantowan\S* efekt)\b|(вылеч\S*|излеч\S*|лечит|виліку\S*|чудо\S*|навсегда|назавжди|гарантирован\S* результат|гарантован\S* результат|клинически доказан\S*)/i, message: 'Medical or absolute result claim: TikTok rejects unproven health/result claims.' },
    { code: 'before_after', severity: 'warn', re: /before\s*(?:and|&|\/|-)\s*after|до\s*(?:и|\/|-)\s*после|до\s*(?:і|\/|-)\s*після|vorher.{0,80}nachher|przed i po|antes y después/i, message: 'Before/after: TikTok bans it for weight loss and restricts it for cosmetic results; keep it out unless the niche allows it.' },
    { code: 'weight_loss', severity: 'warn', re: /(lose \d{1,3}\s*(kg|lbs?)|weight.?loss|abnehmen|schudn|похуд\S*|схуд\S*|скинуть \d+|скинути \d+|\d{1,3}\s*кг за)/i, message: 'Weight-loss wording: TikTok restricts weight-management ads (18+ targeting, no unrealistic results, no body shaming).' },
    { code: 'income_claim', severity: 'warn', re: /(get rich|passive income|\$\d{1,7}[k]? (a|per) (day|week|month)|заработ\S* \d{1,7}|заробі\S* \d{1,7}|пассивн\S* доход|пасивн\S* дохід|dochód pasywny)/i, message: 'Income / get-rich claim: TikTok bans unrealistic earnings promises.' },
    { code: 'superlative', severity: 'warn', re: /(#\s?1\b|\bno\.?\s?1\b|\bbest\b|world'?s (?:best|first)|№\s?1|лучш\S+|найкращ\S+|beste[rsn]?\b|najlepsz\S+|el mejor|le meilleur|il migliore|en iyi)/i, message: 'Superlative ("#1", "best"): needs proof you can show.' },
    { code: 'tiktok_brand', severity: 'info', re: /\btik\s?tok\b/i, message: 'Mentions TikTok: do not imply TikTok endorses the product.' }
  ];
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const nums = (t, re) => [...t.matchAll(re)].map(m => +String(m[1] || m[2]).replace(/,/g, '.'));

  function lintHypotheses(hyps, opts = {}) {
    const client = opts.client || null;
    const hooks = hookPatterns(opts);
    const SKIP_CLAIM_CHECK = new Set(['хэштеги', 'POV/сюжетный формат', 'ссылка в профиле']);
    return hyps.map((h, i) => {
      const f = [];
      const add = (severity, code, field, message) => f.push({ severity, code, field, message });
      const name = h.name || 'hypothesis #' + (i + 1);
      for (const k of HYP_REQUIRED) {
        const v = h[k];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) add('error', 'missing_field', k, 'Required field is empty.');
      }
      const hook = String(h.hook_line || ''), body = String(h.primary_text || ''), scen = [].concat(h.scenario || []).join(' ');
      const all = hook + ' ' + body + ' ' + scen;
      if (body.length > 100) add('error', 'text_too_long', 'primary_text', 'Ad text is ' + body.length + ' characters; TikTok allows up to 100 (Latin script).');
      else if (body.length > 0 && body.length < 12) add('warn', 'text_short', 'primary_text', 'Ad text under 12 characters looks unfinished.');
      if (EMOJI.test(body)) add('warn', 'emoji_in_text', 'primary_text', 'Emoji in ad text: TikTok Ads Manager does not accept them in non-Spark ad text (a Spark Ad uses the post caption instead).');
      if (hook.length > 60) add('warn', 'hook_long', 'hook_line', 'Hook line is ' + hook.length + ' characters: the first 2 seconds hold about 5–8 words on screen.');
      if (h.cta && !TIKTOK_CTAS.includes(String(h.cta).trim().toLowerCase())) add('warn', 'cta_not_tiktok', 'cta', 'CTA "' + h.cta + '" is not one of TikTok\'s buttons (Learn more, Shop now, Book now, Contact us, Sign up, ...). Name the button; the text on screen can differ.');
      const ph = all.match(/\[[^\]]+\]/g);
      if (ph) add(client ? 'warn' : 'info', 'placeholder', 'hook_line/primary_text', 'Unfilled placeholders: ' + [...new Set(ph)].join(', ') + (client ? ' (client.json is present: fill them or ask).' : '.'));
      const letters = (hook + body).replace(/[^\p{L}]/gu, '');
      if (letters.length >= 8 && (hook + body).replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6) add('warn', 'all_caps', 'hook_line/primary_text', 'Mostly capital letters.');
      if ((all.match(/!/g) || []).length > 3) add('warn', 'exclamation', 'primary_text', 'More than 3 exclamation marks.');
      if (YOU.test(all) && ATTR.test(all)) add('error', 'personal_attributes', 'hook_line/primary_text', 'Addresses the viewer with a personal attribute (weight, health, debt, skin, ...): TikTok rejects ads that imply they know it.');
      for (const r of TEXT_RULES) if (r.re.test(all)) add(r.severity, r.code, 'hook_line/primary_text/scenario', r.message);
      if (/(today only|last day|ends tonight|only \d{1,4} left|hurry|только сегодня|последний день|осталось \d{1,4}|лише сьогодні|тільки сьогодні|залишилось \d{1,4}|nur heute|tylko dziś|solo hoy)/i.test(all) && !(client && (client.real_deadline === true || client.real_stock_limit === true))) {
        add('warn', 'urgency', 'hook_line/primary_text', 'Urgency wording without a confirmed real deadline or stock limit (client.json real_deadline / real_stock_limit).');
      }
      if (client) {
        const t = all.toLowerCase();
        if (/guarantee|money.?back|refund|гарант|возврат|повернен|garantie|gwarancj/i.test(t)) {
          for (const d of nums(t, /(\d{1,4})[\s-]{0,3}(?:day|дн|дней|дня|днів|tage|dni|días|jours)/gi)) if (has(client.guarantee_days) && d > client.guarantee_days) add('error', 'guarantee_days_overstated', 'primary_text', 'States a ' + d + '-day guarantee, client.json confirms ' + client.guarantee_days + '.');
        }
        for (const r of nums(t, /(\d(?:[.,]\d)?)\s*(?:★|⭐|stars?\b|\/5|out of 5)|rated\s*(\d(?:\.\d)?)/gi)) if (has(client.reviews_rating) && r > client.reviews_rating + 0.05) add('error', 'rating_overstated', 'hook_line/primary_text', 'States a rating of ' + r + ', client.json confirms ' + client.reviews_rating + '.');
        for (const n of nums(t, /(\d[\d,]{1,9})\+?\s*(?:reviews|customers|clients|отзыв\S*|відгук\S*|клиент\S*|клієнт\S*|kunden|klient\S*|opini\S*)/gi)) if (has(client.reviews_count) && n > client.reviews_count) add('error', 'reviews_overstated', 'hook_line/primary_text', 'States ' + n + ' reviews/customers, client.json confirms ' + client.reviews_count + '.');
        for (const d of nums(t, /(\d{1,2})\s*%/g)) if (has(client.max_discount_pct) && /%|знижк|скидк|off|rabatt|zniżk/.test(t) && d > client.max_discount_pct) add('error', 'discount_overstated', 'hook_line/primary_text', 'Offers ' + d + '%, client.json allows at most ' + client.max_discount_pct + '%.');
        const cur = String(client.currency || 'EUR').toUpperCase();
        const allowed = [client.price, client.free_shipping_over, ...(client.prices || [])].filter(has).map(Number);
        for (const price of priceHits(t, cur).amounts) if (allowed.length && !allowed.some(a => Math.abs(a - price) < 0.005)) add('warn', 'price_not_in_brief', 'hook_line/primary_text', 'Price ' + price + ' ' + cur + ' is not among the prices in client.json.');
        const labels = Object.keys(hooks).filter(k => !SKIP_CLAIM_CHECK.has(k) && CLIENT_RULES[k] && hooks[k].test(t));
        for (const fit of checkClientFit(client, labels)) {
          if (fit.status === 'blocked') add('error', 'claims_blocked_hook', 'hook_line/primary_text', 'Text claims "' + fit.hook + '", which the client said is not true.');
          else if (fit.status === 'unknown') add('warn', 'claims_unconfirmed_hook', 'hook_line/primary_text', 'Text claims "' + fit.hook + '" but client.json does not confirm it (' + fit.missing.join(', ') + ').');
        }
        for (const a of [].concat(client.avoid || [])) {
          const w = String(a).toLowerCase().match(/[\p{L}]{5,}/gu) || [];
          if (w.length && w.filter(x => t.includes(x)).length >= Math.min(2, w.length)) add('warn', 'client_avoid', 'hook_line/primary_text', 'May touch the client\'s "avoid" rule: ' + a);
        }
      }
      const rank = { error: 0, warn: 1, info: 2 };
      f.sort((a, b) => rank[a.severity] - rank[b.severity]);
      return { name, errors: f.filter(x => x.severity === 'error').length, warnings: f.filter(x => x.severity === 'warn').length, findings: f };
    });
  }

  // ---- Prioritization and test plan ------------------------------------------
  // score = evidence x readiness / effort.
  //  evidence: evidence_strength (strong 3, moderate 2, structural 2, weak or missing 1);
  //  readiness: 1 if the client confirmed the hypothesis' hook (or it needs no
  //    client fact), 0.5 if not asked yet, 0 if the client said it is not true;
  //    halved again while the text has lint errors;
  //  effort: 1 (text / on-screen text only), 2 (new video), 3 (new page, offer
  //    or a creator shoot); default 2.
  // opts: { client, lint: { [name]: { errors } } }.
  const VARIABLE_TYPES = ['creative', 'hook', 'offer', 'landing', 'audience'];
  function prioritizeHypotheses(hyps, opts = {}) {
    const EV = { strong: 3, moderate: 2, structural: 2, weak: 1 };
    const READY = { ready: 1, 'n/a': 1, unknown: 0.5, blocked: 0 };
    const items = hyps.map((h, i) => {
      const fit = h.hook ? checkClientFit(opts.client || null, [h.hook])[0].status : 'n/a';
      const evidence = EV[h.evidence_strength] || 1;
      const effort = [1, 2, 3].includes(+h.effort) ? +h.effort : 2;
      const lintErrors = ((opts.lint || {})[h.name] || {}).errors || 0;
      const blockers = [];
      if (fit === 'blocked') blockers.push('клиент сказал, что это неправда');
      if (fit === 'unknown') blockers.push('факт клиента не подтверждён');
      if (lintErrors) blockers.push('ошибок в тексте: ' + lintErrors);
      return {
        name: h.name, hook: h.hook || null, variable_type: VARIABLE_TYPES.includes(h.variable_type) ? h.variable_type : 'creative',
        evidence_strength: h.evidence_strength || 'weak', evidence, effort, fit, lint_errors: lintErrors,
        score: Math.round(100 * evidence * READY[fit] * (lintErrors ? 0.5 : 1) / effort) / 100,
        launchable: blockers.length === 0, blockers, _i: i
      };
    });
    return items.sort((a, b) => (b.score - a.score) || (b.evidence - a.evidence) || (a._i - b._i))
      .map(({ _i, ...it }, rank) => ({ rank: rank + 1, ...it }));
  }

  // Rounds of at most opts.maxParallel (default 2) tests with different
  // variable types, so simultaneous tests do not confound each other ('hook'
  // and 'creative' both change the video: never in one round). Budget per test
  // = variants (2) x events per variant x client.target_cpa; 50 events is
  // TikTok's usual guideline for an ad group to leave the learning phase in
  // about a week (a rule of thumb, check the account), null without target_cpa.
  function planTests(ranked, opts = {}) {
    const client = opts.client || {};
    const events = opts.events || 50, variants = 2, maxParallel = opts.maxParallel || 2;
    const cpa = has(client.target_cpa) ? +client.target_cpa : null;
    const perTest = cpa === null ? null : Math.round(variants * events * cpa);
    const family = t => (t === 'hook' ? 'creative' : t);
    const queue = ranked.filter(r => r.score > 0);
    const excluded = ranked.filter(r => r.score === 0).map(r => ({ name: r.name, reason: r.blockers.join('; ') || 'score 0' }));
    const rounds = [];
    while (queue.length) {
      const round = [];
      for (let i = 0; i < queue.length && round.length < maxParallel;) {
        if (round.every(t => family(t.variable_type) !== family(queue[i].variable_type))) round.push(queue.splice(i, 1)[0]); else i++;
      }
      rounds.push({ round: rounds.length + 1, tests: round.map(t => ({ name: t.name, variable_type: t.variable_type, launchable: t.launchable, blockers: t.blockers })), budget: perTest === null ? null : perTest * round.length });
    }
    return { rounds, excluded, assumptions: { variants_per_test: variants, events_per_variant: events, target_cpa: cpa, per_test_budget: perTest, min_days_per_round: 7, max_parallel_tests: maxParallel, creative_refresh_days: '7–14' } };
  }

  // ---- The report --------------------------------------------------------------
  // rows: one source. opts: { now, longDays (60), activeDays (7), extraHooks,
  // baseHooks, noise, currency, country, cities: ['Warszawa', 'Warsaw'] }.
  function buildReport(rows, opts = {}) {
    rows = [...new Map(rows.map(r => [r.id, r])).values()];
    const source = opts.source || (rows[0] && rows[0].source) || 'library';
    return source === 'cc' ? buildCcReport(rows, opts) : buildLibraryReport(rows, opts);
  }

  const textOf = r => String(r.title || '').toLowerCase();
  const snip = r => String(r.title || '').replace(/\s+/g, ' ').slice(0, 160);
  const cnt = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const tally = (rs, f) => rs.reduce((m, r) => { const k = f(r); if (k !== '' && k !== null && k !== undefined) m[k] = (m[k] || 0) + 1; return m; }, {});
  const topShares = (rs, f, n) => Object.entries(tally(rs, f)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, share: share(v, rs.length) }));

  function priceBlock(rows, currency) {
    const amounts = [], pctOff = [];
    let adsWithPrice = 0;
    for (const r of rows) {
      const h = priceHits(textOf(r), currency);
      if (h.amounts.length) { adsWithPrice++; amounts.push(...h.amounts); }
      pctOff.push(...h.pctOff);
    }
    return { currency, ads_with_price: adsWithPrice, min: amounts.length ? Math.min(...amounts) : null, median: median(amounts), max: amounts.length ? Math.max(...amounts) : null, pct_off_mentions: pctOff.length, median_pct_off: median(pctOff) };
  }

  // Hook evidence counted per advertiser (key), with strength and examples.
  function hookEvidence(rowsAll, keyOf, opts, winnerRow, country) {
    const hp = hookPatterns(opts);
    const freq = {};
    for (const [k, p] of Object.entries(hp)) freq[k] = rowsAll.filter(r => p.test(textOf(r))).length;
    const kwText = [...new Set(rowsAll.flatMap(r => r.kws || []))].map(k => k.toLowerCase());
    const evidence = (re, rs) => {
      const m = rs.filter(r => re.test(textOf(r)));
      const byE = {};
      m.forEach(r => { const e = keyOf(r); byE[e] = (byE[e] || 0) + 1; });
      const ents = Object.entries(byE).sort((x, y) => y[1] - x[1]);
      const seenE = new Set();
      const examples = m.filter(r => !seenE.has(keyOf(r)) && seenE.add(keyOf(r))).slice(0, 3).map(r => ({ page: r.page || '', url: adUrl(r, country), text: snip(r) }));
      const advertisers = ents.length, top_share = m.length ? share(ents[0][1], m.length) : 0;
      let strength = strengthOf(advertisers, top_share);
      if (opts.capStrength && strength === 'strong') strength = 'moderate';
      return { ads: m.length, advertisers, top_advertiser: ents.length ? ents[0][0] : null, top_share, strength, circular: kwText.some(k => re.test(k)), examples };
    };
    const winRows = rowsAll.filter(winnerRow), restRows = rowsAll.filter(r => !winnerRow(r));
    const enough = winRows.length >= 5;
    const rank = { strong: 0, moderate: 1, weak: 2 };
    const underused = Object.entries(freq).map(([hook, n]) => ({ hook, ads: n, share: share(n, rowsAll.length), advertisers: evidence(hp[hook], rowsAll).advertisers, circular: kwText.some(k => hp[hook].test(k)) }))
      .filter(h => h.share <= 0.05).sort((x, y) => x.share - y.share).slice(0, 8);
    const winners = !enough ? [] : Object.entries(hp).map(([hook, re]) => {
      const l = winRows.filter(r => re.test(textOf(r))).length, o = restRows.filter(r => re.test(textOf(r))).length;
      const ls = share(l, winRows.length), os = share(o, restRows.length);
      return { hook, winner_ads: l, winner_share: ls, other_share: os, lift: os ? Math.round(10 * ls / os) / 10 : null, ...evidence(re, winRows) };
    }).filter(h => h.winner_ads >= 3 && (h.lift === null || h.lift >= 1.3)).sort((x, y) => (rank[x.strength] - rank[y.strength]) || (y.winner_share - x.winner_share)).slice(0, 6);
    return { freq, underused, winners, winRows, restRows, enough };
  }

  function buildLibraryReport(rows, opts) {
    const longDays = opts.longDays || 60, activeDays = opts.activeDays || 7;
    const now = opts.now || Date.now() / 1000;
    const country = opts.country || '';
    const cities = (opts.cities || []).map(c => String(c).toLowerCase()).filter(Boolean);
    const sinceStart = r => (r.start ? Math.round((now - r.start) / DAY) : null);
    const active = r => isActive(r, now, activeDays);
    const { uniqRows, copies, ukey } = uniqueTexts(rows);
    const doorOf = new Map(uniqRows.map(u => [ukey(u), classifyDoor(u)])); // a copy's door is its creative's
    const pages = {};
    for (const r of rows) {
      const p = pages[r.page] || (pages[r.page] = { page: r.page, adv_id: '', library_url: '', ads: 0, active_ads: 0, longest_run_days: 0, newest_days: Infinity, doors: new Set(), sites: new Set(), links: {}, objectives: new Set(), reach_max: '', tt_handle: '', tt_followers: null, adv_country: '', city_hits: 0 });
      p.ads++;
      if (active(r)) p.active_ads++;
      p.longest_run_days = Math.max(p.longest_run_days, runDays(r) || 0);
      if (sinceStart(r) !== null) p.newest_days = Math.min(p.newest_days, sinceStart(r));
      if (!p.adv_id && r.adv_id) { p.adv_id = r.adv_id; p.library_url = advertiserUrl(r.adv_id, country); }
      if (!p.tt_handle && r.tt_handle) p.tt_handle = r.tt_handle;
      if (Number.isFinite(r.tt_followers) && r.tt_followers !== null) p.tt_followers = Math.max(p.tt_followers || 0, r.tt_followers);
      if (!p.adv_country && r.adv_country) p.adv_country = r.adv_country;
      if (reachRank(r.reach) > reachRank(p.reach_max)) p.reach_max = r.reach;
      p.doors.add(doorOf.get(ukey(r)));
      if (r.objective) p.objectives.add(objectiveName(r.objective));
      const d = domainOf(r.link);
      if (d && isTrackerLink(r.link)) p.tracker = true; // ad-click tracker: not the site, never linked
      else if (d && classifyDoor(r) === 'Сайт') {
        p.sites.add(d);
        const u = unwrapUrl(r.link);
        if (u) { const k = u.origin + u.pathname; p.links[k] = (p.links[k] || 0) + 1; }
      }
      if (cities.length && cityHit(r, cities)) p.city_hits++;
    }
    const pageList = Object.values(pages).map(({ links, ...p }) => ({ ...p, newest_days: Number.isFinite(p.newest_days) ? p.newest_days : null,
      landing: Object.entries(links).sort((a, b) => b[1] - a[1])[0]?.[0] || '', platform: [...p.doors].length > 0 && [...p.doors].every(d => PLATFORM_DOORS.includes(d)),
      doors: [...p.doors].join(', '), sites: [...p.sites].join(', '), objectives: [...p.objectives].join(', ') }))
      .sort((a, b) => b.ads - a.ads || b.longest_run_days - a.longest_run_days);
    // Pages sharing an own site are one advertiser (merged for evidence).
    const bySite = {};
    for (const p of pageList) for (const s of p.sites.split(', ').filter(Boolean)) (bySite[s] = bySite[s] || []).push(p.page);
    const parent = {};
    const find = x => { if (parent[x] === undefined) parent[x] = x; return parent[x] === x ? x : (parent[x] = find(parent[x])); };
    for (const pgs of Object.values(bySite)) if (pgs.length >= 2) for (const q of pgs.slice(1)) parent[find(q)] = find(pgs[0]);
    const store_groups = Object.entries(bySite).filter(([, pgs]) => pgs.length >= 2).map(([site, pgs]) => ({ site, pages: pgs })).slice(0, 15);
    // Same copy on several pages (a network) or many times on one page (scaling a winner).
    const clusters = {};
    for (const r of rows) {
      const key = textOf(r).replace(/[^\p{L}\d]/gu, '').slice(0, 70);
      if (key.length < 20) continue;
      const c = clusters[key] || (clusters[key] = { text: snip(r), pages: new Set(), ads: 0, longest_run_days: 0 });
      c.pages.add(r.page); c.ads++; c.longest_run_days = Math.max(c.longest_run_days, runDays(r) || 0);
    }
    const clusterList = Object.values(clusters).map(c => ({ ...c, pages: [...c.pages] }));
    const creative_clusters = clusterList.filter(c => c.pages.length >= 2).sort((a, b) => b.pages.length - a.pages.length || b.ads - a.ads).slice(0, 15);
    const scaled_copies = clusterList.filter(c => c.pages.length === 1 && c.ads >= 3).sort((a, b) => b.ads - a.ads).slice(0, 15).map(c => ({ page: c.pages[0], copies: c.ads, longest_run_days: c.longest_run_days, text: c.text }));
    const noiseWords = (opts.noise || []).map(w => w.toLowerCase());
    const noiseCount = {};
    if (noiseWords.length) for (const r of rows) if (noiseWords.some(w => textOf(r).includes(w) || String(r.page).toLowerCase().includes(w))) noiseCount[r.page] = (noiseCount[r.page] || 0) + 1;
    const noise_candidates = Object.entries(noiseCount).map(([page, ads]) => ({ page, ads_matching: ads, ads_total: pages[page].ads })).sort((a, b) => b.ads_matching - a.ads_matching);
    const runBuckets = { '<7': 0, '7-30': 0, '30-60': 0, '60-180': 0, '>180': 0 };
    rows.forEach(r => { const d = runDays(r); if (d === null) return; runBuckets[d < 7 ? '<7' : d < 30 ? '7-30' : d < 60 ? '30-60' : d < 180 ? '60-180' : '>180']++; });
    const isLong = r => (runDays(r) || 0) >= longDays;
    // TikTok advertisers upload dozens of copies of one video (same text, new
    // ad id): hooks and long runs are counted on unique texts per advertiser,
    // the longest-running copy standing for the group.
    const perPage = {};
    const longrun = uniqRows.filter(isLong).sort((a, b) => (active(b) - active(a)) || (runDays(b) - runDays(a)))
      .filter(r => (perPage[r.page] = (perPage[r.page] || 0) + 1) <= 2).slice(0, 25)
      .map(r => ({ page: r.page, run_days: runDays(r), active: !!active(r), copies: copies[ukey(r)], reach: r.reach, objective: objectiveName(r.objective), door: classifyDoor(r), id: r.id, url: libraryAdUrl(r.id), text: snip(r) }));
    const seen = new Set();
    const samples = [...rows].sort((a, b) => (runDays(b) || 0) - (runDays(a) || 0)).filter(r => !seen.has(r.page) && seen.add(r.page)).slice(0, 35)
      .map(r => ({ page: r.page, run_days: runDays(r), url: libraryAdUrl(r.id), text: snip(r) }));
    const checked = rows.filter(r => r.details);
    const targeting = {
      ads_with_details: checked.length,
      age_bands: Object.fromEntries(AGE_BANDS.map(b => [b, share(checked.filter(r => String(r.ages).split('|').includes(b)).length, checked.length)])),
      under_25_only: checked.filter(r => r.ages && String(r.ages).split('|').every(b => ['13-17', '18-24'].includes(b))).length,
      gender: { female_only: checked.filter(r => r.genders === 'female').length, male_only: checked.filter(r => r.genders === 'male').length, both: checked.filter(r => r.genders === 'female|male').length },
      options_used: tally(checked.flatMap(r => String(r.targeting_used || '').split('|').filter(Boolean)), x => x),
      cities_targeted: checked.filter(r => r.target_cities).length,
      top_cities: topShares(checked.flatMap(r => String(r.target_cities || '').split('|').filter(Boolean).map(c => ({ c }))), o => o.c, 10),
      countries: tally(checked.flatMap(r => String(r.target_countries || '').split('|').filter(Boolean)), x => x)
    };
    const keyOf = r => find(r.page);
    const ev = hookEvidence(uniqRows, keyOf, opts, isLong, country);
    const currency = String(opts.currency || currencyForCountry(country) || 'EUR').toUpperCase();
    const prices = priceBlock(rows, currency);
    const longChecked = ev.winRows.filter(r => r.details);
    const hypothesis_inputs = {
      ads_analyzed: rows.length,
      unique_texts: uniqRows.length,
      long_running_ads: ev.winRows.length,
      long_days: longDays,
      enough_long_ads: ev.enough,
      underused_hooks: ev.underused,
      winner_hooks: ev.winners,
      winner_objectives: longChecked.length >= 5 ? topShares(longChecked, r => objectiveName(r.objective) || '(нет)', 3) : [],
      winner_ctas: longChecked.length >= 5 ? topShares(longChecked, r => r.cta || '(нет)', 3) : [],
      winner_doors: longChecked.length >= 5 ? topShares(longChecked, r => classifyDoor(r), 3) : [],
      price_anchors: { currency, median_price: prices.median, median_pct_off: prices.median_pct_off }
    };
    const geo = cities.length ? { cities: opts.cities, ads: rows.filter(r => cityHit(r, cities)).length, advertisers: pageList.filter(p => p.city_hits > 0).length } : null;
    return {
      source: 'library',
      ads: rows.length,
      unique_texts: uniqRows.length,
      advertisers: pageList.length,
      single_ad_advertisers: pageList.filter(p => p.ads === 1).length,
      status_counts: { active: rows.filter(active).length, not_shown_recently: rows.filter(r => !active(r)).length, active_days: activeDays },
      // Doors, CTAs and objectives per unique creative (copies of one video count once).
      doors: cnt(uniqRows.map(classifyDoor)),
      ctas: cnt(uniqRows.filter(r => r.details).map(r => r.cta || '(нет)')),
      objectives: cnt(uniqRows.filter(r => r.details).map(r => objectiveName(r.objective) || '(нет)')),
      creatives_with_details: uniqRows.filter(r => r.details).length,
      categories: cnt(rows.map(r => r.category || '?')),
      reach_buckets: cnt(rows.map(r => r.reach || '?')),
      run_buckets: runBuckets,
      targeting,
      geo,
      hook_freq: ev.freq,
      hypothesis_inputs,
      platform_pages: pageList.filter(p => p.platform).map(p => p.page),
      creative_clusters,
      scaled_copies,
      store_groups,
      noise_candidates,
      prices,
      top_pages: pageList.slice(0, 15),
      longrun,
      samples
    };
  }

  // Copies of one video (same advertiser, same text) as one creative. The
  // representative is a copy with details if any (its CTA, link and objective
  // stand for the group), else the longest-running one.
  const uniqueKey = r => (r.page || '') + '\u0001' + textOf(r).replace(/[^\p{L}\d]/gu, '').slice(0, 70);
  function uniqueTexts(rows) {
    const uniq = new Map(), copies = {};
    for (const r of [...rows].sort((a, b) => (b.details - a.details) || ((runDays(b) || 0) - (runDays(a) || 0)))) {
      const k = uniqueKey(r);
      copies[k] = (copies[k] || 0) + 1;
      if (!uniq.has(k)) uniq.set(k, r);
    }
    return { uniqRows: [...uniq.values()], copies, ukey: uniqueKey };
  }

  const REACH_ORDER = ['0-1K', '1K-10K', '10K-100K', '100K-1M', '1M-10M', '10M+'];
  function reachRank(s) {
    const t = String(s || '').toUpperCase().replace(/\s/g, '');
    const i = REACH_ORDER.findIndex(x => x.toUpperCase() === t);
    if (i >= 0) return i;
    const m = t.match(/^(\d+(?:\.\d+)?)([KMB]?)/);
    if (!m) return -1;
    const v = +m[1] * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1);
    return Math.log10(v + 1);
  }
  const cityHit = (r, cities) => cities.some(c => textOf(r).includes(c) || String(r.target_cities || '').toLowerCase().includes(c));

  function buildCcReport(rows, opts) {
    const country = opts.country || '';
    // No advertiser names: an ad counts as its brand, else its landing domain, else itself.
    const keyOf = r => r.page || domainOf(r.link) || 'ad:' + r.id;
    const isTop = r => r.ctr_top !== null && r.ctr_top !== undefined && r.ctr_top <= 0.2;
    const ev = hookEvidence(rows, keyOf, { ...opts, capStrength: true }, isTop, country);
    const currency = String(opts.currency || currencyForCountry(country) || 'USD').toUpperCase();
    const prices = priceBlock(rows, currency);
    const ctrs = rows.map(r => r.ctr_top).filter(x => x !== null && x !== undefined);
    const likes = rows.map(r => r.likes).filter(x => x !== null && x !== undefined);
    const durs = rows.map(r => r.duration).filter(x => x !== null && x !== undefined);
    const card = r => ({ id: r.id, url: ccAdUrl(r.id, country), category: r.category, objective: objectiveName(r.objective), ctr_top: r.ctr_top, likes: r.likes, cost_level: r.cost_level, duration: r.duration, door: classifyDoor(r), link: isTrackerLink(r.link) ? '' : r.link, text: snip(r) });
    const COST = COST_NAMES;
    const domains = tally(rows.filter(r => r.link && !isTrackerLink(r.link)), r => domainOf(r.link));
    return {
      source: 'cc',
      ads: rows.length,
      advertisers: new Set(rows.map(keyOf)).size,
      brands_named: rows.filter(r => r.page).length,
      with_landing: rows.filter(r => r.link).length,
      categories: cnt(rows.map(r => r.category || '?')),
      objectives: cnt(rows.map(r => objectiveName(r.objective) || '?')),
      doors: cnt(rows.map(classifyDoor)),
      budget_levels: cnt(rows.map(r => (r.cost_level === null || r.cost_level === undefined ? '?' : COST[r.cost_level] || String(r.cost_level)))),
      ctr: { ads: ctrs.length, median_top: median(ctrs), top20: rows.filter(isTop).length },
      likes: { median: median(likes), max: likes.length ? Math.max(...likes) : null },
      durations: cnt(durs.map(durationBucket)),
      median_duration: median(durs),
      landing_domains: Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([domain, ads]) => ({ domain, ads })),
      hook_freq: ev.freq,
      hypothesis_inputs: {
        ads_analyzed: rows.length,
        top_ctr_ads: ev.winRows.length,
        enough_top_ads: ev.enough,
        underused_hooks: ev.underused,
        winner_hooks: ev.winners,
        winner_objectives: ev.enough ? topShares(ev.winRows, r => objectiveName(r.objective) || '?', 3) : [],
        winner_durations: ev.enough ? topShares(ev.winRows.filter(r => r.duration !== null), r => durationBucket(r.duration), 3) : [],
        price_anchors: { currency, median_price: prices.median, median_pct_off: prices.median_pct_off }
      },
      prices,
      top_by_ctr: rows.filter(r => r.ctr_top !== null).sort((a, b) => a.ctr_top - b.ctr_top || (b.likes || 0) - (a.likes || 0)).slice(0, 20).map(card),
      top_by_likes: rows.filter(r => r.likes !== null).sort((a, b) => b.likes - a.likes).slice(0, 10).map(card),
      samples: rows.slice(0, 40).map(card)
    };
  }

  // ---- Comparing two snapshots -------------------------------------------------
  // prev/curr: rows of two snapshots of the same queries. opts: { prevTs,
  // currTs, activeDays (7), cappedPrev, cappedCurr (queries whose list was cut),
  // hookOpts, source }. The Ad Library shows first/last shown dates, so a stop
  // is seen directly: an ad still listed whose last show is older than
  // activeDays. An ad missing from the newer list is only "gone from the
  // results" — confident when none of its queries was cut in either run.
  function diffSnapshots(prev, curr, opts = {}) {
    const src = opts.source || (curr[0] || prev[0] || {}).source || 'library';
    return src === 'cc' ? diffCc(prev, curr, opts) : diffLibrary(prev, curr, opts);
  }

  const spreadOf = rs => {
    const by = {};
    rs.forEach(r => { const k = r.page || domainOf(r.link) || 'ad:' + r.id; by[k] = (by[k] || 0) + 1; });
    const e = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const top_share = rs.length ? share(e[0][1], rs.length) : 0;
    return { advertisers: e.length, top_advertiser: e.length ? e[0][0] : null, top_share, strength: strengthOf(e.length, top_share) };
  };

  function diffLibrary(prev, curr, opts) {
    const activeDays = opts.activeDays || 7;
    const { prevTs, currTs } = opts;
    const interval_days = Math.round((currTs - prevTs) / DAY);
    const P = new Map(prev.map(r => [r.id, r])), C = new Map(curr.map(r => [r.id, r]));
    const capped = new Set([...(opts.cappedPrev || []), ...(opts.cappedCurr || [])]);
    const currQueries = new Set(curr.flatMap(r => r.kws || []));
    const surely = r => (r.kws || []).some(k => currQueries.has(k)) && !(r.kws || []).some(k => capped.has(k));
    const activeAt = (r, ts) => !!(r && r.last && ts - r.last <= activeDays * DAY);
    const snipD = r => String(r.title || '').replace(/\s+/g, ' ').slice(0, 140);
    // Ads.
    const confirmed = prev.filter(r => activeAt(r, prevTs) && C.has(r.id) && !activeAt(C.get(r.id), currTs)).map(r => C.get(r.id));
    const missing = prev.filter(r => !C.has(r.id)).map(r => ({ page: r.page, id: r.id, url: libraryAdUrl(r.id), confidence: surely(r) ? 'high' : 'low', text: snipD(r) }));
    const fresh = curr.filter(r => !P.has(r.id));
    // Creatives (copies of one video together).
    const group = rows => { const m = new Map(); for (const r of rows) { const k = uniqueKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const GP = group(prev), GC = group(curr);
    const repOf = rs => [...rs].sort((a, b) => (b.details - a.details) || ((runDays(b) || 0) - (runDays(a) || 0)))[0];
    const anyActive = (rs, ts) => rs.some(r => activeAt(r, ts));
    const creativeState = k => {
      const c = GC.get(k);
      if (c) return anyActive(c, currTs) ? 'running' : 'stopped';
      return (GP.get(k) || []).some(surely) ? 'gone' : 'unknown';
    };
    const newCreatives = [...GC.keys()].filter(k => !GP.has(k)).map(k => ({ k, rs: GC.get(k) }));
    const scaling = [...GC.keys()].filter(k => GP.has(k) && GC.get(k).length - GP.get(k).length >= 2)
      .map(k => { const r = repOf(GC.get(k)); return { page: r.page, copies_prev: GP.get(k).length, copies_curr: GC.get(k).length, run_days: runDays(r), url: libraryAdUrl(r.id), text: snipD(r), _r: r }; })
      .sort((a, b) => (b.copies_curr - b.copies_prev) - (a.copies_curr - a.copies_prev));
    // Young tests: creatives running at the first snapshot, started < 30 days before it.
    const young = [...GP.entries()].filter(([, rs]) => anyActive(rs, prevTs) && Math.min(...rs.map(r => r.start || prevTs)) > prevTs - 30 * DAY).map(([k, rs]) => ({ k, rep: repOf(rs), state: creativeState(k) }));
    const youngGone = young.filter(y => y.state === 'stopped' || y.state === 'gone');
    const youngKept = young.filter(y => y.state === 'running');
    const stoppedCreatives = [...GP.keys()].filter(k => anyActive(GP.get(k), prevTs) && creativeState(k) === 'stopped')
      .map(k => { const r = repOf(GC.get(k)); return { page: r.page, run_days: runDays(r), copies: GC.get(k).length, url: libraryAdUrl(r.id), text: snipD(r) }; })
      .sort((a, b) => a.run_days - b.run_days);
    // Advertisers.
    const pagesOf = rows => rows.reduce((m, r) => (m[r.page] = (m[r.page] || 0) + 1, m), {});
    const pp = pagesOf(prev), pc = pagesOf(curr);
    const creativesOf = (G, page) => [...G.values()].filter(rs => rs[0].page === page).length;
    const newPages = Object.keys(pc).filter(p => !(p in pp)).map(p => ({ page: p, ads: pc[p], creatives: creativesOf(GC, p) })).sort((a, b) => b.ads - a.ads);
    // An advertiser stopped: it ran at the first snapshot and now either is listed
    // with nothing shown in the last activeDays (confirmed), or all its ads left
    // the results while their queries were not cut (high). Otherwise it may just
    // have dropped out of the top: listed separately, not called stopped.
    const ranBefore = p => prev.some(r => r.page === p && activeAt(r, prevTs));
    const gonePages = Object.keys(pp).filter(ranBefore).map(p => {
      if (p in pc) return curr.some(r => r.page === p && activeAt(r, currTs)) ? null : { page: p, confidence: 'confirmed' };
      return { page: p, confidence: prev.filter(r => r.page === p).every(surely) ? 'high' : 'low' };
    }).filter(Boolean);
    const grew = Object.keys(pc).filter(p => p in pp && creativesOf(GC, p) - creativesOf(GP, p) >= 2)
      .map(p => ({ page: p, creatives_prev: creativesOf(GP, p), creatives_curr: creativesOf(GC, p) }));
    // Dynamics for hypotheses: hooks per advertiser with strength.
    const hooks = hookPatterns(opts.hookOpts || {});
    const enoughFailures = young.length >= 12 && youngGone.length >= 4;
    const doorMix = G => { const m = {}; let n = 0; for (const rs of G.values()) { const d = classifyDoor(repOf(rs)); m[d] = (m[d] || 0) + 1; n++; } return { m, n }; };
    const [dp, dc] = [doorMix(GP), doorMix(GC)];
    const dynamics = {
      failed_hooks_enough_data: enoughFailures,
      failed_hooks: !enoughFailures ? [] : Object.entries(hooks).map(([hook, re]) => {
        const g = youngGone.filter(y => re.test(textOf(y.rep))).map(y => y.rep), kp = youngKept.filter(y => re.test(textOf(y.rep)));
        const gs = share(g.length, youngGone.length), ks = share(kp.length, youngKept.length);
        return { hook, gone: g.length, gone_share: gs, kept_share: ks, lift: ks ? Math.round(10 * gs / ks) / 10 : null, ...spreadOf(g) };
      }).filter(h => h.gone >= 2 && (h.lift === null || h.lift >= 1.5)).sort((a, b) => b.gone_share - a.gone_share).slice(0, 6),
      scaling_hooks: Object.entries(hooks).map(([hook, re]) => { const m = scaling.filter(s => re.test(textOf(s._r))).map(s => s._r); return { hook, creatives: m.length, ...spreadOf(m) }; })
        .filter(h => h.creatives >= 1).sort((a, b) => b.creatives - a.creatives).slice(0, 6),
      new_entrants: newPages.filter(p => p.creatives >= 1).slice(0, 8).map(p => {
        const rs = [...GC.values()].filter(g => g[0].page === p.page).map(repOf);
        return { page: p.page, ads: p.ads, creatives: p.creatives, hooks: Object.entries(hooks).filter(([, re]) => rs.some(r => re.test(textOf(r)))).map(([h]) => h), doors: [...new Set(rs.map(classifyDoor))], example: snipD(rs[0]), url: libraryAdUrl(rs[0].id) };
      }),
      door_shift: [...new Set([...Object.keys(dp.m), ...Object.keys(dc.m)])].filter(d => d !== 'Не проверено')
        .map(door => ({ door, prev_share: share(dp.m[door] || 0, dp.n), curr_share: share(dc.m[door] || 0, dc.n) }))
        .filter(f => Math.abs(f.curr_share - f.prev_share) >= 0.05)
    };
    return {
      source: 'library', interval_days,
      prev_ads: prev.length, curr_ads: curr.length, prev_creatives: GP.size, curr_creatives: GC.size,
      survived_ads: curr.filter(r => P.has(r.id)).length,
      new_ads: fresh.length,
      new_creatives: { count: newCreatives.length, top: newCreatives.map(({ rs }) => ({ rs, r: repOf(rs) })).sort((a, b) => b.rs.length - a.rs.length).slice(0, 20).map(({ rs, r }) => ({ page: r.page, copies: rs.length, url: libraryAdUrl(r.id), text: snipD(r) })) },
      scaling: scaling.slice(0, 20).map(({ _r, ...s }) => s),
      stops: { confirmed_ads: confirmed.length, stopped_creatives: stoppedCreatives.slice(0, 25), missing_ads: missing.length, missing_high_confidence: missing.filter(m => m.confidence === 'high').length, missing_top: missing.slice(0, 15) },
      young_tests: { creatives: young.length, gone: youngGone.length, kept: youngKept.length, gone_share: young.length ? share(youngGone.length, young.length) : null, gone_run_days_median: median(youngGone.filter(y => y.state === 'stopped').map(y => runDays(repOf(GC.get(y.k))))) },
      pages: { new: newPages.slice(0, 25), gone: gonePages.filter(g => g.confidence !== 'low').slice(0, 25), missing: gonePages.filter(g => g.confidence === 'low').slice(0, 25), grew: grew.slice(0, 25) },
      dynamics
    };
  }

  // Creative Center: the curated top list changes; ids persist across runs.
  function diffCc(prev, curr, opts) {
    const country = opts.country || '';
    const P = new Map(prev.map(r => [r.id, r])), C = new Map(curr.map(r => [r.id, r]));
    const entered = curr.filter(r => !P.has(r.id)), dropped = prev.filter(r => !C.has(r.id));
    const kept = curr.filter(r => P.has(r.id));
    const hooks = hookPatterns(opts.hookOpts || {});
    const card = r => ({ id: r.id, url: ccAdUrl(r.id, country), ctr_top: r.ctr_top, likes: r.likes, text: String(r.title || '').slice(0, 140) });
    return {
      source: 'cc', interval_days: Math.round((opts.currTs - opts.prevTs) / DAY),
      prev_ads: prev.length, curr_ads: curr.length, kept: kept.length,
      entered: { count: entered.length, top: entered.filter(r => r.ctr_top !== null).sort((a, b) => a.ctr_top - b.ctr_top).slice(0, 15).map(card) },
      dropped: { count: dropped.length, note: 'Выпало из собранной части топа: могло опуститься ниже, а не перестать крутиться.' },
      likes_growth: kept.filter(r => r.likes !== null && P.get(r.id).likes !== null).map(r => ({ ...card(r), likes_prev: P.get(r.id).likes, growth: r.likes - P.get(r.id).likes })).sort((a, b) => b.growth - a.growth).slice(0, 10),
      dynamics: {
        hooks_new_vs_dropped: Object.entries(hooks).map(([hook, re]) => {
          const e = entered.filter(r => re.test(textOf(r))), d = dropped.filter(r => re.test(textOf(r)));
          return { hook, entered: e.length, entered_share: share(e.length, entered.length), dropped_share: share(d.length, dropped.length) };
        }).filter(h => h.entered >= 2 && Math.abs(h.entered_share - h.dropped_share) >= 0.1).sort((a, b) => (b.entered_share - b.dropped_share) - (a.entered_share - a.dropped_share)).slice(0, 8),
        duration_shift: { prev_median: median(prev.map(r => r.duration).filter(x => x !== null)), curr_median: median(curr.map(r => r.duration).filter(x => x !== null)) }
      }
    };
  }

  // ---- CSV ---------------------------------------------------------------------
  const CSV_COLS = ['id', 'source', 'page', 'adv_id', 'start', 'last', 'reach', 'category', 'objective', 'cta', 'link', 'title', 'kws', 'details', 'payer_differs', 'adv_country', 'tt_handle', 'tt_followers', 'target_countries', 'target_cities', 'ages', 'genders', 'audience_size', 'targeting_used', 'ctr_top', 'likes', 'comments', 'shares', 'cost_level', 'duration', 'image_url', 'video_url', 'image_urls', 'audit'];
  const isoDay = s => (s ? new Date(s * 1000).toISOString().slice(0, 10) : '');
  function toCsv(rows) {
    const esc = v => {
      let s = String(Array.isArray(v) ? v.join('; ') : (v ?? '')).replace(/\s+/g, ' ');
      // Ad text is untrusted: a leading = + - @ would be a formula in a spreadsheet.
      if (/^\s*[=+\-@]/.test(s)) s = "'" + s.trimStart();
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = rows.map(r => CSV_COLS.map(c => esc(c === 'start' || c === 'last' ? isoDay(r[c]) : r[c])).join(','));
    return [CSV_COLS.join(',')].concat(lines).join('\n');
  }
  function parseCsv(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const cols = lines[0].split(',');
    const field = v => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
    const numOrNull = v => (v === undefined || v === '' ? null : +v);
    return lines.slice(1).map(l => {
      const v = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(m => field(m[1].replace(/""/g, '"')));
      const o = {};
      cols.forEach((k, i) => { o[k] = v[i] ?? ''; });
      o.start = o.start ? Date.parse(o.start + 'T00:00:00Z') / 1000 : null;
      o.last = o.last ? Date.parse(o.last + 'T00:00:00Z') / 1000 : null;
      o.kws = (o.kws || '').split('; ').filter(Boolean);
      o.details = o.details === 'true';
      o.payer_differs = o.payer_differs === 'true' ? true : o.payer_differs === 'false' ? false : null;
      delete o.paid_by; // a column of old snapshots: payer names are not kept
      for (const k of ['tt_followers', 'ctr_top', 'likes', 'comments', 'shares', 'cost_level', 'duration']) o[k] = numOrNull(o[k]);
      return o;
    });
  }

  // ==========================================================================
  // Browser glue — window.__tti. Skipped outside a browser.
  // ==========================================================================
  function installBrowser() {
    if (typeof window === 'undefined') return null;
    if (window.__tti) return 'already installed: ' + Object.keys(window.__tti.store).length + ' ads in store';
    const T = window.__tti = { ads: {}, details: {}, ccDetailsRaw: {}, industries: {}, store: {}, totals: {}, lastTotal: null };
    const host = location.hostname;
    T.source = /library\.tiktok\.com$/.test(host) ? 'library' : /ads\.tiktok\.com$/.test(host) ? 'cc' : null;
    const eat = (url, t) => {
      let j;
      try { j = JSON.parse(t); } catch (e) { return; }
      if (/\/api\/v1\/search/.test(url) && Array.isArray(j.data)) {
        for (const it of j.data) if (it && it.id) T.ads[it.id] = { kind: 'library', it };
        if (Number.isFinite(j.total)) T.lastTotal = j.total;
      } else if (/\/api\/v1\/items\/(\d+)\/details/.test(url) && j.data) {
        T.details[url.match(/items\/(\d+)\//)[1]] = detailsFromJson(j);
      } else if (/top_ads\/v2\/list/.test(url) && j.data && Array.isArray(j.data.materials)) {
        for (const m of j.data.materials) if (m && m.id) T.ads[m.id] = { kind: 'cc', it: m };
        if (j.data.pagination && Number.isFinite(j.data.pagination.total_count)) T.lastTotal = j.data.pagination.total_count;
      } else if (/top_ads\/v2\/detail/.test(url) && j.data && j.data.id) {
        T.ccDetailsRaw[j.data.id] = j.data;
      } else if (/top_ads\/v2\/filters/.test(url) && j.data && Array.isArray(j.data.industry)) {
        for (const x of j.data.industry) T.industries[String(x.id)] = x.value;
      }
    };
    const watched = u => /\/api\/v1\/(search|items\/)|creative_radar_api\/v1\/top_ads\//.test(String(u));
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) {
      if (watched(u)) this.addEventListener('load', () => { try { eat(String(u), this.responseText); } catch (e) {} });
      return oo.call(this, m, u, ...r);
    };
    const of = window.fetch;
    window.fetch = async function (...a) {
      const r = await of.apply(this, a);
      try { const u = (a[0] && a[0].url) || String(a[0]); if (watched(u)) r.clone().text().then(t => eat(u, t)); } catch (e) {}
      return r;
    };
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const moreButton = () => (T.source === 'library'
      ? document.querySelector('.loading_more_text')
      : [...document.querySelectorAll('div,button,span')].find(e => e.children.length === 0 && /^view more$/i.test((e.textContent || '').trim())));
    // Search from page JS: React reads the input through the native setter.
    // Library: a phrase in double quotes is an exact-phrase search.
    T.search = async (q) => {
      const inp = T.source === 'library'
        ? document.querySelector('input[placeholder="Search by name or keyword"]')
        : document.querySelector('input[placeholder*="Search"]');
      if (!inp) return 'search field not found (is the page in English?)';
      T.ads = {}; T.lastTotal = null;
      const exact = T.source === 'library' && /^".+"$/.test(String(q).trim());
      const text = exact ? String(q).trim().slice(1, -1) : q;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      inp.focus(); set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(inp, text); inp.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(exact ? 1200 : 700);
      if (exact) {
        // The exact-phrase mode is the "Search this exact phrase" option of the
        // suggestion list; typed quotes alone search the words.
        const opt = document.querySelector('.exact_field_label_text_dark') || document.querySelector('.exact_field_label');
        if (!opt) return 'exact-phrase option not found';
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) opt.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        await sleep(600);
      }
      if (T.source === 'library') {
        const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Search');
        if (!btn) return 'search button not found';
        btn.click();
      } else {
        for (const type of ['keydown', 'keypress', 'keyup']) inp.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      for (let i = 0; i < 20 && T.lastTotal === null; i++) await sleep(500);
      return { query: q, total: T.lastTotal, buffered: Object.keys(T.ads).length };
    };
    // Creative Center: re-sorts the list ('For You', 'Reach', 'CTR'), which also
    // re-requests its first page (the way to capture the list after pasting
    // this script into an already loaded page). If the order is already active
    // and nothing is requested, it switches away and back.
    T.sort = async (label = 'For You') => {
      const item = l => [...document.querySelectorAll('[class*="sortItemLabel"]')].find(e => (e.textContent || '').trim() === l);
      const press = el => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
      const waitList = async () => { for (let i = 0; i < 16 && T.lastTotal === null; i++) await sleep(500); return T.lastTotal !== null; };
      const el = item(label);
      if (!el) return 'sort option "' + label + '" not found (Creative Center Top Ads page in English?)';
      T.ads = {}; T.lastTotal = null;
      press(el);
      if (!(await waitList())) {
        const other = item(label === 'Reach' ? 'For You' : 'Reach');
        if (other) { press(other); await waitList(); }
        T.ads = {}; T.lastTotal = null;
        press(el);
        await waitList();
      }
      return { order: label, total: T.lastTotal, buffered: Object.keys(T.ads).length };
    };
    // Clicks "View more" until maxAds are buffered or nothing new arrives.
    T.more = async (maxAds = 96) => {
      let idle = 0;
      while (Object.keys(T.ads).length < maxAds && idle < 2) {
        const b = moreButton();
        if (!b) break;
        const before = Object.keys(T.ads).length;
        b.click();
        await sleep(2200);
        idle = Object.keys(T.ads).length > before ? 0 : idle + 1;
      }
      // Capped: stopped at maxAds while the list still offers more.
      T.capped = !!moreButton() && Object.keys(T.ads).length >= maxAds;
      return Object.keys(T.ads).length + ' ads buffered' + (T.capped ? ' (more available)' : '');
    };
    T.collect = (kw) => {
      let n = 0;
      for (const [id, x] of Object.entries(T.ads)) {
        const rec = x.kind === 'cc' ? normalizeCcAd(x.it, kw, T.industries) : normalizeLibraryAd(x.it, kw);
        const prev = T.store[id];
        if (prev) { rec.kws = [...new Set([...(prev.kws || []), ...rec.kws])]; if (prev.details) Object.assign(rec, Object.fromEntries(Object.entries(prev).filter(([k]) => !['kws'].includes(k)))); }
        if (T.details[id]) Object.assign(rec, mergeDetails(rec, T.details[id]));
        if (T.ccDetailsRaw[id]) { const d = T.ccDetailsRaw[id]; Object.assign(rec, { link: httpOnly(d.landing_page) || rec.link, comments: d.comment ?? rec.comments, shares: d.share ?? rec.shares, details: true }); }
        T.store[id] = rec;
        n++;
      }
      const capped = !!T.capped && T.lastTotal !== null && n < T.lastTotal;
      if (kw) T.totals[kw] = T.lastTotal;
      T.ads = {}; T.capped = false;
      return { kw, captured: n, total_says: T.lastTotal, capped, total_unique: Object.keys(T.store).length };
    };
    // Details of Library ads, read from a hidden same-origin iframe (the UI
    // opens them in a new tab). One ad at a time with a pause.
    const frameText = async (src, ready, timeoutMs = 15000) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-5000px;top:0;width:1200px;height:900px';
      f.src = src;
      document.body.appendChild(f);
      let t = '';
      try {
        for (let w = 0; w < timeoutMs; w += 500) {
          await sleep(500);
          try { t = f.contentDocument.body.innerText; } catch (e) { t = ''; }
          if (ready(t)) break;
        }
      } finally { f.remove(); }
      return ready(t) ? t : '';
    };
    T.details = T.details || {};
    T.fetchDetails = async (ids, delayMs = 1500) => {
      let ok = 0, failed = 0;
      for (const id of (ids || []).slice(0, 60)) {
        if (!/^\d{1,25}$/.test(String(id))) continue;
        const t = await frameText('/ads/detail/?ad_id=' + id + '&lang=en', s => /Ad ID:\s*\d/.test(s) && /First shown:\s*\d/.test(s) && /Advertiser/.test(s));
        if (t && T.store[id]) { T.store[id] = mergeDetails(T.store[id], parseDetailText(t)); ok++; } else failed++;
        await sleep(delayMs);
      }
      return { ok, failed };
    };
    T.ccDetails = async (ids, delayMs = 1500) => {
      let ok = 0, failed = 0;
      const cc = new URLSearchParams(location.search).get('region') || '';
      for (const id of (ids || []).slice(0, 40)) {
        if (!/^\d{1,25}$/.test(String(id))) continue;
        const t = await frameText('/business/creativecenter/topads/' + id + '/pc/en?countryCode=' + cc, s => /Landing Page/.test(s) && /Ad caption/i.test(s));
        if (t && T.store[id]) { const d = parseCcDetailText(t); T.store[id] = { ...T.store[id], ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== '')), details: true }; ok++; } else failed++;
        await sleep(delayMs);
      }
      return { ok, failed };
    };
    // Which ads to open when only `limit` can be: per advertiser the longest run first, advertisers take turns.
    T.pickForDetails = (limit = 40) => pickForDetails(Object.values(T.store), limit);
    T.load = (records) => { for (const [id, rec] of Object.entries(records || {})) T.store[id] = rec; return Object.keys(T.store).length + ' in store'; };
    T.exclude = (names) => { let k = 0; for (const [id, r] of Object.entries(T.store)) if (names.includes(r.page) || names.includes(id)) { delete T.store[id]; k++; } return k + ' removed'; };
    T.buildQueries = buildQueries;
    T.detailsFromJson = detailsFromJson;
    T.siteFacts = siteFacts;
    T.compareAdVsSite = compareAdVsSite;
    T.pixelsIn = pixelsIn;
    T.sourceForCountry = sourceForCountry;
    T.langsForCountry = langsForCountry;
    T.currencyForCountry = currencyForCountry;
    T.videoFramePlan = videoFramePlan;
    T.aspectOf = aspectOf;
    T.report = (opts = {}) => buildReport(Object.values(T.store), opts);
    T.csv = () => toCsv(Object.values(T.store));
    return 'installed on ' + (T.source || 'an unknown page') + ': ' + Object.keys(T.ads).length + ' ads buffered';
  }

  // Ads to open for details: unchecked ones, the longest-running ad of every
  // advertiser first, then each advertiser's next one.
  function pickForDetails(rows, limit) {
    const byPage = new Map();
    const lib = rows.filter(r => r.source === 'library');
    const done = new Set(lib.filter(r => r.details).map(uniqueKey));
    const reps = uniqueTexts(lib.filter(r => !done.has(uniqueKey(r)))).uniqRows;
    for (const r of reps.sort((a, b) => (runDays(b) || 0) - (runDays(a) || 0))) {
      if (!byPage.has(r.page)) byPage.set(r.page, []);
      byPage.get(r.page).push(r.id);
    }
    const queues = [...byPage.values()];
    const out = [];
    for (let round = 0; out.length < limit; round++) {
      let any = false;
      for (const q of queues) if (round < q.length && out.length < limit) { out.push(q[round]); any = true; }
      if (!any) break;
    }
    return out;
  }

  const installResult = installBrowser();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      HOOK_PATTERNS, LIBRARY_COUNTRIES, isLibraryCountry, sourceForCountry, langsForCountry, currencyForCountry,
      domainOf, normalizeLibraryAd, detailsFromJson, parseDetailText, mergeDetails, normalizeCcAd, parseCcDetailText, objectiveName,
      buildQueries, classifyDoor, hookPatterns, priceHits, checkClientFit, serviceEconomics, CLIENT_RULES,
      applyCuration, queryStats, seasonWarnings, snapshotWarnings, nextSteps, suggestQueries, strengthOf,
      CREATIVE_TAGS, videoFramePlan, aspectOf, creativeMedia, selectCreatives, lintCreatives, creativesSummary,
      lintHypotheses, TIKTOK_CTAS, CC_INDUSTRIES, COST_NAMES, buildReport,
      siteFacts, compareAdVsSite, pixelsIn, isTrackerLink, payerDiffers, prioritizeHypotheses, planTests, VARIABLE_TYPES, diffSnapshots, runDays, isActive, reachRank, pickForDetails,
      toCsv, parseCsv, CSV_COLS, uniqueTexts, libraryAdUrl, ccAdUrl, adUrl, advertiserUrl
    };
  }

  return installResult;
})();
