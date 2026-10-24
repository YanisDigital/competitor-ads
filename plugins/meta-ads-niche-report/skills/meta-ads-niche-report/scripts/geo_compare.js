#!/usr/bin/env node
// Compares snapshots of several places (cities, countries) side by side, after each one's curation.json, niche.json and preset.
//
//   node geo_compare.js <folder> <folder> [more folders...] [--labels "Kyiv" "Odesa" ...] [--out report_geo.html] [--json]
//
// One row per place: ads, advertisers, advertisers with a single ad, campaigns, the biggest advertiser and its share, the video
// share and the main door by advertiser, price, old and fresh ads, the most used hooks. Then who runs in more than one place
// (a chain or an agency) and the hooks as shares of advertisers per place. Shares are by advertisers, not ads: one big advertiser
// with dozens of copies does not decide the picture. Snapshots made with different filters or dates are not strictly
// comparable: the run.json differences are listed. Writes HTML (default <parent of the first folder>/geo_compare.html) and, with
// --json, geo_compare.json next to it.
const fs = require('fs');
const path = require('path');
const { loadSnapshot } = require('./report.js');
const { esc } = require('./export_html.js');

const argv = process.argv.slice(2);
const flagValues = n => { const i = argv.indexOf(n); const out = []; if (i < 0) return out; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]); return out; };
const flag = n => flagValues(n)[0];
const optIdx = new Set(['--labels', '--out', '--json'].flatMap(n => { const i = argv.indexOf(n); if (i < 0) return []; const idx = [i]; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) idx.push(j); return idx; }));
const dirs = argv.filter((a, i) => !optIdx.has(i) && !a.startsWith('--'));

const pct = (n, d) => (d ? Math.round(100 * n / d) : 0);
const topKey = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

function summarize(dir, label) {
  const snap = loadSnapshot(dir);
  const r = snap.report, adv = r.advertisers || 0;
  const [door, doorN] = topKey(r.doors_by_advertiser);
  const old = (r.age_buckets['90-365'] || 0) + (r.age_buckets['>365'] || 0);
  const hooks = Object.keys(r.hook_freq || {});
  const byPage = new Map();
  for (const x of snap.rows) byPage.set(x.page, (byPage.get(x.page) || 0) + 1);
  return {
    label, dir, ads: r.ads, advertisers: adv, single: r.single_ad_advertisers, campaigns: (r.campaigns || {}).count,
    dominant: r.dominant ? { page: r.dominant.page, share: Math.round(100 * r.dominant.share) } : null,
    video_adv: (r.formats_by_advertiser || {}).VIDEO || 0, door, door_adv: doorN,
    price: r.prices && r.prices.ads_with_price ? { median: r.prices.median, min: r.prices.min, max: r.prices.max, currency: r.prices.currency, ads: r.prices.ads_with_price } : null,
    old, fresh: (r.fresh || {}).ads || 0,
    hooks: Object.fromEntries(hooks.map(h => [h, (r.hypothesis_inputs.underused_hooks.concat(r.hypothesis_inputs.winner_hooks).find(x => x.hook === h) || {}).advertisers])),
    hook_ads: r.hook_freq, pages: Object.fromEntries(byPage), run: snap.meta, warnings: snap.warnings.map(w => w.code)
  };
}

function compare(dirList, labels) {
  const slices = dirList.map((d, i) => summarize(d, labels[i] || path.basename(path.resolve(d))));
  const hookNames = [...new Set(slices.flatMap(s => Object.keys(s.hook_ads || {})))].filter(h => slices.some(s => (s.hook_ads[h] || 0) > 0));
  const inMany = new Map();
  for (const s of slices) for (const [page, n] of Object.entries(s.pages)) (inMany.get(page) || inMany.set(page, []).get(page)).push({ label: s.label, ads: n });
  const multi = [...inMany].filter(([, v]) => v.length > 1).map(([page, v]) => ({ page, places: v })).sort((a, b) => b.places.length - a.places.length);
  const differ = [];
  for (const k of ['country', 'status', 'language', 'media', 'sort', 'search_type', 'date_from', 'date_to']) {
    const vals = [...new Set(slices.map(s => JSON.stringify((s.run || {})[k] === undefined ? null : s.run[k])))];
    if (vals.length > 1) differ.push(`${k}: ${vals.join(' / ')}`);
  }
  return { slices, hook_names: hookNames, multi, differ };
}

function html(c) {
  const th = h => `<th>${esc(h)}</th>`;
  const td = v => `<td>${v}</td>`;
  const head = ['Гео', 'Объявлений', 'Рекламодателей', 'С 1 объявл.', 'Кампаний', 'Крупнейший (доля объявлений)', 'Видео, рекламодателей', 'Главная дверь', 'Цена (медиана)', 'Старше 90 дн.', 'Моложе 7 дн.'];
  const rows = c.slices.map(s => [esc(s.label), esc(s.ads), esc(s.advertisers), esc(s.single), esc(s.campaigns), s.dominant ? esc(s.dominant.page) + ' · ' + esc(s.dominant.share) + '%' : '-',
    s.advertisers ? esc(s.video_adv) + ' из ' + esc(s.advertisers) + ' (' + pct(s.video_adv, s.advertisers) + '%)' : '-', s.door_adv ? esc(s.door) + ' · ' + esc(s.door_adv) + ' из ' + esc(s.advertisers) : '-',
    s.price ? esc(s.price.median) + ' ' + esc(s.price.currency) + ' (' + esc(s.price.ads) + ' объявл.)' : '-', esc(s.old), esc(s.fresh)]);
  const hookRows = c.hook_names.map(h => [esc(h), ...c.slices.map(s => (s.hook_ads[h] || 0) ? esc(s.hook_ads[h]) + ' объявл.' + (s.hooks[h] !== undefined ? ' · ' + esc(s.hooks[h]) + ' рекл.' : '') : '-')]);
  const table = (heads, rs) => `<div class="tw"><table><thead><tr>${heads.map(th).join('')}</tr></thead><tbody>${rs.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Сравнение гео</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:#1c2330;background:#f6f7f9}h2{border-bottom:1px solid #dfe3ea;padding-bottom:.25em}.tw{overflow-x:auto;background:#fff;border:1px solid #dfe3ea;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:7px 10px;border-bottom:1px solid #dfe3ea;text-align:left;vertical-align:top}th{background:#eef1f6}.mut{color:#5b6577}.note{background:#fff;border-left:4px solid #a86400;padding:8px 12px;border-radius:6px;margin:10px 0;font-size:.9rem}</style></head><body>
<h1>Сравнение гео: ${esc(c.slices.map(s => s.label).join(' · '))}</h1>
${c.differ.length ? `<div class="note">Срезы собраны с разными параметрами, сравнение нестрогое: ${esc(c.differ.join('; '))}.</div>` : ''}
<h2>Сводка по местам</h2>${table(head, rows)}
<p class="mut">Доли считаются по рекламодателям, а не по объявлениям: один крупный рекламодатель с десятками копий не должен решать картину. Выборка в месте меньше 10 рекламодателей это гипотеза, а не тренд.</p>
<h2>Хуки по местам</h2>${hookRows.length ? table(['Хук', ...c.slices.map(s => s.label)], hookRows) : '<p class="mut">Хуков в текстах не найдено.</p>'}
<h2>Рекламодатели в нескольких местах</h2>${c.multi.length ? table(['Страница', 'Где и сколько объявлений'], c.multi.slice(0, 40).map(m => [esc(m.page), m.places.map(p => esc(p.label) + ': ' + esc(p.ads)).join('; ')])) : '<p class="mut">Нет: каждый рекламодатель только в одном месте.</p>'}
<p class="mut">Сети и агентства, которые рекламируются в нескольких местах, лучше разобрать отдельно: у них объявления других городов попадают в общие числа (niche.json: geo_terms и geo_only).</p>
</body></html>`;
}

module.exports = { compare, html };

if (require.main === module) {
  if (dirs.length < 2 || dirs.some(d => !fs.existsSync(path.join(d, 'ads.csv')))) {
    console.error('Usage: node geo_compare.js <folder> <folder> [more...] [--labels "A" "B" ...] [--out report_geo.html] [--json]');
    process.exit(2);
  }
  const labels = flagValues('--labels');
  if (labels.length && labels.length !== dirs.length) { console.error(`--labels needs ${dirs.length} names (one per folder), got ${labels.length}.`); process.exit(2); }
  const c = compare(dirs, labels);
  const out = flag('--out') || path.join(path.dirname(path.resolve(dirs[0])), 'geo_compare.html');
  fs.writeFileSync(out, html(c), 'utf8');
  if (argv.includes('--json')) fs.writeFileSync(out.replace(/\.html$/i, '') + '.json', JSON.stringify({ differ: c.differ, multi: c.multi, slices: c.slices.map(({ run, pages, ...s }) => s) }, null, 2), 'utf8');
  console.log(c.slices.map(s => `${s.label}: ${s.ads} ads, ${s.advertisers} advertisers`).join('\n') + `\nSaved: ${out}`);
  if (c.differ.length) console.log('Not strictly comparable: ' + c.differ.join('; '));
}
