#!/usr/bin/env node
// Writes ONE self-contained HTML report for a TikTok snapshot folder: no
// external files, fonts, images or scripts (charts are CSS, thumbnails are
// data: URIs, a Content-Security-Policy forbids everything else). Made to be
// shared, so: no client.json file, no payer names (private persons; they are
// not stored at all), no budget and target CPA of the test plan (the client's
// numbers; --with-budget adds them), links to third-party sites without their
// query string (ttclid, utm_*: a click would count in a competitor's analytics).
// The hypotheses do contain the facts the client confirmed for the ad text.
// Sections appear when their files exist: creatives/manifest.json
// (+ creatives.json), hypotheses.json (+ hypotheses_lint.json, test_plan.json),
// sites.json (leaders' landing pages), diff.json (changes). It always
// ends with "what else can be done" (next_steps from report.js).
//
//   node export_html.js out/fitness-pl/2026-10-10 [--out report.html] [--no-images] [--with-budget]
//
// Every value comes from ad text or files a third party influences: all of it
// goes through esc(); links are limited to http(s).
const fs = require('fs');
const path = require('path');
const { CREATIVE_TAGS, CC_INDUSTRIES, COST_NAMES } = require('./collector.js');

const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Third-party link: scheme://host/path only, no credentials, query or fragment ('' when not http(s)).
const cleanUrl = u => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) && !x.username && !x.password ? x.origin + x.pathname : ''; } catch (e) { return ''; } };
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');
const link = (u, text) => (safeUrl(u) ? `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));
const extLink = (u, text) => link(cleanUrl(u), text);
const pct = (n, d) => (d ? Math.round(100 * n / d) : 0);
const num = n => (n === null || n === undefined || n === '' ? '-' : esc(n));
const bars = (title, entries, total) => `<section class="card"><h3>${esc(title)}</h3>${entries.length ? entries.map(([label, n]) =>
  `<div class="bar"><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${Math.min(100, pct(n, total))}%"></i></span><span class="bn">${esc(n)} <small>${pct(n, total)}%</small></span></div>`).join('') : '<p class="mut">нет данных</p>'}</section>`;
const table = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const chip = (text, kind) => `<span class="chip ${esc(kind || '')}">${esc(text)}</span>`;
const list = items => `<ul>${[].concat(items || []).filter(x => x !== undefined && x !== '').map(x => `<li>${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</li>`).join('')}</ul>`;
const sorted = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
const kpis = items => `<div class="cards">${items.map(([k, v]) => `<div class="card kpi"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`;

const CSS = `:root{--bg:#f6f7f9;--fg:#1c2330;--mut:#5b6577;--card:#fff;--line:#dfe3ea;--acc:#d6245a;--ok:#1b7f4b;--warn:#a86400;--err:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#12151b;--fg:#e6e9ef;--mut:#9aa4b6;--card:#1b2029;--line:#2a3140;--acc:#ff6f96;--ok:#5fd394;--warn:#f0b35a;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.25rem;margin:1.6em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.25em}h3{font-size:1rem;margin:.1em 0 .6em}
.mut{color:var(--mut)}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:1.6rem}.kpi span{color:var(--mut);font-size:.85rem}
.bar{display:grid;grid-template-columns:minmax(80px,1.2fr) 2fr minmax(60px,.8fr);gap:8px;align-items:center;margin:4px 0;font-size:.9rem}.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bt{background:var(--line);border-radius:4px;height:10px;overflow:hidden}.bt i{display:block;height:100%;background:var(--acc)}.bn{text-align:right}.bn small{color:var(--mut)}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--bg);white-space:nowrap}
a{color:var(--acc)}.chip{display:inline-block;max-width:100%;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:.78rem;margin:1px 2px 1px 0}.chip.error{color:var(--err);border-color:var(--err)}.chip.warn{color:var(--warn);border-color:var(--warn)}.chip.ok{color:var(--ok);border-color:var(--ok)}
.note{background:var(--card);border-left:4px solid var(--warn);padding:8px 12px;border-radius:6px;margin:10px 0;font-size:.9rem}.note.urgent{border-left-color:var(--err)}details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:8px 0}summary{cursor:pointer;font-weight:600}
dl{margin:.4em 0;display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:2px 12px}dt{color:var(--mut)}dd{margin:0;min-width:0;overflow-wrap:anywhere}@media(max-width:640px){dl{grid-template-columns:minmax(0,1fr)}dt{margin-top:.5em}}
.gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:12px}figure{margin:0;font-size:.85rem}figure.wide{grid-column:span 2}@media(max-width:420px){figure.wide{grid-column:auto}}img.cr{display:block;width:100%;height:auto;border-radius:6px;margin-bottom:6px}
@media print{body{background:#fff;color:#000}details>*{display:block}.card,.tw{break-inside:avoid}}`;

function hookSection(r) {
  const hi = r.hypothesis_inputs || {};
  const parts = [];
  const winLabel = r.source === 'cc' ? 'в топ-20% по CTR' : 'у долгожителей';
  if ((hi.winner_hooks || []).length) parts.push(`<section class="card"><h3>Чаще ${esc(winLabel)}</h3>${hi.winner_hooks.map(h =>
    `<p>${chip(h.hook)} ${chip(h.strength, h.strength === 'strong' ? 'ok' : h.strength === 'weak' ? 'warn' : '')} lift ${num(h.lift)} · ${esc(h.advertisers)} рекл.${h.circular ? ' ' + chip('круговой', 'warn') : ''}<br>${(h.examples || []).map(e => link(e.url, (e.page ? e.page + ': ' : '') + e.text.slice(0, 80))).join('<br>')}</p>`).join('')}</section>`);
  if ((hi.underused_hooks || []).length) parts.push(`<section class="card"><h3>Почти не используют</h3>${hi.underused_hooks.map(h => `<p>${chip(h.hook)} ${esc(Math.round(100 * h.share))}% · ${esc(h.advertisers)} рекл.${h.circular ? ' ' + chip('круговой', 'warn') : ''}</p>`).join('')}</section>`);
  return parts.length ? '<div class="grid">' + parts.join('') + '</div>' : '';
}

function buildHtml(m) {
  const { report: r, meta = {} } = m;
  const total = r.ads || 0;
  const dateStr = meta.ts ? new Date(meta.ts * 1000).toISOString().slice(0, 10) : '';
  const title = meta.preset_title || meta.preset || (meta.industry && CC_INDUSTRIES[meta.industry]) || (meta.queries || [])[0] || 'TikTok';
  const cc = r.source === 'cc';
  const srcName = cc ? 'TikTok Creative Center (Top Ads)' : 'TikTok Ad Library';
  const out = [];
  out.push(`<h1>${esc(srcName)}: ${esc(title)}</h1><p class="mut">Дата сбора: ${esc(dateStr)}${meta.country ? ' · страна: ' + esc(meta.country) : ''}${meta.queries ? ' · запросов: ' + esc(meta.queries.length) : ''}. ${cc ? 'Подборка топ-объявлений, которую делает TikTok: это «что работает в отрасли», а не вся реклама конкурентов.' : 'Поиск по тексту объявления и названию рекламодателя; собран верх выдачи по каждому запросу.'}</p>`);
  if ((meta.queries || []).length) out.push(`<p class="mut">Запросы: ${meta.queries.map(q => chip(q)).join('')}</p>`);
  const warnings = m.warnings || [];
  if (warnings.length) out.push(`<h2>Предупреждения</h2>${warnings.map(w => `<div class="note">${esc(w.message)}</div>`).join('')}`);
  const cur = meta.curation, types = (cur && cur.types) || {};
  if (cur) out.push(`<div class="note">Выборка проверена вручную (curation.json): убрано ${esc(cur.excluded_ads)} объявл.${(cur.excluded_pages || []).length ? ' от ' + esc(cur.excluded_pages.length) + ' рекламодателей' : ''}, осталось рекламодателей: ${esc(cur.kept_pages)}.${cur.notes ? ' ' + esc(cur.notes) : ''}</div>`);
  const pr = r.prices || {};
  const priceKpi = ['Медиана цены (' + (pr.ads_with_price || 0) + ' с ценой)', pr.median === null || pr.median === undefined ? '-' : pr.median + ' ' + (pr.currency || '')];

  if (!cc) {
    const hi = r.hypothesis_inputs || {};
    out.push(kpis([['Объявлений', total], ['Уникальных текстов', r.unique_texts], ['Рекламодателей', r.advertisers], ['С одним объявлением', pct(r.single_ad_advertisers, r.advertisers) + '%'],
      ['Показывались ≥ ' + (hi.long_days || 60) + ' дн.', hi.long_running_ads], ['С деталями (CTA, ссылка)', (r.targeting || {}).ads_with_details], priceKpi]));
    out.push('<h2>Структура рекламы</h2><div class="grid">');
    out.push(bars('Куда ведёт', sorted(r.doors), total));
    const checked = (r.targeting || {}).ads_with_details || 0;
    out.push(bars('Цель кампании (по деталям)', sorted(r.objectives), checked));
    out.push(bars('Кнопка CTA (по деталям)', sorted(r.ctas).slice(0, 8), checked));
    out.push(bars('Сколько дней показывалось', Object.entries(r.run_buckets || {}), total));
    out.push(bars('Охват (уникальных пользователей)', sorted(r.reach_buckets), total));
    out.push(bars('Категория (TikTok)', sorted(r.categories).slice(0, 8), total));
    out.push('</div>');
    const t = r.targeting || {};
    if (t.ads_with_details) {
      out.push(`<h2>Таргетинг (${esc(t.ads_with_details)} объявл. с деталями)</h2><div class="grid">`);
      out.push(bars('Возраст в таргетинге', Object.entries(t.age_bands || {}).map(([k, v]) => [k, Math.round(v * t.ads_with_details)]), t.ads_with_details));
      out.push(bars('Пол', [['женщины', t.gender.female_only], ['мужчины', t.gender.male_only], ['все', t.gender.both]], t.ads_with_details));
      out.push(bars('Сужение аудитории', sorted(t.options_used), t.ads_with_details));
      if ((t.top_cities || []).length) out.push(`<section class="card"><h3>Города и регионы в таргетинге</h3>${t.top_cities.map(c => chip(c.value + ' · ' + Math.round(100 * c.share) + '%')).join('')}<p class="mut">Город указан у ${esc(t.cities_targeted)} объявл.</p></section>`);
      out.push('</div>');
    }
    if (r.geo) out.push(`<div class="note">Город (${esc(r.geo.cities.join(', '))}) в тексте или таргетинге: ${esc(r.geo.ads)} объявл. у ${esc(r.geo.advertisers)} рекламодателей.</div>`);
    out.push('<h2>Хуки</h2>');
    out.push(`<div class="grid">${bars('Хуки в тексте (уникальные тексты)', sorted(r.hook_freq).filter(([, n]) => n > 0).slice(0, 14), r.unique_texts || total)}</div>`);
    out.push(hookSection(r));
    out.push('<p class="mut">Хуки считаются по уникальным текстам (копии одного ролика у рекламодателя — один текст). Сила сигнала — по рекламодателям: weak — приём одного-двух конкурентов, не тренд. «Круговой» — слова хука входят в поисковые запросы.</p>');
    out.push('<h2>Кто рекламируется (топ)</h2>');
    const hasTypes = Object.keys(types).length > 0;
    out.push(table(['Рекламодатель', ...(hasTypes ? ['Тип'] : []), 'TikTok', 'Объявл.', 'Активных', 'Дольше всего, дн.', 'Охват (макс.)', 'Куда ведёт', 'Сайт'], (r.top_pages || []).map(p => [
      link(p.library_url, p.page), ...(hasTypes ? [esc(types[p.page] || '')] : []), esc(p.tt_handle ? '@' + p.tt_handle + (p.tt_followers ? ' · ' + p.tt_followers : '') : ''),
      esc(p.ads), esc(p.active_ads), esc(p.longest_run_days), esc(p.reach_max), esc(p.doors), p.landing ? extLink(p.landing, p.sites) : esc(p.sites || (p.tracker ? 'через трекер кликов' : ''))
    ])));
    if ((r.longrun || []).length) {
      out.push('<h2>Долгожители</h2><p class="mut">Дольше всего показывались (первый–последний показ); не больше 2 на рекламодателя. Долгий показ — сильный сигнал, но не гарантия эффективности. «Копий» — сколько раз рекламодатель загрузил этот же текст.</p>');
      out.push(table(['Рекламодатель', 'Дней', 'Активно', 'Копий', 'Охват', 'Цель', 'Куда', 'Текст'], r.longrun.map(l => [esc(l.page), esc(l.run_days), l.active ? 'да' : 'нет', esc(l.copies), esc(l.reach), esc(l.objective), esc(l.door), link(l.url, l.text)])));
    }
    if ((r.scaled_copies || []).length || (r.creative_clusters || []).length) {
      out.push('<h2>Копии и сети</h2><div class="grid">');
      if (r.scaled_copies.length) out.push(`<section class="card"><h3>Один текст много раз (масштабирование)</h3>${r.scaled_copies.map(c => `<p><b>${esc(c.page)}</b>: ${esc(c.copies)} копий, до ${esc(c.longest_run_days)} дн.<br><span class="mut">${esc(c.text)}</span></p>`).join('')}</section>`);
      if (r.creative_clusters.length) out.push(`<section class="card"><h3>Один текст у разных рекламодателей</h3>${r.creative_clusters.map(c => `<p><b>${esc(c.pages.length)} рекл.</b>: ${esc(c.text)}<br><span class="mut">${esc(c.pages.join('; '))}</span></p>`).join('')}</section>`);
      out.push('</div>');
    }
  } else {
    out.push(kpis([['Топ-объявлений', total], ['В топ-20% по CTR', (r.ctr || {}).top20], ['Медиана CTR-перцентиля', r.ctr && r.ctr.median_top !== null ? 'топ ' + Math.round(100 * r.ctr.median_top) + '%' : '-'],
      ['Медиана лайков', num((r.likes || {}).median)], ['Медиана длины, с', num(r.median_duration)], ['С посадочной', r.with_landing], priceKpi]));
    out.push('<h2>Структура</h2><div class="grid">');
    out.push(bars('Подотрасль', sorted(r.categories).slice(0, 10), total));
    out.push(bars('Цель кампании', sorted(r.objectives), total));
    out.push(bars('Бюджет (уровень TikTok)', sorted(r.budget_levels), total));
    out.push(bars('Длина ролика, с', sorted(r.durations), total));
    out.push(bars('Куда ведёт', sorted(r.doors), total));
    out.push(bars('Хуки в тексте', sorted(r.hook_freq).filter(([, n]) => n > 0).slice(0, 12), total));
    out.push('</div>');
    out.push(hookSection(r));
    out.push('<p class="mut">CTR в Creative Center — перцентиль в отрасли: «топ 10%» лучше, чем «топ 60%». Рекламодатели скрыты, поэтому сила сигнала не выше moderate.</p>');
    out.push('<h2>Лучшие по CTR</h2>');
    out.push(table(['CTR', 'Лайки', 'Бюджет', 'Длина', 'Цель', 'Куда', 'Текст'], (r.top_by_ctr || []).map(c => ['топ ' + esc(Math.round(100 * c.ctr_top)) + '%', num(c.likes), esc(COST_NAMES[c.cost_level] || '-'), num(c.duration), esc(c.objective), c.link ? extLink(c.link, c.door) : esc(c.door), link(c.url, c.text || '(без текста)')])));
    if ((r.landing_domains || []).length) out.push('<h3>Посадочные домены</h3><p>' + r.landing_domains.map(d => chip(d.domain + ' · ' + d.ads)).join('') + '</p>');
  }

  if ((m.query_stats || []).length) {
    const curated = m.query_stats.some(q => q.relevant_advertisers !== null);
    out.push('<h2>Запросы</h2>' + table(['Запрос', 'Собрано', 'Всего в выдаче', 'Рекламодателей', ...(curated ? ['Из них конкуренты'] : []), 'Неполно'], m.query_stats.map(q => [
      esc(q.query), esc(q.ads), num(q.library_total), esc(q.advertisers), ...(curated ? [num(q.relevant_advertisers)] : []), q.capped ? chip('верх выдачи', 'warn') : ''])));
  }

  const v = m.visuals;
  if (v && v.items.length) {
    out.push(`<h2>Что в роликах</h2><p class="mut">Скачано ${esc(v.downloaded)}, размечено ${esc(v.labeled)} (${esc(v.advertisers)} рекламодателей/объявлений). Ролики разобраны по раскадровке: 0–3 с (хук), четверти и финал. Звук не анализировался. «Побед.» — ${cc ? 'в топ-20% по CTR' : 'долгожитель'}.</p>`);
    if (v.fields.length) out.push('<div class="grid">' + v.fields.map(f => `<section class="card"><h3>${esc(f.label)}</h3>${f.values.map(x =>
      `<div class="bar"><span class="bl">${esc(x.name)}</span><span class="bt"><i style="width:${Math.min(100, Math.round(100 * x.share))}%"></i></span><span class="bn">${esc(x.creatives)} <small>${esc(x.advertisers)} рекл.${x.strength ? ' · ' + esc(x.strength) : ''}${x.winners ? ' · побед. ' + esc(x.winners) : ''}</small></span></div>`).join('')}</section>`).join('') + '</div>');
    const tagChips = g => (!g.tags ? chip('не размечено', 'warn') : Object.entries(g.tags).map(([k, val]) => {
      const t = CREATIVE_TAGS[k] || {};
      if (typeof val === 'boolean') return val ? chip(t.label || k) : '';
      return [].concat(val).filter(x => x !== 'none').map(x => chip((t.names || {})[x] || x)).join('');
    }).join(''));
    out.push('<div class="gal">' + v.items.slice(0, 60).map(g => {
      const src = m.images && (m.images[g.thumbs[0]] || m.images[g.files[0]]);
      const meta2 = [g.video ? 'видео ' + Math.round(g.video.duration) + ' с' : g.kind, g.days ? g.days + ' дн.' : '', g.ctr_top !== null && g.ctr_top !== undefined ? 'CTR топ ' + Math.round(100 * g.ctr_top) + '%' : '', g.winner ? 'побед.' : ''].filter(Boolean).join(' · ');
      return `<figure class="card${g.video ? ' wide' : ''}">${src ? `<img class="cr" alt="Креатив" src="${esc(src)}">` : '<div class="mut">нет миниатюры</div>'}<figcaption><b>${esc(g.page || 'рекламодатель скрыт')}</b><br><span class="mut">${esc(meta2)}</span><br>${g.hook_text ? '«' + esc(g.hook_text) + '»<br>' : ''}${tagChips(g)}${g.notes ? `<br><span class="mut">${esc(g.notes)}</span>` : ''}<br>${link(g.url, 'объявление')}</figcaption></figure>`;
    }).join('') + '</div>');
  }

  if (m.hypotheses && m.hypotheses.length) {
    const lint = {}; ((m.lint && m.lint.results) || []).forEach(x => { lint[x.name] = x; });
    out.push('<h2>Гипотезы объявлений</h2><div class="note">Гипотезы для теста, а не прогноз результата. Автопроверка — эвристики; каждое объявление проходит модерацию TikTok.</div>');
    for (const h of m.hypotheses) {
      const ln = lint[h.name];
      out.push(`<details><summary>${esc(h.name)}${h.evidence_strength ? ' · ' + esc(h.evidence_strength) : ''}${ln ? ' · ' + (ln.errors ? chip(ln.errors + ' ошибок', 'error') : chip('проверено', 'ok')) : ''}</summary>
<dl><dt>Угол</dt><dd>${esc(h.angle)}</dd><dt>Свидетельство</dt><dd>${list(h.evidence)}</dd><dt>Хук (первые 2 с)</dt><dd><b>${esc(h.hook_line)}</b></dd>
<dt>Сценарий</dt><dd>${list(h.scenario)}</dd><dt>Текст объявления</dt><dd>${esc(h.primary_text)}</dd><dt>CTA</dt><dd>${esc(h.cta)}</dd>
<dt>Куда ведёт</dt><dd>${esc(h.destination)}</dd><dt>Формат</dt><dd>${esc(h.format)}</dd><dt>Что тестируем</dt><dd>${esc(h.test)}</dd>
<dt>Метрика</dt><dd>${esc(h.metric)}</dd><dt>Риски</dt><dd>${esc(h.risk)}</dd><dt>Подтвердить у клиента</dt><dd>${list(h.confirm_with_client)}</dd></dl>
${ln ? '<p>' + ln.findings.filter(f => f.severity !== 'info').map(f => chip(f.message, f.severity)).join('') + '</p>' : ''}</details>`);
    }
  }

  if (m.plan && m.plan.plan) {
    const p = m.plan.plan;
    out.push('<h2>План теста</h2><p class="mut">Балл = сила сигнала × готовность (подтверждён ли факт у клиента) / трудоёмкость. Он упорядочивает работу и не предсказывает результат.</p>');
    const showBudget = !!m.withBudget;
    out.push(table(['#', 'Гипотеза', 'Тип', 'Сила', 'Трудоёмк.', 'Балл', 'Блокеры'], (m.plan.ranked || []).map(r => [esc(r.rank), esc(r.name), esc(r.variable_type), esc(r.evidence_strength), esc(r.effort), esc(r.score), r.blockers.map(b => chip(b, 'warn')).join('')])));
    out.push(table(['Раунд', 'Тесты (параллельно)', ...(showBudget ? ['Бюджет'] : [])], p.rounds.map(x => [esc(x.round), esc(x.tests.map(t => t.name + ' (' + t.variable_type + ')').join('; ')), ...(showBudget ? [x.budget === null ? '-' : esc(x.budget)] : [])])));
    const a = p.assumptions;
    out.push(`<p class="mut">Допущения: ${esc(a.variants_per_test)} варианта на тест, ${esc(a.events_per_variant)} событий оптимизации на вариант (ориентир TikTok для выхода из обучения за ~неделю), не меньше ${esc(a.min_days_per_round)} дней на раунд, обновлять ролики каждые ${esc(a.creative_refresh_days)} дней${showBudget ? ', целевой CPA ' + (a.target_cpa === null ? 'неизвестен' : esc(a.target_cpa)) : '. Бюджет и целевой CPA клиента в этот файл не включены (--with-budget добавит их, они есть в Excel)'}. Тесты хука и креатива не идут параллельно: оба меняют ролик.</p>`);
    if (p.excluded.length) out.push('<p>Не запускать: ' + p.excluded.map(e => chip(e.name + ': ' + e.reason, 'warn')).join('') + '</p>');
  }

  if (m.sites && m.sites.length) {
    out.push('<h2>Сайты лидеров</h2><div class="note">Расхождение реклама против сайта — зацепка, а не доказательство: страницы открывались без JavaScript, баннеры и всплывающие окна могли не попасть в текст. «Пиксель TikTok не виден» при Google Tag Manager значит «неизвестно».</div>');
    for (const s of m.sites) {
      if (s.error) { out.push(`<details><summary>${esc(s.page)}</summary><p class="mut">${esc(s.error)}</p></details>`); continue; }
      const c = s.compare || {}, px = s.pixels || {};
      const pixel = px.tiktok ? chip('пиксель TikTok', 'ok') : px.tag_manager ? chip('TikTok: возможно, через GTM') : chip('пиксель TikTok не найден', 'warn');
      const img = m.images && m.images[s.screenshot] ? `<img class="shot" alt="Первый экран на телефоне" src="${esc(m.images[s.screenshot])}" style="max-width:260px;border:1px solid var(--line);border-radius:8px;margin-top:8px">` : '';
      out.push(`<details><summary>${esc(s.page)} · ${esc(s.ads)} объявл.${s.shopify ? ' · Shopify' : ''}</summary>${pixel}${px.meta ? chip('пиксель Meta') : ''}<dl>
<dt>Страница</dt><dd>${extLink(s.final_url || s.landing, cleanUrl(s.final_url || s.landing) || '(адрес скрыт)')}</dd><dt>Заголовок</dt><dd>${esc(s.title)}</dd><dt>Подзаголовки</dt><dd>${esc((s.headings || []).join(' · '))}</dd>
<dt>Цены на странице</dt><dd>${num(s.site && s.site.prices && s.site.prices.min)} – ${num(s.site && s.site.prices && s.site.prices.max)}</dd>
<dt>Обещано в рекламе, на странице не найдено</dt><dd>${(c.promised_not_on_site || []).map(x => chip(x, 'warn')).join('') || '-'}${(c.ad_pct_off_not_on_site || []).length ? chip('скидка ' + c.ad_pct_off_not_on_site.join(', ') + '% не найдена', 'warn') : ''}</dd>
<dt>На странице, в рекламе не упомянуто</dt><dd>${(c.on_site_not_advertised || []).map(x => chip(x)).join('') || '-'}</dd></dl>${img}</details>`);
    }
  }

  if (m.diff) {
    const d = m.diff;
    if (d.source === 'cc') {
      out.push(`<h2>Изменения с прошлого среза (${esc(d.interval_days)} дн.)</h2>` + kpis([['Топ-объявлений', d.prev_ads + ' → ' + d.curr_ads], ['Остались', d.kept], ['Вошли в топ', d.entered.count], ['Выпали из собранного', d.dropped.count]]));
      if ((d.dynamics.hooks_new_vs_dropped || []).length) out.push('<p><b>Чаще у вошедших в топ:</b> ' + d.dynamics.hooks_new_vs_dropped.map(h => chip(h.hook + ' ' + Math.round(100 * h.entered_share) + '% vs ' + Math.round(100 * h.dropped_share) + '%')).join('') + '</p>');
      if ((d.entered.top || []).length) out.push(table(['CTR', 'Лайки', 'Новое в топе'], d.entered.top.map(c => ['топ ' + esc(Math.round(100 * c.ctr_top)) + '%', num(c.likes), link(c.url, c.text)])));
    } else {
      const y = d.dynamics || {};
      out.push(`<h2>Изменения с прошлого среза (${esc(d.interval_days)} дн.)</h2>` + kpis([['Объявлений', d.prev_ads + ' → ' + d.curr_ads], ['Уникальных роликов', d.prev_creatives + ' → ' + d.curr_creatives], ['Новых роликов', d.new_creatives.count],
        ['Остановлено роликов', d.stops.stopped_creatives.length], ['Молодых тестов выключено', d.young_tests.gone + ' из ' + d.young_tests.creatives], ['Масштабируют (+2 копии)', d.scaling.length]]));
      out.push('<p class="mut">Остановка видна по дате последнего показа: объявление ещё в выдаче, но не показывалось 7+ дней. «Пропало из выдачи» без уверенности — могло выпасть из верха списка.</p>');
      if (d.scaling.length) out.push('<h3>Масштабируют</h3>' + table(['Рекламодатель', 'Копий было → стало', 'Дней показа', 'Ролик'], d.scaling.map(s => [esc(s.page), esc(s.copies_prev + ' → ' + s.copies_curr), esc(s.run_days), link(s.url, s.text)])));
      if (d.stops.stopped_creatives.length) out.push('<h3>Выключили</h3>' + table(['Рекламодатель', 'Дней показа', 'Копий', 'Ролик'], d.stops.stopped_creatives.map(s => [esc(s.page), esc(s.run_days), esc(s.copies), link(s.url, s.text)])));
      if ((y.new_entrants || []).length) out.push('<h3>Новые рекламодатели</h3>' + table(['Рекламодатель', 'Роликов', 'Хуки', 'Куда ведёт', 'Пример'], y.new_entrants.map(e => [esc(e.page), esc(e.creatives), esc(e.hooks.join(', ')), esc(e.doors.join(', ')), link(e.url, e.example)])));
      if ((y.failed_hooks || []).length) out.push('<p><b>Чаще у выключенных молодых тестов:</b> ' + y.failed_hooks.map(h => chip(h.hook + ' · ' + h.strength, 'warn')).join('') + '</p>');
      if ((y.scaling_hooks || []).length) out.push('<p><b>Хуки масштабируемых роликов:</b> ' + y.scaling_hooks.map(h => chip(h.hook + ' ×' + h.creatives + ' · ' + h.strength)).join('') + '</p>');
      if ((d.unreviewed_pages || []).length) out.push('<div class="note">Новые рекламодатели без разметки в curation.json (в сравнение не вошли, если там белый список): ' + esc(d.unreviewed_pages.slice(0, 10).map(p => p.page).join(', ')) + '.</div>');
    }
  }

  const steps = m.next_steps || [];
  if (steps.length) {
    out.push('<h2>Что ещё можно сделать</h2><p class="mut">Шаги, которые для этого среза ещё не сделаны: выводы выше на них не опираются.</p>');
    out.push(steps.map(s => `<div class="note${s.urgent ? ' urgent' : ''}"><b>${esc(s.title)}</b>${s.urgent ? ' ' + chip('срочно', 'warn') : ''}${s.needs ? ' ' + chip(s.needs) : ''}<br>${esc(s.why)}<br><span class="mut">${esc(s.how)}</span></div>`).join(''));
  }
  out.push(`<hr><p class="mut">Сформировано ${esc(m.generated || '')} · tiktok-ads-niche-report. Данные: публичные ${esc(srcName)}. Инструмент не связан с TikTok и Anthropic. Автоматический сбор может противоречить условиям TikTok: ответственность за использование на пользователе.</p>`);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>TikTok: ${esc(title)} ${esc(dateStr)}</title><style>${CSS}</style></head><body><main>${out.join('\n')}</main></body></html>`;
}

module.exports = { buildHtml, esc, safeUrl, cleanUrl };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const noImages = args.includes('--no-images') && args.splice(args.indexOf('--no-images'), 1);
  const withBudget = args.includes('--with-budget') && args.splice(args.indexOf('--with-budget'), 1);
  const dir = args[0];
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node export_html.js <snapshot-folder-with-ads.csv> [--out file.html] [--no-images] [--with-budget]');
    process.exit(1);
  }
  const { loadSnapshot } = require('./report.js');
  const snap = loadSnapshot(dir);
  const read = f => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  const model = { ...snap, hypotheses: read('hypotheses.json'), lint: read('hypotheses_lint.json'), plan: read('test_plan.json'), sites: read('sites.json'), diff: read('diff.json'), images: {}, withBudget: !!withBudget, generated: new Date().toISOString().slice(0, 10) };
  if (!noImages) {
    const root = path.resolve(dir) + path.sep;
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    for (const st of model.sites || []) { // phone-width first screens of the leaders' sites
      if (!st.screenshot) continue;
      const f = path.resolve(dir, st.screenshot);
      if (!f.startsWith(root) || !/\.png$/i.test(f) || !fs.existsSync(f) || fs.statSync(f).size > 700 * 1024) continue;
      model.images[st.screenshot] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    }
    for (const g of ((model.visuals && model.visuals.items) || []).slice(0, 60)) {
      for (const rel of [g.thumbs[0], g.files[0]]) {
        if (!rel) continue;
        const f = path.resolve(dir, rel), mime = MIME[path.extname(f).toLowerCase()];
        if (!f.startsWith(root) || !mime || !fs.existsSync(f) || fs.statSync(f).size > 250 * 1024) continue; // inside the folder, pictures only, light
        model.images[rel] = `data:${mime};base64,` + fs.readFileSync(f).toString('base64');
        break;
      }
    }
  }
  const out = outPath || path.join(dir, 'report.html');
  fs.writeFileSync(out, buildHtml(model), 'utf8');
  console.log(`Saved: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, single file)`);
}
