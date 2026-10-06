#!/usr/bin/env node
// Writes ONE self-contained HTML report for a snapshot folder: no external
// files, fonts, images or scripts (charts are CSS, screenshots are embedded as
// data: URIs, and a Content-Security-Policy forbids everything else). It also
// contains no client.json data. Sections appear when their files exist:
// sites.json (site check), hypotheses.json (+ hypotheses_lint.json,
// test_plan.json), diff.json (changes), creatives/manifest.json (+ creatives.json:
// what is on the pictures, with a gallery of thumbnails).
//
//   node export_html.js out/ecom-dropship-us/2026-09-30 [--out report.html] [--no-images]
//
// Every value below comes from ad text or files that a third party influences,
// so all of it goes through esc(); links are limited to http(s).
const fs = require('fs');
const path = require('path');
const { CREATIVE_TAGS } = require('./collector.js');

const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');
const link = (u, text) => (safeUrl(u) ? `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));
const pct = (n, d) => (d ? Math.round(100 * n / d) : 0);
const num = n => (n === null || n === undefined ? '-' : esc(n));

const bars = (title, entries, total) => `<section class="card"><h3>${esc(title)}</h3>${entries.map(([label, n]) =>
  `<div class="bar"><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${Math.min(100, pct(n, total))}%"></i></span><span class="bn">${esc(n)} <small>${pct(n, total)}%</small></span></div>`).join('')}</section>`;

const table = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const chip = (text, kind) => `<span class="chip ${esc(kind || '')}">${esc(text)}</span>`;
const list = items => `<ul>${(Array.isArray(items) ? items : [items]).filter(x => x !== undefined && x !== '').map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

const CSS = `:root{--bg:#f6f7f9;--fg:#1c2330;--mut:#5b6577;--card:#fff;--line:#dfe3ea;--acc:#2456d6;--ok:#1b7f4b;--warn:#a86400;--err:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#12151b;--fg:#e6e9ef;--mut:#9aa4b6;--card:#1b2029;--line:#2a3140;--acc:#7aa2ff;--ok:#5fd394;--warn:#f0b35a;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.25rem;margin:1.6em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.25em}h3{font-size:1rem;margin:.1em 0 .6em}
.mut{color:var(--mut)}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:1.6rem}.kpi span{color:var(--mut);font-size:.85rem}
.bar{display:grid;grid-template-columns:minmax(80px,1.2fr) 2fr minmax(60px,.8fr);gap:8px;align-items:center;margin:4px 0;font-size:.9rem}.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bt{background:var(--line);border-radius:4px;height:10px;overflow:hidden}.bt i{display:block;height:100%;background:var(--acc)}.bn{text-align:right}.bn small{color:var(--mut)}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--bg);white-space:nowrap}
a{color:var(--acc)}.chip{display:inline-block;max-width:100%;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:.78rem;margin:1px 2px 1px 0}.chip.error{color:var(--err);border-color:var(--err)}.chip.warn{color:var(--warn);border-color:var(--warn)}.chip.ok{color:var(--ok);border-color:var(--ok)}
.note{background:var(--card);border-left:4px solid var(--warn);padding:8px 12px;border-radius:6px;margin:10px 0;font-size:.9rem}details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:8px 0}summary{cursor:pointer;font-weight:600}
dl{margin:.4em 0;display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:2px 12px}dt{color:var(--mut)}dd{margin:0;min-width:0;overflow-wrap:anywhere}@media(max-width:640px){dl{grid-template-columns:minmax(0,1fr)}dt{margin-top:.5em}}img.shot{max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:8px}
.gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:12px}figure{margin:0;font-size:.85rem}img.cr{display:block;width:100%;height:auto;border-radius:6px;margin-bottom:6px}
@media print{body{background:#fff;color:#000}details{border:1px solid #999}details>*{display:block}details:not([open])>*:not(summary){display:block}.card,.tw{break-inside:avoid}}`;

function buildHtml(m) {
  const { report: r, meta = {}, rows = [] } = m;
  const total = r.ads || rows.length;
  const dateStr = meta.ts ? new Date(meta.ts * 1000).toISOString().slice(0, 10) : '';
  const title = meta.preset_title || meta.preset || 'Срез Ads Library';
  const out = [];
  out.push(`<h1>Ads Library: ${esc(title)}</h1><p class="mut">Дата сбора: ${esc(dateStr)}${meta.country ? ' · страна: ' + esc(meta.country) : ''}${meta.queries ? ' · запросов: ' + esc(meta.queries.length) : ''}. Снимок на дату сбора: библиотека отдаёт до ~120 объявлений на запрос (верх выдачи по охвату), это не весь рынок.</p>`);
  if (meta.queries && meta.queries.length) out.push(`<p class="mut">Запросы: ${meta.queries.map(q => chip(q)).join('')}</p>`);
  const warnings = m.warnings || [];
  if (warnings.length) out.push(`<h2>Предупреждения</h2>${warnings.map(w => `<div class="note">${esc(w.message)}</div>`).join('')}`);
  const cur = meta.curation;
  const types = (cur && cur.types) || {};
  if (cur) out.push(`<div class="note">Список рекламодателей проверен вручную (curation.json): убрано вручную ${esc(cur.excluded_ads)} объявл. от ${esc((cur.excluded_pages || []).length)} рекламодателей как не конкурентов, осталось ${esc(cur.kept_pages)}.${cur.notes ? ' ' + esc(cur.notes) : ''}</div>`);

  const single = pct(r.single_ad_advertisers, r.advertisers);
  const video = pct((r.formats || {}).VIDEO || 0, total);
  const old90 = pct((r.age_buckets['90-365'] || 0) + (r.age_buckets['>365'] || 0), total);
  const pr = r.prices || {};
  out.push(`<div class="cards">${[
    ['Объявлений', total], ['Рекламодателей', r.advertisers], ['С одним объявлением', single + '%'], ['Видео', video + '%'],
    ['Старше 90 дней', old90 + '%'], ...(r.ai_made_ads ? [['Создано ИИ (пометка Meta)', r.ai_made_ads]] : []), ['Медиана цены (' + (pr.ads_with_price || 0) + ' объявл. с ценой)', pr.median === null || pr.median === undefined ? '-' : (pr.currency || '') + ' ' + pr.median]
  ].map(([k, v]) => `<div class="card kpi"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`);

  out.push('<h2>Структура рекламы</h2><div class="grid">');
  out.push(bars('Формат', Object.entries(r.formats || {}).sort((a, b) => b[1] - a[1]), total));
  out.push(bars('Куда ведёт (дверь)', Object.entries(r.doors || {}).sort((a, b) => b[1] - a[1]), total));
  out.push(bars('CTA (топ-8)', Object.entries(r.ctas || {}).sort((a, b) => b[1] - a[1]).slice(0, 8), total));
  out.push(bars('Возраст объявлений, дней', Object.entries(r.age_buckets || {}), total));
  out.push(bars('Хуки (по тексту)', Object.entries(r.hook_freq || {}).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 0).slice(0, 12), total));
  out.push('</div><p class="mut">Хуки считаются регулярными выражениями по тексту объявления. Хук, слова которого входят в ваши же поисковые запросы, круговой.</p>');

  out.push('<h2>Кто рекламируется (топ)</h2>');
  const hasTypes = Object.keys(types).length > 0;
  const hasLikes = (r.top_pages || []).some(p => Number.isFinite(p.page_likes));
  out.push(table(['Страница', ...(hasTypes ? ['Тип'] : []), ...(hasLikes ? ['Подписчики'] : []), 'Объявл.', 'Старейшее, дн.', 'Дверь', 'Сайты', 'Пометки'], (r.top_pages || []).map(p => [
    link(p.library_url || p.page_url, p.page), ...(hasTypes ? [esc(types[p.page] || '')] : []), ...(hasLikes ? [num(p.page_likes)] : []), esc(p.ads), esc(p.oldest_days), esc(p.doors), esc(p.sites),
    (p.local ? chip('локальный', 'warn') : '') + (p.platform ? chip('платформа', 'warn') : '')
  ])));

  if ((m.query_stats || []).length) {
    const curated = m.query_stats.some(q => q.relevant_advertisers !== null);
    out.push('<h2>Запросы: что нашли</h2><p class="mut">Какие запросы приводят конкурентов, а какие шум. ' + (curated ? 'Колонка «Из них конкуренты» после ручной проверки.' : 'Ручной проверки (curation.json) пока нет.') + ' «Лимит Meta»: подгрузка следующих страниц отклонена, по запросу только первая партия (~30 объявлений).</p>');
    out.push(table(['Запрос', 'Объявл.', 'Рекламодателей', ...(curated ? ['Из них конкуренты'] : []), 'Лимит Meta'], m.query_stats.map(q => [
      esc(q.query), esc(q.ads), esc(q.advertisers), ...(curated ? [esc(q.relevant_advertisers)] : []), q.rate_limited ? chip('лимит', 'warn') : ''
    ])));
  }

  if ((r.longrun || []).length) {
    out.push('<h2>Долгожители</h2><p class="mut">По числу вариантов креатива, затем по возрасту; не больше 2 на страницу. Долгий показ не гарантия эффективности.</p>');
    out.push(table(['Страница', 'Дней', 'Вариантов', 'Формат', 'Дверь', 'Текст'], r.longrun.map(l => [esc(l.page), esc(l.days), esc(l.variants), esc(l.fmt), esc(l.door), link(l.url, l.text)])));
  }

  const v = m.visuals;
  if (v && v.items.length) {
    const KIND = { image: 'картинка', carousel: 'карусель', video_preview: 'кадр видео' };
    out.push('<h2>Креативы</h2><p class="mut">Что изображено на креативах конкурентов. Выборка: ' + esc(v.downloaded) + ' креативов (сначала долгожители, не больше 3 на рекламодателя), размечено ' + esc(v.labeled) + ' у ' + esc(v.advertisers) + ' рекламодателей. Видео оценены только по кадру-превью. Сила сигнала считается по рекламодателям, как у хуков: «weak» это привычка одного-двух конкурентов, а не тренд ниши.</p>');
    if (v.fields.length) {
      out.push('<div class="grid">' + v.fields.map(f => `<section class="card"><h3>${esc(f.label)}</h3>${f.values.map(x =>
        `<div class="bar"><span class="bl">${esc(x.name)}</span><span class="bt"><i style="width:${Math.min(100, Math.round(100 * x.share))}%"></i></span><span class="bn">${esc(x.creatives)} <small>${esc(x.advertisers)} рекл.${x.strength ? ' · ' + esc(x.strength) : ''}${x.long_running ? ' · долгожит. ' + esc(x.long_running) : ''}</small></span></div>`).join('')}</section>`).join('') + '</div>');
    }
    // A label's tags as chips: "yes" booleans by their field name, "none" left out.
    const tagChips = g => {
      if (!g.tags) return chip('не размечено', 'warn');
      return Object.entries(g.tags).map(([k, val]) => {
        const t = CREATIVE_TAGS[k] || {};
        if (typeof val === 'boolean') return val ? chip(t.label || k) : '';
        return [].concat(val).filter(x => x !== 'none').map(x => chip((t.names || {})[x] || x)).join('');
      }).join('');
    };
    out.push('<div class="gal">' + v.items.slice(0, 60).map(g => {
      const src = m.images && (m.images[g.thumbs[0]] || m.images[g.files[0]]);
      return `<figure class="card">${src ? `<img class="cr" alt="Креатив ${esc(g.page)}" src="${esc(src)}">` : '<div class="mut">нет миниатюры</div>'}<figcaption><b>${esc(g.page)}</b><br><span class="mut">${esc(KIND[g.kind] || g.kind)} · ${esc(g.days)} дн.${g.long_running ? ' · долгожитель' : ''}</span><br>${tagChips(g)}${g.notes ? `<br><span class="mut">${esc(g.notes)}</span>` : ''}<br>${link(g.url, 'объявление')}</figcaption></figure>`;
    }).join('') + '</div>');
  }

  if (m.eu && m.eu.ads > 0) {
    const eu = m.eu, share = o => Object.entries(o || {}).map(([k, v]) => chip(k + ' ' + Math.round(100 * v) + '%'));
    out.push('<h2>ЕС: охват и аудитория</h2><div class="note">Данные Meta только для объявлений, показанных в ЕС: охват в людях по каждому объявлению, таргетинг (возраст, пол, страны) и возрастно-половой состав тех, до кого реклама дошла. Охват объявлений одного рекламодателя в сумме считает пересекающихся людей дважды: сумма это верхняя граница, а не размер аудитории. Собрано по ' + esc(eu.ads) + ' объявл.</div>');
    out.push('<p><b>Возраст охваченных (все объявления):</b> ' + share(eu.overall.age_share).join('') + '</p>');
    if (Object.keys(eu.overall.gender_share || {}).length) out.push('<p><b>Пол охваченных:</b> ' + share({ мужчины: eu.overall.gender_share.male, женщины: eu.overall.gender_share.female, 'не определён': eu.overall.gender_share.unknown }).join('') + '</p>');
    out.push(table(['Страница', 'Объявл. с данными', 'Охват, сумма', 'Охват, макс.', 'Возраст таргетинга', 'Пол', 'Страны', 'Главная группа', 'Плательщик'], eu.per_page.map(p => [
      esc(p.page), esc(p.ads), esc(p.reach_sum), esc(p.reach_max), esc(p.age_min === null ? '' : p.age_min + '-' + p.age_max), esc(p.genders.join(', ')), esc(p.countries.join(', ')), esc(p.top_age_range), esc(p.payers.join('; '))
    ])));
  }

  if (r.stopped && r.stopped.ads > 0) {
    const st = r.stopped;
    out.push('<h2>Остановленные объявления</h2><p class="mut">Объявления, которые Библиотека больше не показывает как активные: ' + esc(st.ads) + ' от ' + esc(st.advertisers) + ' рекламодателей. Медиана показа ' + esc(st.median_run_days) + ' дн.; ' + esc(st.short_lived) + ' остановлены меньше чем за 2 недели (похоже на тест, который не сработал). Долгий показ до остановки не говорит, что объявление работало хорошо.</p>');
    if ((st.top || []).length) out.push(table(['Страница', 'Дней показа', 'Вариантов', 'Формат', 'Дверь', 'Текст'], st.top.map(t => [esc(t.page), esc(t.run_days), esc(t.variants), esc(t.fmt), esc(t.door), link(t.url, t.text)])));
  }

  if ((r.creative_clusters || []).length || (r.store_groups || []).length) {
    out.push('<h2>Сети страниц</h2><div class="grid">');
    if (r.creative_clusters.length) out.push(`<section class="card"><h3>Один текст на разных страницах</h3>${r.creative_clusters.map(c => `<p><b>${esc(c.pages.length)} стр.</b>, старейшее ${esc(c.oldest_days)} дн.: ${esc(c.text)}<br><span class="mut">${esc(c.pages.join('; '))}</span></p>`).join('')}</section>`);
    if (r.store_groups.length) out.push(`<section class="card"><h3>Страницы с общим сайтом</h3>${r.store_groups.map(g => `<p><b>${esc(g.site)}</b><br><span class="mut">${esc(g.pages.join('; '))}</span></p>`).join('')}</section>`);
    out.push('</div>');
  }

  if (m.sites && m.sites.length) {
    out.push('<h2>Сайты лидеров</h2><div class="note">Расхождение реклама против сайта это зацепка, а не доказательство: баннеры и всплывающие окна могут не попасть в текст страницы.</div>');
    for (const s of m.sites) {
      if (s.error) { out.push(`<details><summary>${esc(s.page)}</summary><p class="mut">${esc(s.error)}</p></details>`); continue; }
      const c = s.compare || {};
      const img = m.images && m.images[s.screenshot] ? `<img class="shot" alt="Первый экран" src="${esc(m.images[s.screenshot])}">` : '';
      out.push(`<details><summary>${esc(s.page)} · ${esc(s.ads)} объявл.${s.shopify ? ' · Shopify' : ''}</summary><dl>
<dt>Страница</dt><dd>${link(s.final_url || s.landing, s.final_url || s.landing)}</dd><dt>Заголовок</dt><dd>${esc(s.title)}</dd>
<dt>Цены на сайте</dt><dd>${num(s.site && s.site.prices && s.site.prices.min)} – ${num(s.site && s.site.prices && s.site.prices.max)}</dd>
<dt>Обещано в рекламе, на сайте не найдено</dt><dd>${(c.promised_not_on_site || []).map(x => chip(x, 'warn')).join('') || '-'}</dd>
<dt>На сайте, в рекламе не упомянуто</dt><dd>${(c.on_site_not_advertised || []).map(x => chip(x)).join('') || '-'}</dd></dl>${img}</details>`);
    }
  }

  if (m.hypotheses && m.hypotheses.length) {
    const rank = {}; ((m.plan && m.plan.ranked) || []).forEach(x => { rank[x.name] = x; });
    const lint = {}; ((m.lint && m.lint.results) || []).forEach(x => { lint[x.name] = x; });
    const hyps = [...m.hypotheses].sort((a, b) => ((rank[a.name] || {}).rank || 99) - ((rank[b.name] || {}).rank || 99));
    out.push('<h2>Гипотезы объявлений</h2><div class="note">Это гипотезы для теста, а не прогноз результата. Автопроверка текстов работает по эвристикам и не заменяет проверку Meta.</div>');
    for (const h of hyps) {
      const rk = rank[h.name], ln = lint[h.name];
      out.push(`<details><summary>${rk ? '#' + esc(rk.rank) + ' · ' : ''}${esc(h.name)}${h.signal_strength ? ' · ' + esc(h.signal_strength) : ''}${rk ? ' · балл ' + esc(rk.score) : ''}</summary>
<dl><dt>Угол</dt><dd>${esc(h.angle)}</dd><dt>Свидетельство</dt><dd>${list(h.evidence)}</dd>
<dt>Заголовок</dt><dd><b>${esc(h.headline)}</b></dd><dt>Текст</dt><dd>${esc(h.primary_text)}</dd><dt>CTA</dt><dd>${esc(h.cta)}</dd>
<dt>Куда ведёт</dt><dd>${esc(h.destination)}</dd><dt>Формат</dt><dd>${esc(h.format)}</dd><dt>Что тестируем</dt><dd>${esc(h.test)}</dd>
<dt>Метрика</dt><dd>${esc(h.metric)}</dd><dt>Риски</dt><dd>${esc(h.risk)}</dd><dt>Подтвердить у клиента</dt><dd>${esc(h.confirm_with_client)}</dd></dl>
${rk && rk.blockers && rk.blockers.length ? '<p>' + rk.blockers.map(b => chip(b, 'warn')).join('') + '</p>' : ''}
${ln ? '<p>' + ln.findings.filter(f => f.severity !== 'info').map(f => chip(f.message, f.severity)).join('') + '</p>' : ''}</details>`);
    }
    if (m.plan && m.plan.plan) {
      const p = m.plan.plan;
      out.push('<h3>План теста</h3>' + table(['Раунд', 'Тесты (параллельно)', 'Бюджет'], p.rounds.map(x => [esc(x.round), esc(x.tests.map(t => t.name + ' (' + t.variable_type + ')').join('; ')), x.budget === null ? '-' : esc(x.budget)])));
      out.push(`<p class="mut">Допущения: ${esc(p.assumptions.variants_per_test)} варианта на тест, ${esc(p.assumptions.events_per_variant)} событий оптимизации на вариант (ориентир), не меньше ${esc(p.assumptions.min_days_per_round)} дней на раунд, целевой CPA ${p.assumptions.target_cpa === null ? 'неизвестен' : esc(p.assumptions.target_cpa)}.</p>`);
    }
  }

  if (m.diff) {
    const d = m.diff, y = d.dynamics || {};
    out.push(`<h2>Изменения с прошлого среза (${esc(d.interval_days)} дн.)</h2><div class="cards">${[
      ['Объявлений', d.prev_ads + ' → ' + d.curr_ads], ['Пережили', d.survived], ['Новых', d.new_ads.count], ['Пропало из выдачи', d.stopped.count],
      ['Уверенно остановлены', d.stopped.high_confidence], ['Молодых тестов пропало', d.young_tests.gone + ' из ' + d.young_tests.ads]
    ].map(([k, v]) => `<div class="card kpi"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>`);
    out.push('<p class="mut">Пропавшее объявление считается остановленным уверенно, только если его запрос перезапущен и вернул меньше 90 объявлений; иначе оно могло выпасть из топа.</p>');
    if ((y.scaling_hooks || []).length) out.push('<p><b>Масштабируется (хуки объявлений с ростом вариантов):</b> ' + y.scaling_hooks.map(h => chip(h.hook + ' ×' + h.ads + ' · ' + h.strength)).join('') + '</p>');
    if ((y.failed_hooks || []).length) out.push('<p><b>Чаще у пропавших молодых тестов:</b> ' + y.failed_hooks.map(h => chip(h.hook + ' · ' + h.strength, 'warn')).join('') + '</p>');
    if ((d.scaling || []).length) out.push(table(['Страница', 'Было', 'Стало', 'Ссылка'], d.scaling.map(s => [esc(s.page), esc(s.variants_prev), esc(s.variants_curr), link(s.url, 'объявление')])));
  }

  out.push(`<hr><p class="mut">Сформировано ${esc(m.generated || '')}${m.version ? ' · meta-ads-niche-report ' + esc(m.version) : ''}. Данные: публичная Библиотека рекламы Meta, ${m.visuals ? 'тексты и картинки объявлений' : 'только текст объявлений'}. Инструмент не связан с Meta и Anthropic. Автоматический сбор может противоречить условиям Meta: ответственность за использование на пользователе.</p>`);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Ads Library: ${esc(title)} ${esc(dateStr)}</title><style>${CSS}</style></head><body><main>${out.join('\n')}</main></body></html>`;
}

module.exports = { buildHtml, esc, safeUrl };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const noImages = args.includes('--no-images') && args.splice(args.indexOf('--no-images'), 1);
  const dir = args[0];
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node export_html.js <snapshot-folder-with-ads.csv> [--out file.html] [--no-images]');
    process.exit(1);
  }
  const { loadSnapshot } = require('./report.js');
  const snap = loadSnapshot(dir);
  const read = f => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  const model = { ...snap, sites: read('sites.json'), hypotheses: read('hypotheses.json'), lint: read('hypotheses_lint.json'), plan: read('test_plan.json'), diff: read('diff.json'), images: {}, generated: new Date().toISOString().slice(0, 10) };
  try { model.version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch (e) { /* not installed as a plugin */ }
  if (!noImages) {
    const root = path.resolve(dir) + path.sep;
    for (const s of model.sites || []) {
      if (!s.screenshot) continue;
      const f = path.resolve(dir, s.screenshot);
      if (!f.startsWith(root) || !/\.png$/i.test(f) || !fs.existsSync(f) || fs.statSync(f).size > 700 * 1024) continue; // stay inside the folder, PNG only, keep the file light
      model.images[s.screenshot] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    }
    // Creative thumbnails (fetch_creatives.py), else the picture itself when it is small: same rules.
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    for (const g of ((model.visuals && model.visuals.items) || []).slice(0, 60)) {
      for (const rel of [g.thumbs[0], g.files[0]]) {
        if (!rel) continue;
        const f = path.resolve(dir, rel), mime = MIME[path.extname(f).toLowerCase()];
        if (!f.startsWith(root) || !mime || !fs.existsSync(f) || fs.statSync(f).size > 250 * 1024) continue;
        model.images[rel] = `data:${mime};base64,` + fs.readFileSync(f).toString('base64');
        break;
      }
    }
  }
  const out = outPath || path.join(dir, 'report.html');
  fs.writeFileSync(out, buildHtml(model), 'utf8');
  console.log(`Saved: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, single file)`);
}
