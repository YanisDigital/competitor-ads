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
    'до/после': /(до і після|до и после|before.*after)/
  };

  // ==========================================================================
  // Pure functions — no DOM/window access, safe to unit-test in Node.
  // ==========================================================================

  const pick = (x) => (x && typeof x === 'object') ? (x.text || '') : (x || '');

  // Resolves an Ads Library link to a bare domain, unwrapping the
  // l.facebook.com/l.php?u=... redirect wrapper along the way.
  function domainOf(u) {
    try {
      let x = new URL(u);
      if (/facebook\.com$/.test(x.hostname) && x.searchParams.get('u')) x = new URL(x.searchParams.get('u'));
      return x.hostname.replace(/^(www|l|m)\./, '');
    } catch (e) {
      return '';
    }
  }

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
    return {
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
    if (d === 't.me') return 'Telegram';
    if (d === 'm.me' || /message/i.test(cta)) return 'Директ/Messenger';
    if (d === 'instagram.com') return 'Instagram-профиль';
    if (/^(facebook\.com|fb\.com|fb\.me)$/.test(d)) return 'Facebook-страница';
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
      if (d && !/instagram|facebook|fb\.com|fb\.me|m\.me|wa\.me|t\.me/.test(d)) p.sites.add(d);
    }
    const pageList = Object.values(pages)
      .map(p => ({ ...p, doors: [...p.doors].join(', '), sites: [...p.sites].join(', ') }))
      .sort((a, b) => b.ads - a.ads);
    const text = r => ((r.title || '') + ' ' + (r.body || '')).toLowerCase();
    const freq = {};
    for (const [k, p] of Object.entries(HOOK_PATTERNS)) freq[k] = rows.filter(r => p.test(text(r))).length;
    const buckets = { '<7': 0, '7-30': 0, '30-90': 0, '90-365': 0, '>365': 0 };
    rows.forEach(r => { const a = age(r); buckets[a < 7 ? '<7' : a < 30 ? '7-30' : a < 90 ? '30-90' : a < 365 ? '90-365' : '>365']++; });
    const snip = r => ((r.title ? r.title + ' | ' : '') + (r.body || '')).replace(/\s+/g, ' ').slice(0, 160);
    // Max 2 longrun entries per advertiser, so one advertiser running many
    // copies of the same creative can't fill the whole list.
    const perPage = {};
    const longrun = rows.filter(r => age(r) >= longDays).sort((a, b) => a.start - b.start)
      .filter(r => (perPage[r.page] = (perPage[r.page] || 0) + 1) <= 2).slice(0, 25)
      .map(r => ({ page: r.page, days: age(r), fmt: r.fmt, variants: r.variants, door: classifyDoor(r), id: r.id, url: 'https://www.facebook.com/ads/library/?id=' + r.id, text: snip(r) }));
    // One sample per advertiser: the oldest ad, i.e. the most battle-tested one.
    const seen = new Set();
    const samples = [...rows].sort((a, b) => a.start - b.start)
      .filter(r => !seen.has(r.page) && seen.add(r.page)).slice(0, 35).map(r => ({ page: r.page, text: snip(r) }));
    // Prices in UAH mentioned in ad text; "X instead of Y" pairs give the typical discount.
    const amounts = [];
    const discounts = [];
    let adsWithPrice = 0;
    for (const r of rows) {
      const t = text(r);
      const found = [...t.matchAll(/(\d[\d\s]{0,6}\d|\d)\s*(?:грн|₴|uah|гривен|гривень)/g)].map(m => +m[1].replace(/\s/g, '')).filter(n => n >= 10 && n <= 100000);
      if (found.length) { adsWithPrice++; amounts.push(...found); }
      for (const m of t.matchAll(/(\d[\d\s]{0,6})\s*(?:грн|₴)?\s*\(?(?:замість|вместо|instead of)\s*(\d[\d\s]{0,6})/g)) {
        const nw = +m[1].replace(/\s/g, ''), old = +m[2].replace(/\s/g, '');
        if (old > nw && nw > 0) discounts.push(Math.round((1 - nw / old) * 100));
      }
    }
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
    const prices = {
      ads_with_price: adsWithPrice,
      min: amounts.length ? Math.min(...amounts) : null, median: med(amounts), max: amounts.length ? Math.max(...amounts) : null,
      discount_pairs: discounts.length, median_discount_pct: med(discounts)
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
      for (let i = 0; i < n && idle < 3; i++) {
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
    M.report = (opts = {}) => buildReport(Object.values(M.store), opts);
    M.csv = () => toCsv(Object.values(M.store));
    return 'installed: ' + Object.keys(M.ads).length + ' ads buffered from first page';
  }

  const installResult = installBrowser();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HOOK_PATTERNS, pick, domainOf, resultCountOf, firstNonEmptyCard, normalizeAd, classifyDoor, buildReport, toCsv };
  }

  return installResult;
})();
