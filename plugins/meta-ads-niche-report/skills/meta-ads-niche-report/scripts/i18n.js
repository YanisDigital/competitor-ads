// Ukrainian version of the report's own text (headings, labels, warnings, next steps, notes). Tables are in i18n_uk.json.
//
// Only OUR text is translated. A text node is translated when its whole text is a known label (exact), matches a known sentence
// pattern, or contains a long known static piece of one of our sentences (fragments of 12 or more characters); then all the
// fragments are applied to it, longest first. Ad texts, page names and anything else a third party wrote never match, so they stay
// as they are. The same tables are read by export_xlsx.py.
const fs = require('fs');
const path = require('path');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n_uk.json'), 'utf8'));
const FRAGMENTS = [...T.fragments].sort((a, b) => b[0].length - a[0].length);
const ANCHOR = 12; // a fragment this long (or longer) in a text marks it as ours
const PATTERNS = T.patterns.map(([re, rep]) => [new RegExp(re), rep.replace(/\\(\d)/g, '$$$1')]);
const AFTER = T.after || [];

function trText(text, lang) {
  if (lang !== 'uk' || typeof text !== 'string' || !text) return text;
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  if (Object.prototype.hasOwnProperty.call(T.exact, core)) return lead + T.exact[core] + trail;
  if (core.includes(', ') && core.split(', ').every(x => Object.prototype.hasOwnProperty.call(T.exact, x))) return lead + core.split(', ').map(x => T.exact[x]).join(', ') + trail; // a list of doors or formats
  for (const [re, rep] of PATTERNS) if (re.test(core)) return lead + core.replace(re, rep) + trail;
  if (!FRAGMENTS.some(([ru]) => ru.length >= ANCHOR && text.includes(ru))) return text;
  let out = text;
  for (const [ru, uk] of FRAGMENTS) out = out.split(ru).join(uk);
  for (const [a, b] of AFTER) out = out.split(a).join(b);
  return out;
}

// A whole HTML file: text nodes only (not <style>, not attributes), then lang, <title> and the alt texts we write.
function translateHtml(html, lang) {
  if (lang !== 'uk') return html;
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = html.split(/(<style[\s\S]*?<\/style>)/);
  const out = parts.map(p => (p.startsWith('<style') ? p : p.replace(/>([^<>]+)</g, (m, raw) => {
    const t = unesc(raw), t2 = trText(t, 'uk');
    return t2 === t ? m : '>' + esc(t2) + '<';
  })));
  return out.join('')
    .replace(/<html lang="ru"/, '<html lang="uk"')
    .replace(/(<title>|<h1[^>]*>)Ads Library: /g, '$1Бібліотека реклами: ')
    .replace(/alt="Креатив /g, 'alt="Креатив ').replace(/alt="Первый экран"/g, 'alt="Перший екран"');
}

module.exports = { trText, translateHtml, tables: T };
