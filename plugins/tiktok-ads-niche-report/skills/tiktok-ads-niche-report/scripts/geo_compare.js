#!/usr/bin/env node
// Compares TikTok snapshots of several places (countries, or cities of one country) side by side, after each one's curation.json,
// niche.json and preset.
//
//   node geo_compare.js <folder> <folder> [more folders...] [--labels "PL" "DE" ...] [--out report_geo.html] [--json]
//
// One row per place: ads, unique creatives, advertisers, advertisers with a single ad, the biggest advertiser and its share, the main
// door by advertiser, price, long and fresh runs, the most used hooks. Then who runs in more than one place (a chain or an agency) and
// the hooks per place. Shares are by advertisers, not ads: one big advertiser with dozens of copies does not decide the picture.
// Snapshots made with different sources or dates are not strictly comparable: the run.json differences are listed. Writes HTML
// (default <parent of the first folder>/geo_compare.html) and, with --json, geo_compare.json next to it.
const fs = require('fs');
const path = require('path');
const { loadSnapshot } = require('./report.js');
const { esc } = require('./export_html.js');

const argv = process.argv.slice(2);
const flagValues = n => { const i = argv.indexOf(n); const out = []; if (i < 0) return out; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]); return out; };
const flag = n => flagValues(n)[0];
const optIdx = new Set(['--labels', '--out', '--json'].flatMap(n => { const i = argv.indexOf(n); if (i < 0) return []; const idx = [i]; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) idx.push(j); return idx; }));
const dirs = argv.filter((a, i) => !optIdx.has(i) && !a.startsWith('--'));

const topKey = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

function summarize(dir, label) {
  const snap = loadSnapshot(dir);
  const r = snap.report, adv = r.advertisers || 0;
  const [door, doorN] = topKey(r.doors_by_advertiser);
  const byPage = new Map();
  for (const x of snap.rows) if (x.page) byPage.set(x.page, (byPage.get(x.page) || 0) + 1);
  const rb = r.run_buckets || {};
  return {
    label, dir, source: r.source, ads: r.ads, unique: r.unique_texts, advertisers: adv, single: r.single_ad_advertisers,
    dominant: r.dominant ? { page: r.dominant.page, share: Math.round(100 * r.dominant.share) } : null, door, door_adv: doorN,
    price: r.prices && r.prices.ads_with_price ? { median: r.prices.median, currency: r.prices.currency, ads: r.prices.ads_with_price } : null,
    long: (rb['60-180'] || 0) + (rb['>180'] || 0), fresh: rb['<7'] || 0, hook_ads: r.hook_freq || {}, pages: Object.fromEntries(byPage), run: snap.meta, warnings: snap.warnings.map(w => w.code)
  };
}

function compare(dirList, labels) {
  const slices = dirList.map((d, i) => summarize(d, labels[i] || path.basename(path.resolve(d))));
  const hookNames = [...new Set(slices.flatMap(s => Object.keys(s.hook_ads || {})))].filter(h => slices.some(s => (s.hook_ads[h] || 0) > 0));
  const inMany = new Map();
  for (const s of slices) for (const [page, n] of Object.entries(s.pages)) (inMany.get(page) || inMany.set(page, []).get(page)).push({ label: s.label, ads: n });
  const multi = [...inMany].filter(([, v]) => v.length > 1).map(([page, v]) => ({ page, places: v })).sort((a, b) => b.places.length - a.places.length);
  const differ = [];
  for (const k of ['source', 'country']) {
    const vals = [...new Set(slices.map(s => JSON.stringify((s.run || {})[k] === undefined ? null : s.run[k])))];
    if (vals.length > 1 && k !== 'country') differ.push(`${k}: ${vals.join(' / ')}`);
  }
  return { slices, hook_names: hookNames, multi, differ };
}

function html(c) {
  const th = h => `<th>${esc(h)}</th>`;
  const td = v => `<td>${v}</td>`;
  const head = ['Место', 'Объявлений', 'Уникальных роликов', 'Рекламодателей', 'С 1 объявл.', 'Крупнейший (доля объявлений)', 'Главная дверь', 'Цена (медиана)', 'Долгих показов', 'Моложе 7 дн.'];
  const rows = c.slices.map(s => [esc(s.label), esc(s.ads), esc(s.unique), esc(s.advertisers), esc(s.single), s.dominant ? esc(s.dominant.page) + ' · ' + esc(s.dominant.share) + '%' : '-',
    s.door_adv ? esc(s.door) + ' · ' + esc(s.door_adv) + ' из ' + esc(s.advertisers) : '-', s.price ? esc(s.price.median) + ' ' + esc(s.price.currency) + ' (' + esc(s.price.ads) + ' объявл.)' : '-', esc(s.long), esc(s.fresh)]);
  const hookRows = c.hook_names.map(h => [esc(h), ...c.slices.map(s => ((s.hook_ads[h] || 0) ? esc(s.hook_ads[h]) + ' объявл.' : '-'))]);
  const table = (heads, rs) => `<div class="tw"><table><thead><tr>${heads.map(th).join('')}</tr></thead><tbody>${rs.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Сравнение мест (TikTok)</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:#1c2330;background:#f6f7f9}h2{border-bottom:1px solid #dfe3ea;padding-bottom:.25em}.tw{overflow-x:auto;background:#fff;border:1px solid #dfe3ea;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:7px 10px;border-bottom:1px solid #dfe3ea;text-align:left;vertical-align:top}th{background:#eef1f6}.mut{color:#5b6577}.note{background:#fff;border-left:4px solid #a86400;padding:8px 12px;border-radius:6px;margin:10px 0;font-size:.9rem}</style></head><body>
<h1>Сравнение мест: ${esc(c.slices.map(s => s.label).join(' · '))}</h1>
${c.differ.length ? `<div class="note">Срезы собраны из разных источников, сравнение нестрогое: ${esc(c.differ.join('; '))}.</div>` : ''}
<h2>Сводка по местам</h2>${table(head, rows)}
<p class="mut">Доли считаются по рекламодателям, а не по объявлениям: один крупный рекламодатель с десятками копий не должен решать картину. Выборка в месте меньше 10 рекламодателей это гипотеза, а не тренд.</p>
<h2>Хуки по местам</h2>${hookRows.length ? table(['Хук', ...c.slices.map(s => s.label)], hookRows) : '<p class="mut">Хуков в текстах не найдено.</p>'}
<h2>Рекламодатели в нескольких местах</h2>${c.multi.length ? table(['Рекламодатель', 'Где и сколько объявлений'], c.multi.slice(0, 40).map(m => [esc(m.page), m.places.map(p => esc(p.label) + ': ' + esc(p.ads)).join('; ')])) : '<p class="mut">Нет: каждый рекламодатель только в одном месте.</p>'}
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
