(() => {
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
  document.querySelectorAll('script[type="application/json"]').forEach(s => eat(s.textContent));
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
  const pick = (x) => (x && typeof x === 'object') ? (x.text || '') : (x || '');
  M.scroll = async (n = 6) => {
    for (let i = 0; i < n; i++) { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 1200)); }
    window.scrollTo(0, 0);
    return Object.keys(M.ads).length + ' ads buffered';
  };
  M.collect = (kw) => {
    let n = 0;
    for (const [id, o] of Object.entries(M.ads)) {
      const s = o.snapshot || {}; const c = (s.cards && s.cards[0]) || {};
      const rec = M.store[id] || { kws: [] };
      Object.assign(rec, {
        id, page_id: o.page_id || s.page_id, page: o.page_name || s.page_name, active: o.is_active,
        start: o.start_date, end: o.end_date,
        title: pick(s.title) || pick(c.title), body: (pick(s.body) || pick(c.body) || '').slice(0, 500),
        cta: s.cta_text || c.cta_text || '', link: s.link_url || c.link_url || '',
        cats: (s.page_categories || []).join('|'), platforms: (o.publisher_platform || []).join('|'),
        fmt: s.display_format || '', variants: o.collation_count || 1
      });
      if (!rec.kws.includes(kw)) rec.kws.push(kw);
      M.store[id] = rec; n++;
    }
    M.ads = {};
    const shown = (document.body.innerText.match(/~?[\d,]+ results?/) || ['0 results'])[0];
    return { kw, captured: n, library_says: shown, total_unique: Object.keys(M.store).length };
  };
  M.exclude = (names) => { let k = 0; for (const [id, r] of Object.entries(M.store)) if (names.includes(r.page)) { delete M.store[id]; k++; } return k + ' removed'; };
  M.report = (opts = {}) => {
    const longDays = opts.longDays || 90;
    const rows = Object.values(M.store); const now = Date.now() / 1000;
    const age = r => Math.round((now - r.start) / 86400);
    const dom = u => { try { let x = new URL(u); if (/facebook\.com$/.test(x.hostname) && x.searchParams.get('u')) x = new URL(x.searchParams.get('u')); return x.hostname.replace(/^(www|l|m)\./, ''); } catch (e) { return ''; } };
    const door = r => {
      const d = dom(r.link);
      if (/whatsapp/i.test(r.cta) || d === 'wa.me' || d === 'api.whatsapp.com') return 'WhatsApp';
      if (/message/i.test(r.cta) || d === 'm.me') return 'Директ/Messenger';
      if (d === 't.me') return 'Telegram';
      if (d === 'instagram.com') return 'Instagram-профиль';
      if (/^(facebook\.com|fb\.com|fb\.me)$/.test(d)) return 'Facebook-страница';
      if (/call/i.test(r.cta)) return 'Звонок';
      if (d) return 'Сайт';
      return 'Без ссылки';
    };
    const cnt = a => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const pages = {};
    for (const r of rows) {
      const p = pages[r.page] || (pages[r.page] = { page: r.page, ads: 0, oldest_days: 0, newest_days: 1e9, doors: new Set(), sites: new Set(), cats: r.cats });
      p.ads++; p.oldest_days = Math.max(p.oldest_days, age(r)); p.newest_days = Math.min(p.newest_days, age(r));
      p.doors.add(door(r)); const d = dom(r.link); if (d && !/instagram|facebook|fb\.com|fb\.me|m\.me|wa\.me|t\.me/.test(d)) p.sites.add(d);
    }
    const pageList = Object.values(pages).map(p => ({ ...p, doors: [...p.doors].join(', '), sites: [...p.sites].join(', ') })).sort((a, b) => b.ads - a.ads);
    const text = r => ((r.title || '') + ' ' + (r.body || '')).toLowerCase();
    const pats = {
      'цена в грн': /\d[\d\s]*\s*(грн|₴|uah)/, 'процент/скидка': /(\d+\s*%|знижк|скидк|sale)/, 'акция': /(акці|акци)/,
      'первый визит': /(перш\S* (візит|процедур|знайомств)|перв\S* (визит|процедур|знакомств)|нов\S* клієнт|нов\S* клиент)/,
      'бесплатно': /(безкоштовн|бесплатн)/, 'подарок/сертификат': /(подарун|подарок|сертифікат|сертификат)/,
      'гарантия': /гарант/, 'отзывы/рейтинг': /(відгук|отзыв|рейтинг)/, 'опыт/годы': /(досвід|опыт|\d+\s*(років|лет|роки|года))/,
      'дедлайн/ограничение': /(тільки до|только до|до \d{1,2}[.\s]|залишилось|осталось|обмежен|ограничен)/,
      'рассрочка': /(розстроч|рассроч|частин)/, 'запись/бронь': /(запис|запиш|бронь|бронюй)/,
      'обучение/курсы': /(навчан|обучен|курс)/, 'до/после': /(до і після|до и после|before)/
    };
    const freq = {}; for (const [k, p] of Object.entries(pats)) freq[k] = rows.filter(r => p.test(text(r))).length;
    const buckets = { '<7': 0, '7-30': 0, '30-90': 0, '90-365': 0, '>365': 0 };
    rows.forEach(r => { const a = age(r); buckets[a < 7 ? '<7' : a < 30 ? '7-30' : a < 90 ? '30-90' : a < 365 ? '90-365' : '>365']++; });
    const snip = r => ((r.title ? r.title + ' | ' : '') + (r.body || '')).replace(/\s+/g, ' ').slice(0, 160);
    const longrun = rows.filter(r => age(r) >= longDays).sort((a, b) => a.start - b.start).slice(0, 25)
      .map(r => ({ page: r.page, days: age(r), fmt: r.fmt, variants: r.variants, door: door(r), id: r.id, text: snip(r) }));
    const seen = new Set();
    const samples = rows.filter(r => !seen.has(r.page) && seen.add(r.page)).slice(0, 35).map(r => ({ page: r.page, text: snip(r) }));
    return {
      ads: rows.length, advertisers: pageList.length, single_ad_advertisers: pageList.filter(p => p.ads === 1).length,
      doors: cnt(rows.map(door)), ctas: cnt(rows.map(r => r.cta || '(нет)')),
      platforms: cnt(rows.flatMap(r => (r.platforms || '').split('|').filter(Boolean))), formats: cnt(rows.map(r => r.fmt || '?')),
      age_buckets: buckets, hook_freq: freq, top_pages: pageList.slice(0, 15), longrun, samples
    };
  };
  M.csv = () => {
    const cols = ['id', 'page', 'start', 'active', 'fmt', 'variants', 'cta', 'link', 'platforms', 'kws', 'title', 'body'];
    const esc = v => '"' + String(Array.isArray(v) ? v.join('; ') : (v ?? '')).replace(/"/g, '""').replace(/\s+/g, ' ') + '"';
    return [cols.join(',')].concat(Object.values(M.store).map(r => cols.map(c => esc(c === 'start' ? new Date(r.start * 1000).toISOString().slice(0, 10) : r[c])).join(','))).join('\n');
  };
  return 'installed: ' + Object.keys(M.ads).length + ' ads buffered from first page';
})()
