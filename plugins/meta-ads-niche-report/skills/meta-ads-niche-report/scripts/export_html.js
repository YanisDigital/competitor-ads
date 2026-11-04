#!/usr/bin/env node
// Writes ONE self-contained HTML report for a snapshot folder: no external
// files, fonts, images or scripts (charts are CSS, screenshots are embedded as
// data: URIs, and a Content-Security-Policy forbids everything else). Made to
// be shared, so: no client.json file, no payer or beneficiary names (never
// stored), no budget or target CPA of the test plan (the client's numbers;
// --with-budget adds them), links to third-party sites without their query
// string (fbclid, ttclid, utm_*). The hypotheses do contain the facts the client
// confirmed for the ad text. Sections appear when their files exist:
// sites.json (site check), hypotheses.json (+ hypotheses_lint.json,
// test_plan.json), diff.json (changes), creatives/manifest.json (+ creatives.json:
// what is on the pictures, with a gallery of thumbnails). It always ends with
// "what else can be done" (next_steps from report.js): the steps not run yet.
//
//   node export_html.js out/ecom-dropship-us/2026-09-30 [--out report.html] [--no-images] [--with-budget]
//
// Every value below comes from ad text or files that a third party influences,
// so all of it goes through esc(); links are limited to http(s).
const fs = require('fs');
const path = require('path');
const { CREATIVE_TAGS } = require('./collector.js');

const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Third-party link: scheme://host/path only, no credentials, query or fragment ('' when not http(s)):
// a click with ttclid/fbclid/utm_* would be counted in a competitor's analytics.
const cleanUrl = u => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) && !x.username && !x.password ? x.origin + x.pathname : ''; } catch (e) { return ''; } };
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '');
const link = (u, text) => (safeUrl(u) ? `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text));
// A list of site domains ("a.ua, b.shop"): each one a link to https://<domain> (opens in a new tab), the rest escaped text. Only a plain
// host name qualifies, so a value from ad data cannot smuggle a scheme, a path or markup into the href.
const DOMAIN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+$/i;
const domainLinks = list => String(list === null || list === undefined ? '' : list).split(/,\s*/).filter(Boolean)
  .map(d => (DOMAIN.test(d) && d.length <= 120 ? link('https://' + d.toLowerCase(), d) : esc(d))).join(', ');
const pct = (n, d) => (d ? Math.round(100 * n / d) : 0);
const num = n => (n === null || n === undefined ? '-' : esc(n));

const bars = (title, entries, total) => `<section class="card"><h3>${esc(title)}</h3>${entries.map(([label, n]) =>
  `<div class="bar"><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${Math.min(100, pct(n, total))}%"></i></span><span class="bn">${esc(n)} <small>${pct(n, total)}%</small></span></div>`).join('')}</section>`;

const table = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const chip = (text, kind) => `<span class="chip ${esc(kind || '')}">${esc(text)}</span>`;
const list = items => `<ul>${(Array.isArray(items) ? items : [items]).filter(x => x !== undefined && x !== '').map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

// Look: an analyst's dossier. Warm paper and ink, an editorial serif for headings, a DIN-like face for figures, one signal
// colour (vermilion) and a deep teal for data. Local fonts only (the CSP allows no font download), numbered sections with
// a contents line, a short staggered reveal (off with prefers-reduced-motion and in print).
const CSS = `:root{--bg:#f3efe6;--paper:#fbf9f4;--fg:#1a1c1e;--mut:#5f5a51;--line:#ddd5c6;--rule:#1a1c1e;--acc:#c8431b;--data:#0e5a57;--data2:#cfe3df;--ok:#1d6b45;--warn:#9a5b00;--err:#b0261b;--warnbg:#f7ead2;--shadow:0 1px 0 rgba(26,28,30,.04),0 8px 24px -16px rgba(26,28,30,.25);
--serif:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,"Sitka Heading",Georgia,serif;--num:Bahnschrift,"DIN Alternate","DIN 2014","Barlow Semi Condensed","Arial Narrow",sans-serif;--sans:"Segoe UI Variable Text","Segoe UI","SF Pro Text","Helvetica Neue",sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#141618;--paper:#1c1f22;--fg:#ece6da;--mut:#a39c8f;--line:#33373b;--rule:#ece6da;--acc:#ff7a4f;--data:#5cc2b5;--data2:#22413e;--ok:#6fd39c;--warn:#f0b35a;--err:#ff8a7a;--warnbg:#2d2618;--shadow:0 1px 0 rgba(0,0,0,.3),0 10px 30px -18px rgba(0,0,0,.8)}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;color:var(--fg);font:15px/1.55 var(--sans);font-feature-settings:"kern","liga";background:var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
main{max-width:1120px;margin:0 auto;padding:28px 20px 64px;counter-reset:sec}
.mast{position:relative;padding:22px 0 18px;margin-bottom:8px;border-top:6px solid var(--rule);border-bottom:1px solid var(--rule)}
.mast::before{content:"";position:absolute;left:0;top:-6px;width:88px;height:6px;background:var(--acc)}
.eyebrow{display:flex;flex-wrap:wrap;gap:6px 18px;font:600 .72rem/1 var(--num);letter-spacing:.16em;text-transform:uppercase;color:var(--mut)}.eyebrow span+span::before{content:"/";margin-right:18px;color:var(--acc)}
h1{font:600 clamp(1.9rem,1.2rem + 2.6vw,3.1rem)/1.06 var(--serif);letter-spacing:-.01em;margin:.35em 0 .3em;text-wrap:balance;max-width:22ch}
.lede{max-width:72ch;color:var(--mut);margin:.2em 0}.mast .chip{background:var(--paper)}
.toc{display:flex;flex-wrap:wrap;gap:6px 8px;margin:16px 0 6px;padding:0;font:500 .8rem/1.2 var(--num);letter-spacing:.02em}
.toc a{display:inline-flex;align-items:baseline;gap:6px;padding:5px 10px 5px 8px;border:1px solid var(--line);border-radius:3px;color:var(--fg);text-decoration:none;background:var(--paper);transition:border-color .15s,color .15s,transform .15s}
.toc a::before{content:counter(toc,decimal-leading-zero);counter-increment:toc;color:var(--acc);font-weight:700}.toc{counter-reset:toc}
.toc a:hover,.toc a:focus-visible{border-color:var(--acc);color:var(--acc);transform:translateY(-1px)}
h2{counter-increment:sec;display:flex;align-items:baseline;gap:14px;font:600 1.55rem/1.15 var(--serif);margin:2.4em 0 .7em;padding-top:.55em;border-top:1px solid var(--rule);scroll-margin-top:12px;text-wrap:balance}
h2::before{content:counter(sec,decimal-leading-zero);font:700 .82rem/1 var(--num);letter-spacing:.08em;color:var(--paper);background:var(--acc);padding:5px 7px 4px;border-radius:2px;transform:translateY(-3px)}
h3{font:600 .78rem/1.2 var(--num);letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin:.1em 0 .8em}
.mut{color:var(--mut)}p{margin:.5em 0}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.cards{display:grid;gap:0;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:18px 0 6px;border-top:1px solid var(--rule);border-bottom:1px solid var(--line)}
.card{background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:14px 16px;box-shadow:var(--shadow)}
.cards .card.kpi{background:transparent;border:0;border-left:1px solid var(--line);border-radius:0;box-shadow:none;padding:14px 16px 16px}.cards .card.kpi:first-child{border-left:0;padding-left:0}
.kpi b{display:block;font:600 clamp(1.7rem,1.2rem + 1.4vw,2.5rem)/1 var(--num);font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.01em;color:var(--fg)}
.kpi span{display:block;margin-top:8px;color:var(--mut);font-size:.8rem;line-height:1.35}.cards .card.kpi:first-child b{color:var(--acc)}
.bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;align-items:baseline;margin:10px 0;font-size:.9rem}
.bl{grid-column:1;grid-row:1;overflow-wrap:anywhere;word-break:break-word;line-height:1.3}
.bn{grid-column:2;grid-row:1;text-align:right;max-width:14em;font-family:var(--num);font-variant-numeric:tabular-nums}
.bt{grid-column:1 / -1;grid-row:2;display:block;background:var(--data2);border-radius:1px;height:6px;overflow:hidden}
.grid>.card:last-child:nth-child(4n+1){grid-column:1/-1;columns:3 260px;column-gap:32px}.grid>.card:last-child:nth-child(4n+1) h3{column-span:all}.card .bar{break-inside:avoid}.bt i{display:block;height:100%;background:var(--data)}.card .bar:first-of-type .bt i{background:var(--acc)}.bn small{color:var(--mut);margin-left:2px}
.tw{overflow-x:auto;background:var(--paper);border:1px solid var(--line);border-radius:4px;box-shadow:var(--shadow);margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:.88rem;font-variant-numeric:tabular-nums}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font:600 .7rem/1.2 var(--num);letter-spacing:.12em;text-transform:uppercase;color:var(--mut);background:transparent;border-bottom:1px solid var(--rule);white-space:nowrap}
tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--bg) 45%,transparent)}tbody tr:hover td{background:color-mix(in srgb,var(--acc) 7%,transparent)}tbody tr:last-child td{border-bottom:0}
a{color:var(--data);text-decoration-thickness:1px;text-underline-offset:2px}a:hover{color:var(--acc)}
.chip{display:inline-block;max-width:100%;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:2px;padding:1px 8px;font:500 .76rem/1.5 var(--num);letter-spacing:.02em;margin:2px 3px 2px 0;background:transparent}
.chip.error{color:var(--err);border-color:var(--err)}.chip.warn{color:var(--warn);border-color:var(--warn)}.chip.ok{color:var(--ok);border-color:var(--ok)}
.note{position:relative;background:var(--warnbg);border:0;border-left:3px solid var(--warn);padding:10px 14px 10px 40px;border-radius:2px;margin:10px 0;font-size:.92rem;max-width:90ch}
.note::before{content:"!";position:absolute;left:12px;top:9px;width:18px;height:18px;border-radius:50%;background:var(--warn);color:var(--paper);font:700 .75rem/18px var(--num);text-align:center}
.note.urgent{border-left-color:var(--err)}.note.urgent::before{background:var(--err)}
.analysis{border-left:4px solid var(--acc);font:1.04rem/1.6 var(--serif);padding:18px 22px}.analysis h3,.analysis h4,.analysis h5{font-family:var(--serif);text-transform:none;letter-spacing:0;font-size:1.15rem;color:var(--fg)}.analysis li{margin:.25em 0}
details{background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:10px 16px;margin:10px 0;box-shadow:var(--shadow)}summary{cursor:pointer;font-weight:600}summary::marker{color:var(--acc)}
dl{margin:.4em 0;display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:4px 14px}dt{color:var(--mut);font-size:.88rem}dd{margin:0;min-width:0;overflow-wrap:anywhere}
@media(max-width:640px){dl{grid-template-columns:minmax(0,1fr)}dt{margin-top:.5em}.cards .card.kpi{border-left:0;border-top:1px solid var(--line);padding-left:0}h2{font-size:1.3rem}main{padding:18px 14px 48px}}
img.shot{max-width:100%;border:1px solid var(--line);border-radius:3px;margin-top:8px}
.gal{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:12px}figure{margin:0;font-size:.85rem}figure.card{padding:10px}figure.wide{grid-column:span 2}@media(max-width:420px){figure.wide{grid-column:auto}}
img.cr{display:block;width:100%;height:auto;border-radius:2px;margin-bottom:8px}
main>hr{border:0;border-top:6px solid var(--rule);margin:56px 0 10px}main>hr+p{font-size:.8rem}
@media(prefers-reduced-motion:no-preference){main>*{animation:rise .55s cubic-bezier(.2,.7,.2,1) both}main>:nth-child(2){animation-delay:.05s}main>:nth-child(3){animation-delay:.1s}main>:nth-child(4){animation-delay:.15s}main>:nth-child(5){animation-delay:.2s}main>:nth-child(6){animation-delay:.25s}main>:nth-child(n+7){animation-delay:.3s}.bt i{animation:grow .9s .2s cubic-bezier(.2,.7,.2,1) both;transform-origin:left}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media print{body{background:#fff;color:#000;font-size:11pt}main{max-width:none;padding:0}.toc{display:none}*{animation:none!important;box-shadow:none!important}.card,.tw,details{background:#fff}details{border:1px solid #999}details>*{display:block}details:not([open])>*:not(summary){display:block}.card,.tw,.note{break-inside:avoid}h2{break-after:avoid}a{color:#000}}`;

// analysis.md next to the snapshot: the analyst's conclusions (a plan, a client proposal) in the report itself. A small, safe Markdown:
// # ## ### headings, "- " or "* " lists, "1. " lists, **bold**, paragraphs; everything is escaped, no links, no raw HTML.
function mdToHtml(text) {
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = [];
  let list = null, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of String(text || '').slice(0, 200000).split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); close(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flush(); close(); out.push('<h' + (m[1].length + 2) + '>' + inline(m[2]) + '</h' + (m[1].length + 2) + '>'); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    close(); para.push(line.trim());
  }
  flush(); close();
  return out.join('\n');
}

function buildHtml(m) {
  const { report: r, meta = {}, rows = [] } = m;
  const total = r.ads || rows.length;
  const dateStr = meta.ts ? new Date(meta.ts * 1000).toISOString().slice(0, 10) : '';
  const title = meta.preset_title || meta.preset || 'Срез Ads Library';
  const out = [];
  out.push(`<header class="mast"><div class="eyebrow"><span>Meta Ads Library</span><span>Срез конкурентов</span>${dateStr ? `<span>${esc(dateStr)}</span>` : ''}</div><h1>${esc(title)}</h1><p class="lede">Дата сбора: ${esc(dateStr)}${meta.country ? ' · страна: ' + esc(meta.country) : ''}${meta.queries ? ' · запросов: ' + esc(meta.queries.length) : ''}. Снимок на дату сбора: библиотека отдаёт до ~120 объявлений на запрос (верх выдачи по охвату), это не весь рынок.</p>`);
  if (meta.queries && meta.queries.length) out.push(`<p class="mut">Запросы: ${meta.queries.map(q => chip(q)).join('')}</p>`);
  out.push('</header>');
  const warnings = m.warnings || [];
  if (m.analysis) out.push('<h2>Выводы</h2><section class="card analysis">' + mdToHtml(m.analysis) + '</section>');
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
  const fa = r.formats_by_advertiser || {}, da = r.doors_by_advertiser || {};
  if (r.advertisers && Object.keys(fa).length) {
    const share = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => esc(k) + ': ' + n + ' из ' + r.advertisers).join('; ');
    out.push('</div><p class="mut">По рекламодателям (сколько рекламодателей используют): форматы — ' + share(fa) + '; двери — ' + share(da) + '.' + (r.campaigns && r.campaigns.copies > 0 ? ' Объявлений ' + total + ', но кампаний ' + r.campaigns.count + ': остальное копии одной рекламы одного рекламодателя.' : '') + '</p><div>');
  }
  out.push('</div><p class="mut">Хуки считаются регулярными выражениями по тексту объявления. Хук, слова которого входят в ваши же поисковые запросы, круговой.</p>');

  out.push('<h2>Кто рекламируется (топ)</h2>');
  const hasTypes = Object.keys(types).length > 0;
  const hasLikes = (r.top_pages || []).some(p => Number.isFinite(p.page_likes));
  out.push(table(['Страница', ...(hasTypes ? ['Тип'] : []), ...(hasLikes ? ['Подписчики'] : []), 'Объявл.', 'Старейшее, дн.', 'Дверь', 'Сайты', 'Пометки'], (r.top_pages || []).map(p => [
    link(p.library_url || p.page_url, p.page), ...(hasTypes ? [esc(types[p.page] || '')] : []), ...(hasLikes ? [num(p.page_likes)] : []), esc(p.ads), esc(p.oldest_days), esc(p.doors), domainLinks(p.sites),
    (p.local ? chip('локальный', 'warn') : '') + (p.platform ? chip('платформа', 'warn') : '') + (p.out_of_niche ? p.out_of_niche.map(f => chip('вне ниши: ' + f, 'warn')).join('') : '')
  ])));

  if (cur && (cur.disputed || []).length) {
    out.push('<h2>Спорные рекламодатели (не учтены)</h2><p class="mut">По объявлениям не определить, конкурент ли это (смешанный ассортимент, сервис рядом с продажей). В цифры отчёта они не вошли; решение за вами.</p>');
    out.push(table(['Страница', 'Объявл.', 'Активных', 'Почему спорный', 'Пример текста'], cur.disputed.map(d => [esc(d.page), esc(d.ads), esc(d.active), esc(d.why), esc(d.sample)])));
  }

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

  const fr = r.fresh;
  if (fr && fr.ads) {
    out.push('<h2>Свежие запуски</h2><p class="mut">Объявления младше ' + esc(fr.days) + ' дней: ' + esc(fr.ads) + ' у ' + esc(fr.advertisers) + ' рекламодателей. Это то, что конкуренты тестируют прямо сейчас; молодое объявление ещё не доказало, что работает. Не больше 2 на страницу.' +
      (fr.bursts.length ? ' Запустили пачку (3+): ' + fr.bursts.map(b => esc(b.page) + ' (' + esc(b.ads) + ')').join(', ') + '.' : '') + '</p>');
    out.push(table(['Страница', 'Дней', 'Вариантов', 'Формат', 'CTA', 'Дверь', 'Хуки', 'Текст'], fr.top.map(l => [esc(l.page), esc(l.days), esc(l.variants), esc(l.fmt), esc(l.cta), esc(l.door), l.hooks.map(h => chip(h)).join(''), link(l.url, l.text)])));
  }

  const prods = r.products;
  if (prods && prods.top && prods.top.length) {
    const c = prods.criteria;
    out.push('<h2>Ранние продукты</h2><p class="mut">Продукт здесь это группа объявлений с одним Shopify-товаром в ссылке или с одним текстом. Критерии: старейшее объявление ' + esc(c.min_days) + '–' + esc(c.max_days) + ' дней, магазинов не больше ' + esc(c.max_stores) + (c.min_price ? ', цена в рекламе от $' + esc(c.min_price) : '') + ', без красных флагов. Найдено продуктов: ' + esc(prods.found) + ', подходят: ' + esc(prods.early) + ' (сильных: ' + esc(prods.strong) + '), в окне по возрасту: ' + esc(prods.in_window) + ', старше окна: ' + esc(prods.too_old) + ', с красным флагом: ' + esc(prods.flagged) + '. Просмотров и лайков в Библиотеке Meta для коммерческой рекламы нет: рост виден по вариантам и свежим запускам. Это кандидаты для проверки, а не вывод.' + (prods.query_check ? ' Поиск Meta находит любое слово запроса и текст, которого нет в собранных данных (другие варианты креатива, текст на картинке): у ' + esc(prods.loose_ads) + ' из ' + esc(prods.ads_checked) + ' объявлений в тексте нет слов запроса, это случайные совпадения, в списки и продукты они не попали (в Excel колонка «Слова запроса в тексте»).' : '') + (prods.doors_kept && prods.other_door_ads ? ' Учитываются только объявления, ведущие на свой сайт магазина; ещё ' + esc(prods.other_door_ads) + ' ведут в другое место (' + Object.entries(prods.other_doors || {}).sort((a, b) => b[1] - a[1]).map(([d, n]) => esc(d) + ' ' + esc(n)).join(', ') + ') и в списки и продукты не попали.' : '') + '</p>');
    if (prods.excluded_pages && prods.excluded_pages.length) {
      out.push('<p class="mut">Исключено как вне ниши (' + esc(prods.excluded_count) + ' страниц; красный флаг в названии или в трети объявлений): ' + prods.excluded_pages.slice(0, 40).map(e => esc(e.page) + ' (' + e.flags.map(esc).join(', ') + ')').join('; ') + (prods.excluded_count > 40 ? ' и ещё ' + esc(prods.excluded_count - 40) + ' (полный список в Excel, лист «Вне ниши»)' : '') + '. Эти страницы не попадают в долгожители, свежие запуски и образцы; решение за вами.</p>');
    }
    out.push(table(['Продукт', 'Оценка', 'Магазинов', 'Дней', 'Объявл.', 'Вариантов', 'Новых за 7 дн.', 'Цена', 'Замечания', 'Объявление', 'Магазин'],
      prods.top.slice(0, 25).map(p => [esc(p.name), p.strong ? chip('сильный', 'ok') : p.early ? chip('подходит') : chip('нет', 'warn'), esc(p.stores), esc(p.oldest_days), esc(p.ads), esc(p.variants), esc(p.fresh_ads),
        p.price ? esc('$' + (p.price.min === p.price.max ? p.price.min : p.price.min + '–' + p.price.max)) : '-', esc((p.red_flags.length ? p.red_flags : p.reasons).join('; ')) + (p.caution ? (p.red_flags.length || p.reasons.length ? ' ' : '') + chip('осторожно: ' + p.caution, 'warn') : ''),
        p.ad_urls.map((u, k) => link(u, 'объявление ' + (k + 1))).join(' '), p.store_urls.map((u, k) => link(u, 'магазин ' + (k + 1))).join(' ')])));
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
    const vs = v.videos || {};
    if (vs.analysed) {
      const DUR = { '<15': 'до 15 с', '15-30': '15–30 с', '30-60': '30–60 с', '>60': 'больше минуты' };
      out.push(`<p><b>Видео разобрано по кадрам: ${esc(vs.analysed)}.</b> Длина: ${Object.entries(vs.durations || {}).map(([k, n]) => chip((DUR[k] || k) + ' · ' + n)).join('')} Ориентация: ${Object.entries(vs.aspects || {}).map(([k, n]) => chip(k + ' · ' + n)).join('')}</p><p class="mut">У разобранных видео в галерее раскадровка: 0–3 с (хук), четверти ролика и финал.</p>`);
    }
    const kindOf = g => (g.video ? 'видео ' + Math.round(g.video.duration) + ' с' + (g.video.aspect ? ' · ' + g.video.aspect : '') : KIND[g.kind] || g.kind);
    out.push('<div class="gal">' + v.items.slice(0, 60).map(g => {
      const src = m.images && (m.images[g.thumbs[0]] || m.images[g.files[0]]);
      return `<figure class="card${g.video ? ' wide' : ''}">${src ? `<img class="cr" alt="Креатив ${esc(g.page)}" src="${esc(src)}">` : '<div class="mut">нет миниатюры</div>'}<figcaption><b>${esc(g.page)}</b><br><span class="mut">${esc(kindOf(g))} · ${esc(g.days)} дн.${g.long_running ? ' · долгожитель' : ''}</span><br>${tagChips(g)}${g.notes ? `<br><span class="mut">${esc(g.notes)}</span>` : ''}<br>${link(g.url, 'объявление')}</figcaption></figure>`;
    }).join('') + '</div>');
  }

  if (m.eu && m.eu.ads > 0) {
    const eu = m.eu, share = o => Object.entries(o || {}).map(([k, v]) => chip(k + ' ' + Math.round(100 * v) + '%'));
    out.push('<h2>ЕС: охват и аудитория</h2><div class="note">Данные Meta только для объявлений, показанных в ЕС: охват в людях по каждому объявлению, таргетинг (возраст, пол, страны) и возрастно-половой состав тех, до кого реклама дошла. Охват объявлений одного рекламодателя в сумме считает пересекающихся людей дважды: сумма это верхняя граница, а не размер аудитории. Собрано по ' + esc(eu.ads) + ' объявл.</div>');
    out.push('<p><b>Возраст охваченных (все объявления):</b> ' + share(eu.overall.age_share).join('') + '</p>');
    if (Object.keys(eu.overall.gender_share || {}).length) out.push('<p><b>Пол охваченных:</b> ' + share({ мужчины: eu.overall.gender_share.male, женщины: eu.overall.gender_share.female, 'не определён': eu.overall.gender_share.unknown }).join('') + '</p>');
    // No payer column: the payer can be a private person and this file is made to be shared (it stays in Excel).
    out.push(table(['Страница', 'Объявл. с данными', 'Охват, сумма', 'Охват, макс.', 'Возраст таргетинга', 'Пол', 'Страны', 'Главная группа'], eu.per_page.map(p => [
      esc(p.page), esc(p.ads), esc(p.reach_sum), esc(p.reach_max), esc(p.age_min === null ? '' : p.age_min + '-' + p.age_max), esc(p.genders.join(', ')), esc(p.countries.join(', ')), esc(p.top_age_range)
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
    if (r.store_groups.length) out.push(`<section class="card"><h3>Страницы с общим сайтом</h3>${r.store_groups.map(g => `<p><b>${domainLinks(g.site)}</b><br><span class="mut">${esc(g.pages.join('; '))}</span></p>`).join('')}</section>`);
    out.push('</div>');
  }

  if (m.sites && m.sites.length) {
    out.push('<h2>Сайты лидеров</h2><div class="note">Расхождение реклама против сайта это зацепка, а не доказательство: баннеры и всплывающие окна могут не попасть в текст страницы.</div>');
    for (const s of m.sites) {
      if (s.error) { out.push(`<details><summary>${esc(s.page)}</summary><p class="mut">${esc(s.error)}</p></details>`); continue; }
      const c = s.compare || {};
      const img = m.images && m.images[s.screenshot] ? `<img class="shot" alt="Первый экран" src="${esc(m.images[s.screenshot])}">` : '';
      out.push(`<details><summary>${esc(s.page)} · ${esc(s.ads)} объявл.${s.shopify ? ' · Shopify' : ''}</summary><dl>
<dt>Страница</dt><dd>${link(cleanUrl(s.final_url || s.landing), cleanUrl(s.final_url || s.landing) || '(адрес скрыт)')}</dd><dt>Заголовок</dt><dd>${esc(s.title)}</dd>
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
      const showBudget = !!m.withBudget; // the client's numbers: only on request
      out.push('<h3>План теста</h3>' + table(['Раунд', 'Тесты (параллельно)', ...(showBudget ? ['Бюджет'] : [])], p.rounds.map(x => [esc(x.round), esc(x.tests.map(t => t.name + ' (' + t.variable_type + ')').join('; ')), ...(showBudget ? [x.budget === null ? '-' : esc(x.budget)] : [])])));
      out.push(`<p class="mut">Допущения: ${esc(p.assumptions.variants_per_test)} варианта на тест, ${esc(p.assumptions.events_per_variant)} событий оптимизации на вариант (ориентир), не меньше ${esc(p.assumptions.min_days_per_round)} дней на раунд, ${showBudget ? 'целевой CPA ' + (p.assumptions.target_cpa === null ? 'неизвестен' : esc(p.assumptions.target_cpa)) : 'бюджет и целевой CPA клиента в этот файл не включены (--with-budget добавит их; они есть в Excel)'}.</p>`);
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

  const steps = m.next_steps || [];
  if (steps.length) {
    out.push('<h2>Что ещё можно сделать</h2><p class="mut">Шаги, которые для этого среза ещё не сделаны: выводы выше на них не опираются.</p>');
    out.push(steps.map(s => `<div class="note${s.urgent ? ' urgent' : ''}"><b>${esc(s.title)}</b>${s.urgent ? ' ' + chip('срочно', 'warn') : ''}${s.needs ? ' ' + chip(s.needs) : ''}<br>${esc(s.why)}<br><span class="mut">${esc(s.how)}</span></div>`).join(''));
  }

  out.push(`<hr><p class="mut">Сформировано ${esc(m.generated || '')}${m.version ? ' · meta-ads-niche-report ' + esc(m.version) : ''}. Данные: публичная Библиотека рекламы Meta, ${m.visuals ? 'тексты и картинки объявлений' : 'только текст объявлений'}. Инструмент не связан с Meta и Anthropic. Автоматический сбор может противоречить условиям Meta: ответственность за использование на пользователе.</p>`);

  // Contents: an anchor before every section heading and a line of links under the header (numbers come from CSS counters).
  const toc = [];
  const body = out.map(part => String(part).replace(/<h2>([^<]+)<\/h2>/g, (all, text) => {
    toc.push(text);
    return `<span class="anchor" id="s${toc.length}"></span>` + all;
  }));
  const hi = body.indexOf('</header>');
  if (toc.length > 2 && hi >= 0) body.splice(hi + 1, 0, '<nav class="toc" aria-label="Разделы">' + toc.map((t, k) => `<a href="#s${k + 1}">${t}</a>`).join('') + '</nav>');
  out.length = 0;
  out.push(...body);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Ads Library: ${esc(title)} ${esc(dateStr)}</title><style>${CSS}</style></head><body><main>${out.join('\n')}</main></body></html>`;
}

module.exports = { buildHtml, mdToHtml, domainLinks, esc, safeUrl, cleanUrl };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const noImages = args.includes('--no-images') && args.splice(args.indexOf('--no-images'), 1);
  const li = args.indexOf('--lang');
  const lang = li >= 0 ? args.splice(li, 2)[1] : 'ru';
  if (!['ru', 'uk'].includes(lang)) { console.error('--lang must be ru or uk'); process.exit(1); }
  const withBudget = args.includes('--with-budget') && args.splice(args.indexOf('--with-budget'), 1);
  const dir = args[0];
  if (!dir || !fs.existsSync(path.join(dir, 'ads.csv'))) {
    console.error('Usage: node export_html.js <snapshot-folder-with-ads.csv> [--out file.html] [--no-images] [--with-budget] [--lang ru|uk]');
    process.exit(1);
  }
  const { loadSnapshot } = require('./report.js');
  const snap = loadSnapshot(dir);
  const read = f => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
  const model = { ...snap, analysis: fs.existsSync(path.join(dir, 'analysis.md')) ? fs.readFileSync(path.join(dir, 'analysis.md'), 'utf8') : '', sites: read('sites.json'), hypotheses: read('hypotheses.json'), lint: read('hypotheses_lint.json'), plan: read('test_plan.json'), diff: read('diff.json'), images: {}, withBudget: !!withBudget, generated: new Date().toISOString().slice(0, 10) };
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
  fs.writeFileSync(out, require('./i18n.js').translateHtml(buildHtml(model), lang), 'utf8');
  console.log(`Saved: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, single file)`);
}
