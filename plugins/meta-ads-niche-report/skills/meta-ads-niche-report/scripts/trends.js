#!/usr/bin/env node
// Google Trends for a niche: how big and how seasonal the demand is, whether it grows, and which
// queries are rising. The page is read by trends.py (Playwright, no login, no unofficial library),
// which saves <folder>/trends/raw.json; everything that is computed lives here, in one place, so the
// numbers are the same however the raw file was made (CLI or by hand from the Explore CSV).
//
//   node trends.js <snapshot-folder>            raw.json -> <folder>/trends.json (+ a short summary)
//   node trends.js queries <snapshot-folder>    rising queries -> <folder>/trends/suggested-queries.txt
//
// As a module it exports the pure functions (summarize, seasonProfile, seasonAdvice, classifyRising,
// buildTrends) used by report.js, the exports and the tests.
//
// raw.json: { geo, hl, period, fetched_at, items: [{ phrase, timeline: [{t, v}], related_rising: [{query, value, label}],
//             related_top: [...], error? }] }   t = unix seconds of the week start, v = 0..100.
const fs = require('fs');
const path = require('path');

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

// ---- Google's response bodies -----------------------------------------------------------------
// The data endpoints answer with ")]}'," in front of the JSON.
function parseWidget(text) {
  const s = String(text || '');
  const i = s.indexOf('{');
  return i >= 0 ? JSON.parse(s.slice(i)) : null;
}

function timelinePoints(data) {
  const tl = ((data || {}).default || {}).timelineData || [];
  return tl.map(p => ({ t: +p.time || 0, v: Array.isArray(p.value) ? +p.value[0] || 0 : 0 }));
}

function relatedLists(data) {
  const ranked = ((data || {}).default || {}).rankedList || [];
  const conv = l => ((l || {}).rankedKeyword || []).map(k => ({ query: k.query || '', value: k.value, label: k.formattedValue || '' }));
  return { top: conv(ranked[0]), rising: conv(ranked[1]) };
}

// The related-queries answer (entries have "query"), not the related-topics one (entries have "topic").
function isQueriesWidget(data) {
  const ranked = ((data || {}).default || {}).rankedList || [];
  const entries = ranked.flatMap(l => l.rankedKeyword || []);
  return ranked.length > 0 && entries.every(k => 'query' in k) && !entries.some(k => 'topic' in k);
}

// ---- The curve --------------------------------------------------------------------------------
// points: weekly [{t, v}] oldest first (5 years = about 260 points). The main measure compares the last
// 52 weeks with the 52 before, which cancels the season; the last 13 weeks against the 13 before only
// say where the season is now.
function summarize(points) {
  const vals = (points || []).map(p => Math.max(0, Math.round(p.v)));
  const n = vals.length;
  if (n < 110 || Math.max(0, ...vals) === 0) return { status: 'insufficient', note: 'нет измеримого спроса в поиске', points: n };
  const last52 = vals.slice(-52), prev52 = vals.slice(-104, -52), older = vals.slice(0, -104);
  const nonzero = last52.filter(v => v > 0).length;
  if (nonzero < 10) return { status: 'insufficient', note: 'спрос слишком мал для измерения (меньше 10 недель с данными за последний год)', points: n };
  const a = mean(last52), b = mean(prev52);
  const growth = (a - b) / Math.max(b, 1);
  const recent = mean(vals.slice(-13)), before = mean(vals.slice(-26, -13));
  const peak = Math.max(...vals);
  const peakIdx = vals.lastIndexOf(peak);
  const peakAge = n - 1 - peakIdx;
  const out = { points: n, avg_52w: round(a, 1), avg_prev_52w: round(b, 1), growth_52w: round(growth), avg_13w: round(recent, 1),
    change_13w: round((recent - before) / Math.max(before, 1)), peak, peak_weeks_ago: peakAge, now_vs_peak: round(recent / peak), low_volume: nonzero < 30 };
  if (b < Math.max(1, 0.15 * a) && mean(older) < Math.max(1, 0.15 * a)) { out.status = 'new'; out.note = 'спрос появился только за последний год'; }
  else if (growth >= 0.3) { out.status = 'rising'; out.note = 'последние 52 недели на ' + Math.round(100 * growth) + '% выше предыдущих 52'; }
  else if (growth <= -0.3) { out.status = 'declining'; out.note = 'последние 52 недели на ' + Math.round(-100 * growth) + '% ниже предыдущих 52'; }
  else if (peakAge > 104 && recent < 0.5 * peak) { out.status = 'mature'; out.note = 'пик был ' + Math.floor(peakAge / 52) + ' г. назад, сейчас ' + Math.round(100 * recent / peak) + '% от пика'; }
  else if (mean(older) >= 0.5 * a) { out.status = 'established'; out.note = 'спрос ровный годами (зрелая ниша)'; }
  else { out.status = 'flat'; out.note = 'без заметных изменений год к году'; }
  if (out.low_volume) out.note += ' (мало данных: узкая фраза)';
  return out;
}

// ---- Seasonality ------------------------------------------------------------------------------
// The typical level of every calendar month (1.0 = the average month) over the last full years, and how
// steadily the same months repeat. Used to say whether the snapshot was taken in a high or a low season.
function seasonProfile(points, opts = {}) {
  const pts = (points || []).filter(p => p.t > 0);
  if (pts.length < 110) return null;
  const lastT = pts[pts.length - 1].t;
  const lastDate = new Date(lastT * 1000);
  // the last incomplete month is left out: it would pull its month down
  const cut = Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), 1) / 1000;
  const usable = pts.filter(p => p.t < cut);
  const byYear = {};
  for (const p of usable) {
    const d = new Date(p.t * 1000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    ((byYear[y] = byYear[y] || Array.from({ length: 12 }, () => []))[m]).push(p.v);
  }
  const years = Object.keys(byYear).map(Number).filter(y => byYear[y].every(m => m.length >= 3)).sort((x, y) => y - x).slice(0, opts.years || 3);
  if (years.length < 2) return null;
  const perYear = years.map(y => {
    const m = byYear[y].map(mean);
    const avg = mean(m);
    return avg > 0 ? m.map(v => v / avg) : null;
  }).filter(Boolean);
  if (perYear.length < 2) return null;
  const months = Array.from({ length: 12 }, (_, i) => round(mean(perYear.map(y => y[i]))));
  const peak = months.indexOf(Math.max(...months)), low = months.indexOf(Math.min(...months));
  const strength = round(Math.max(...months) - Math.min(...months));
  const near = (a, b) => Math.min((a - b + 12) % 12, (b - a + 12) % 12) <= 1;
  const sameMonthYears = perYear.filter(y => near(y.indexOf(Math.max(...y)), peak)).length;
  return { years, months, peak_month: peak + 1, low_month: low + 1, strength, consistent: sameMonthYears / perYear.length >= 2 / 3 && strength >= 0.4,
    peak_name: MONTHS_RU[peak], low_name: MONTHS_RU[low] };
}

// Where the snapshot (or "now") sits in the season: 'peak' (≥ 1.2 of the average month), 'low' (≤ 0.8), else 'normal'.
function seasonAdvice(profile, nowTs) {
  if (!profile || !profile.consistent) return null;
  const month = new Date((nowTs || Date.now() / 1000) * 1000).getUTCMonth();
  const idx = profile.months[month];
  const level = idx >= 1.2 ? 'peak' : idx <= 0.8 ? 'low' : 'normal';
  const toPeak = (profile.peak_month - 1 - month + 12) % 12;
  return { month: month + 1, month_name: MONTHS_RU[month], index: idx, level, months_to_peak: toPeak,
    note: level === 'peak' ? 'сезон высокого спроса (' + MONTHS_RU[month] + ': ' + Math.round(idx * 100) + '% от средней нормы): реклама конкурентов частично сезонная и временная'
      : level === 'low' ? 'сезон низкого спроса (' + MONTHS_RU[month] + ': ' + Math.round(idx * 100) + '% от нормы): реклама конкурентов сейчас тише обычного, пик спроса — ' + profile.peak_name + ' (через ' + toPeak + ' мес.)'
        : 'спрос в норме (' + MONTHS_RU[month] + ': ' + Math.round(idx * 100) + '% от нормы), пик спроса — ' + profile.peak_name };
}

// ---- Rising queries ---------------------------------------------------------------------------
const NEARBY = /\b(near me|nearby|поруч|рядом|біля мене|возле меня)\b/i;
const ANGLE = /(ціна|цена|ціни|цены|вартість|стоимост|недорог|дешев|безкоштовн|бесплатн|розстрочк|рассрочк|кредит|акці|акци|знижк|скидк|відгук|отзыв|безболісн|безболезн|терміново|срочно|цілодобов|круглосуточ|гарант|під ключ|под ключ|за день|за 1 день|відразу|сразу|без запис|без записи|вихідн|выходн|вечор|вечер)/i;
const WEB_NOISE = /(\b(reddit|youtube|tiktok|instagram|wikipedia|вікіпедія|википедия|google|гугл)\b|\b20\d\d\b|\bpdf\b|\bскачати\b|\bскачать\b|\bреферат\b)/i;

// Rising and Breakout related queries split into two uses:
//  queries - service phrases to search in the Ad Library next (2-6 words, no noise, no "near me")
//  angles  - queries that show what people want to know (price, reviews, instalments, "painless"...):
//            ideas for hooks and offers, not search queries
function classifyRising(rising, seed, opts = {}) {
  const noise = (opts.noise || []).map(w => String(w).toLowerCase());
  const seen = new Set();
  const queries = [], angles = [];
  for (const r of rising || []) {
    const q = String(r.query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q || seen.has(q) || q === String(seed || '').toLowerCase() || NEARBY.test(q) || WEB_NOISE.test(q)) continue;
    const words = q.split(' ');
    if (words.length > 7 || words.some(w => noise.includes(w))) continue;
    seen.add(q);
    const item = { query: q, label: r.label || '', value: r.value, seed: seed || '' };
    if (ANGLE.test(q)) angles.push(item); else if (words.length >= 2) queries.push(item);
  }
  const rank = (a, b) => (/breakout/i.test(b.label) - /breakout/i.test(a.label)) || ((b.value || 0) - (a.value || 0));
  return { queries: queries.sort(rank).slice(0, opts.limit || 8), angles: angles.sort(rank).slice(0, opts.limit || 8) };
}

// ---- trends.json ------------------------------------------------------------------------------
// raw: the contents of raw.json. opts: { noise, now }. The niche level fields come from the phrases that
// have the most measurable demand (a narrow phrase says little about the whole niche).
function buildTrends(raw, opts = {}) {
  const now = opts.now || Date.now() / 1000;
  const phrases = [];
  for (const it of (raw && raw.items) || []) {
    if (it.error) { phrases.push({ phrase: it.phrase, status: 'error', note: it.error }); continue; }
    const pts = it.timeline || [];
    const s = summarize(pts);
    const season = seasonProfile(pts);
    const adv = seasonAdvice(season, now);
    const cls = classifyRising(it.related_rising, it.phrase, { noise: opts.noise });
    phrases.push({ phrase: it.phrase, ...s, season, season_now: adv, rising_queries: cls.queries, rising_angles: cls.angles,
      top_related: (it.related_top || []).slice(0, 5).map(r => r.query), sparkline: pts.slice(-52).map(p => p.v), _avg: s.avg_52w || 0 });
  }
  const measurable = phrases.filter(p => p.status && !['insufficient', 'error'].includes(p.status));
  const lead = measurable.slice().sort((a, b) => b._avg - a._avg).slice(0, 3);
  const counts = {};
  for (const p of phrases) counts[p.status] = (counts[p.status] || 0) + 1;
  const withSeason = lead.filter(p => p.season && p.season.consistent);
  const niche = {
    measurable: measurable.length, total: phrases.length, by_status: counts,
    direction: !lead.length ? 'insufficient' : mean(lead.map(p => p.growth_52w)) >= 0.15 ? 'growing' : mean(lead.map(p => p.growth_52w)) <= -0.15 ? 'shrinking' : 'steady',
    growth_52w: lead.length ? round(mean(lead.map(p => p.growth_52w))) : null,
    lead_phrases: lead.map(p => p.phrase),
    season: withSeason.length ? { peak_month: withSeason[0].season.peak_month, peak_name: withSeason[0].season.peak_name, low_month: withSeason[0].season.low_month, low_name: withSeason[0].season.low_name,
      strength: withSeason[0].season.strength, from: withSeason[0].phrase } : null,
    season_now: withSeason.length ? withSeason[0].season_now : null
  };
  for (const p of phrases) delete p._avg;
  return { geo: (raw && raw.geo) || '', hl: (raw && raw.hl) || '', period: (raw && raw.period) || '', fetched_at: (raw && raw.fetched_at) || '', niche, phrases };
}

// All rising service phrases of a trends.json, de-duplicated, for the next Ad Library run.
function suggestedQueries(trends, limit = 15) {
  const out = [], seen = new Set();
  for (const p of (trends && trends.phrases) || []) for (const q of p.rising_queries || []) if (!seen.has(q.query)) { seen.add(q.query); out.push(q); }
  return out.sort((a, b) => (/breakout/i.test(b.label) - /breakout/i.test(a.label)) || ((b.value || 0) - (a.value || 0))).slice(0, limit);
}

module.exports = { parseWidget, timelinePoints, relatedLists, isQueriesWidget, summarize, seasonProfile, seasonAdvice, classifyRising, buildTrends, suggestedQueries, MONTHS_RU };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sub = args[0] === 'queries' ? 'queries' : 'build';
  const dir = sub === 'queries' ? args[1] : args[0];
  const rawFile = dir && path.join(dir, 'trends', 'raw.json');
  if (!dir || !fs.existsSync(rawFile)) {
    console.error('Usage: node trends.js <snapshot-folder> | node trends.js queries <snapshot-folder>\n(needs <folder>/trends/raw.json from trends.py)');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  let noise = [];
  try {
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    if (run.preset && /^[a-z0-9-]+$/.test(run.preset)) noise = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', run.preset + '.json'), 'utf8')).noise) || [];
  } catch (e) { /* no run.json or preset: no noise words */ }
  const t = buildTrends(raw, { noise, now: raw.fetched_at ? Date.parse(raw.fetched_at) / 1000 : undefined });
  if (sub === 'queries') {
    const qs = suggestedQueries(t);
    const f = path.join(dir, 'trends', 'suggested-queries.txt');
    fs.writeFileSync(f, qs.map(q => q.query).join('\n') + (qs.length ? '\n' : ''), 'utf8');
    console.log(qs.length ? qs.map(q => `  ${q.query} (${q.label || '-'}) <- ${q.seed}`).join('\n') + '\nSaved: ' + f : 'No rising service phrases this time.');
  } else {
    fs.writeFileSync(path.join(dir, 'trends.json'), JSON.stringify(t, null, 2) + '\n', 'utf8');
    const n = t.niche;
    console.log(`Trends (${t.geo || '?'}): ${n.measurable} of ${n.total} phrases measurable; demand ${n.direction}` + (n.growth_52w !== null ? ` (${Math.round(n.growth_52w * 100)}% year on year)` : '') + (n.season ? `; peak ${n.season.peak_name}, low ${n.season.low_name}` : ''));
    for (const p of t.phrases) console.log(`  ${p.phrase}: ${p.status}${p.note ? ' (' + p.note + ')' : ''}`);
    console.log('Saved: ' + path.join(dir, 'trends.json'));
  }
}
