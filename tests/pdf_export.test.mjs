// export_pdf.py: the PDF holds what the HTML report holds; nothing is cut (wide tables) or hidden (closed blocks).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAd, toCsv } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js';
import { mdToHtml } from '../plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_html.js';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'meta-ads-niche-report', 'skills', 'meta-ads-niche-report', 'scripts');
const NOW = 1_790_000_000;
const py = (...args) => spawnSync('python', ['-I', '-X', 'utf8', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 180000 });
const HAS_PW = py('-c', 'import playwright').status === 0;
const HAS_PDFTEXT = py('-c', 'import pypdf').status === 0;

test('analysis.md: a Markdown table becomes a real table (it was printed as raw "|" lines)', () => {
  const h = mdToHtml('| A | B |\n|---|---|\n| 1 <x> | **2** |\nafter');
  assert.match(h, /<div class="tw"><table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1 &lt;x&gt;<\/td><td><b>2<\/b><\/td><\/tr><\/tbody><\/table><\/div>/);
  assert.match(h, /<p>after<\/p>/);
});

test('export_html.js --expand opens every block; the print styles let wide tables wrap', () => {
  const src = readFileSync(path.join(SCRIPTS, 'export_html.js'), 'utf8');
  assert.match(src, /details::details-content\{content-visibility:visible;display:block\}/, 'a closed block is printed open');
  assert.match(src, /\.tw\{overflow:visible;/, 'no scroll box on paper');
  assert.match(src, /td\{overflow-wrap:anywhere/);
});

test('export_pdf.py: a PDF with the wide table, the text of closed hypothesis blocks and the analysis table', { skip: !HAS_PW && 'Playwright is not installed', timeout: 200000 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-'));
  const long = 'Verylongadvertisernamewithoutanyspaces' + 'X'.repeat(30);
  const rows = ['A', 'B', long].map((p, i) => normalizeAd({ ad_archive_id: String(i + 1), page_id: 'p' + i, page_name: p, is_active: true, start_date: NOW - 86400 * (10 + i), publisher_platform: ['facebook'],
    snapshot: { title: 'T', body: { text: 'Ціна 500 грн, запис онлайн ' + i }, cta_text: 'Learn more', cta_type: 'LEARN_MORE', link_url: `https://site${i}.example/a/very/long/path/that/goes/on/and/on/${i}`, display_format: 'IMAGE' } }, 'q'));
  writeFileSync(path.join(dir, 'ads.csv'), toCsv(rows));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ date: new Date(NOW * 1000).toISOString(), country: 'UA', queries: ['q'] }));
  writeFileSync(path.join(dir, 'hypotheses.json'), JSON.stringify([{ name: 'Hypothesis one', signal_strength: 'moderate', angle: 'HIDDENANGLEMARKER inside a closed block', evidence: 'e', headline: 'h', primary_text: 'p', cta: 'c', destination: 'd', format: 'f', test: 't', metric: 'CTR', risk: 'r', confirm_with_client: ['x'] }]));
  writeFileSync(path.join(dir, 'analysis.md'), '## Analysis\n| Who | Note |\n|---|---|\n| TABLECELLMARKER | ok |');
  const out = path.join(dir, 'r.pdf');
  const r = py(path.join(SCRIPTS, 'export_pdf.py'), dir, '--out', out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(out).subarray(0, 4).toString(), '%PDF');
  if (!HAS_PDFTEXT) return;
  const t = py('-c', `from pypdf import PdfReader\nprint("\\n".join(p.extract_text() or "" for p in PdfReader(r"${out}").pages))`);
  const text = t.stdout.replace(/\s+/g, '');
  assert.ok(text.includes('HIDDENANGLEMARKER'), 'the text of a closed block is in the PDF');
  assert.ok(text.includes('TABLECELLMARKER'), 'the analysis table is in the PDF');
  assert.ok(text.includes('Verylongadvertiser'), 'a long name in a wide table is printed, not cut off');
});
