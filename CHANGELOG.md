# Changelog

## [0.12.0] - 2026-10-02

### Added
- Report warnings (`warnings` in `report.js` output, a "Предупреждения" block
  in the Excel summary and at the top of the HTML report): small sample (fewer
  than 10 advertisers: findings are hypotheses, not trends), queries where
  Meta refused "load more", queries with no ads, the preset's `seasons`
  (windows as `MM-DD`, may wrap the new year) and its `policy` note.
- Presets gained `seasons` / `policy` where they apply: `craft-beer-ua`
  (Oktoberfest, New Year, alcohol), `beauty` (8 March, New Year), `dentistry`
  (health claims), `fitness` (January, summer, weight claims), `auto-service`
  (tyre seasons), `ecom-dropship-us` (Black Friday, Christmas gifts),
  `infobiz-marketing` / `infobiz-beauty` (income claims).
- `scripts/suggest_queries.js`: after curation keeps only the queries that
  found at least one competitor, explains each dropped one (`no ads`,
  `no competitors`), marks keepers that are mostly noise and prints a ready
  `services` list (Russian-only variants go under `ru`, Latin and neutral
  queries under `uk`; a service may have a single language).
- Tests (`tests/warnings.test.mjs`, 78 in total).

### Changed
- `SKILL.md`: tell the user the warnings before any conclusion, be careful in
  season, and keep presets by `suggest_queries.js` with the user's consent.
- The reports of three existing snapshots are unchanged (checked before and
  after); `warnings` is a new top-level field.

## [0.11.0] - 2026-10-02

### Added
- `curation.json` next to `ads.csv`: a hand-checked list of the advertisers
  that count (`include`, a whitelist whose values become advertiser types),
  or that do not (`exclude`), plus `notes`. `report.js`, `export_xlsx.py` and
  `export_html.js` build from the kept advertisers only and show the types
  and a note on what was removed; names that match no advertiser are listed in
  `meta.curation.not_found`. Without the file nothing changes (the reports of
  three existing snapshots are identical before and after, only `query_stats` is new).
- Per-query statistics (`query_stats`, sheet "Запросы" in Excel, a section in
  the HTML report): ads and advertisers per query, how many advertisers are
  real competitors after curation, and whether Meta refused "load more".
  Shows which queries find competitors and which only bring noise.
- Preset `craft-beer-ua` (Ukrainian craft beer, 11 queries chosen by which ones
  found real competitors).
- Tests for all of this (`tests/curation.test.mjs`, 66 in total).

### Changed
- `SKILL.md`: clean advertisers by meaning, not by keywords (a keyword filter
  let a bath house with "beer unlimited" through), ask about doubtful ones,
  save the decision in `curation.json`, use `query_stats` to replace weak
  queries, and call small samples hypotheses, not trends.
- `report.js` also prints `query_stats`.

## [0.10.5] - 2026-10-01

### Security
- `export_xlsx.py`: text from third parties (ad copy, page names, hypotheses)
  that starts with `=` could become a live formula in `report.xlsx`
  (`parseCsv` removes the CSV quote prefix, and openpyxl treats `=...` as a
  formula), e.g. `WEBSERVICE` sending cell contents to another host. Only the
  workbook's own summary formulas are kept now; everything else is text.
- `check_sites.py`: landing links come from ads, so only public http(s)
  addresses are opened. Localhost, private networks, link-local and
  cloud-metadata addresses, other schemes, and redirects or sub-requests
  into them are blocked; downloads are off.

### Changed
- `.gitignore` also covers `client.json`, `report.xlsx`, `report.html`,
  `sites.json`, `sites/`.
- `references/browser-mode.md`: prefer the built-in browser or a profile that
  is not signed in to Facebook; collecting through a personal Chrome ties the
  activity to that account.
- `CHANGELOG.md` no longer prints the phone-like number removed from fixtures.
- Tests: `export_xlsx.test.mjs`, `check_sites.test.mjs` (55 in total).

## [0.10.4] - 2026-10-01

### Fixed
- `scrape.py` collected nothing after the first query in headless Chromium:
  the in-page search box returned "no ads match" and crashed the page by the
  third search. Every query is now opened by its own URL, and records are
  carried over with the new `window.__mai.load()`.
- `collect()` re-read the first page's embedded JSON on every query and
  credited those ads to each new query, which inflated per-query counts.

### Added
- Meta's "Rate limit exceeded" reply to "load more" requests is detected:
  scrolling stops, `collect()` returns `rate_limited`, `scrape.py` prints
  which queries hold only the first batch (~30 ads) and writes them to
  `run.json` as `rate_limited_queries`. Nothing is worked around.
- `beauty` preset: makeup (`макіяж` / `макияж`).
- Tests for the browser glue (`tests/browser_glue.test.mjs`, 53 in total).

### Changed
- `SKILL.md` and troubleshooting: if a browser tool does not respond, report
  it instead of waiting and retrying; do not run `scrape.py` in a cloud
  container, where facebook.com is unreachable.

## [0.10.3] - 2026-09-30

### Added
- HTML report in one file: `scripts/export_html.js <snapshot>` writes
  `report.html` with no external files, fonts or scripts (charts are CSS,
  screenshots embedded as data URIs, a strict Content-Security-Policy). It
  contains the summary, structure charts, advertisers, long-running ads, page
  networks and, when the files exist, the site check, hypotheses with the lint
  results and test plan, and changes between snapshots. `client.json` is
  never included. All values are HTML-escaped and links are limited to
  http(s), because ad text is written by third parties. Node.js only.

### Changed
- `report.js` also works as a module (`loadSnapshot()`); its CLI output is
  unchanged.

## [0.10.2] - 2026-09-30

### Added
- Hypotheses from dynamics: `diff.json` gets a `dynamics` block.
  `scaling_hooks`/`scaling_examples` (hooks and ads that gained creative
  variants), `failed_hooks` (hooks over-represented among young tests that
  disappeared vs the survivors; only from confident stops, and only with 20+
  young tests and 5+ gone, otherwise `failed_hooks_enough_data` is false),
  `new_entrants` (new advertisers with 2+ ads: formats, hooks, example) and
  `format_shift` (moves of at least 5 points). Hooks are counted per
  advertiser with `advertisers`, `top_share` and `strength`, like in the
  single-snapshot hypotheses. `compare.js` uses the newer snapshot's preset
  for niche hooks and prints a dynamics summary.
- `SKILL.md`: rules for writing hypotheses from dynamics (follow what is
  being scaled, avoid or invert what failed, watch new entrants), with the same
  honesty rules; such hypotheses are marked `"source": "dynamics"`.

## [0.10.1] - 2026-09-30

### Added
- Prioritization and test plan: `prioritizeHypotheses()` and `planTests()`
  in `collector.js`, `scripts/plan_tests.js <snapshot>`. Score = evidence
  strength x readiness / effort; readiness comes from the client brief
  (confirmed 1, not asked 0.5, denied 0) and is halved by text lint errors.
  Rounds of at most 2 parallel tests with different variable types; budget
  per round = 2 variants x 50 optimization events x `client.target_cpa`
  (a rule of thumb, null without a target CPA). Output `test_plan.json` and a
  "План тестов" Excel sheet.
- Optional hypothesis fields `hook`, `evidence_strength`, `effort`,
  `variable_type`; optional `target_cpa` in `client.json`.

## [0.10.0] - 2026-09-30

### Added
- Automatic checks of ad-hypothesis texts: `lintHypotheses()` in
  `collector.js` and `scripts/lint_hypotheses.js <snapshot>`. Checks required
  fields, headline length (~40), visible primary text (~125 characters),
  unfilled placeholders, risky wording (personal attributes, health/absolute
  claims, before/after, superlatives, all caps, exclamation marks, urgency
  without a real deadline or stock limit, Meta brand names) and, with a
  `client.json`, claims the client has not confirmed (guarantee days, rating,
  review count, discount, prices not in the brief, hooks marked blocked or
  unknown). Output: `hypotheses_lint.json`; the script exits 1 when any
  hypothesis has errors. The Excel "Гипотезы" sheet gets an "Автопроверка"
  column.
- `SKILL.md`: Claude runs the check before showing hypotheses, fixes every
  error itself without rewording only to dodge a pattern, and tells the user
  these are heuristics, not Meta's review.

## [0.9.0] - 2026-09-30

### Added
- Client brief for ad hypotheses: `client.json` (template
  `client.example.json`; `null` = not asked yet, `false`/`0` = not true).
  `checkClientFit(client, hooks)` in `collector.js` marks each hook `ready`
  (client confirmed the fact), `blocked` (client said it is not true),
  `unknown` (with the fields still to ask) or `n/a`. `scripts/client_fit.js
  <snapshot>` applies it to a snapshot's winning and under-used hooks and
  lists the questions still open.
- `SKILL.md`: before writing hypotheses Claude asks up to 5 questions, saves
  `client.json`, writes hypotheses only for usable hooks, and substitutes
  confirmed facts verbatim instead of placeholders; blocked claims are never
  written.

## [0.8.1] - 2026-09-30

Fixes an overstatement in the hypotheses inputs found while writing the
first real hypotheses: lift was counted over ads, so one advertiser running
many copies looked like a niche trend (in a live US run, each "winning" hook
came from 2-4 advertisers, one of them dominating).

### Changed
- `hypothesis_inputs.winner_hooks` and `underused_hooks` are counted per
  advertiser, with pages that share a site merged into one. Each hook now has
  `advertisers`, `top_advertiser`, `top_share`, `strength`
  (`strong`: 5+ advertisers and none above 50%; `moderate`: 3+ and none above
  70%; else `weak`), `circular` (the hook's words appear in the run's own
  search queries) and up to 3 `examples` (advertiser, ad link, text).
  `winner_hooks` are ranked by strength first.
- `SKILL.md` hypothesis rules use these fields: a `weak` hook is one
  competitor's habit, not a niche trend; circular hooks are not used; every
  hypothesis states its signal strength and cites examples; a broad pattern
  is the control of a test, not an empty niche.
- `hypotheses.json` may carry `signal_strength`; the Excel "Гипотезы" sheet
  has a matching column.

## [0.8.0] - 2026-09-30

### Added
- Report section 9, "ready-made ad hypotheses". `report.hypothesis_inputs`
  gives Claude the evidence: `underused_hooks`, `winner_hooks` (share among
  long-running ads vs the rest, with lift; only when there are at least 5
  long-running ads), `winner_formats`/`winner_ctas`/`winner_doors`, and
  `price_anchors`. `SKILL.md` defines the rules (3-5 hypotheses, each tied to
  data, no verbatim copying, placeholders for client facts, Meta policy
  risks, one variable and a metric per test) and the per-hypothesis format.
- `export_xlsx.py` adds a "Гипотезы" sheet when `hypotheses.json` (written by
  Claude, schema in `SKILL.md`) is next to the snapshot.

## [0.7.0] - 2026-09-30

### Added
- Landing-page check: `scripts/check_sites.py <snapshot> [--top 5]` opens the
  landing page the leading advertisers' ads actually link to and writes
  `sites.json` + first-screen screenshots: title, headings, prices, hooks,
  Shopify detection (by page resources, so it works on custom domains), and a
  comparison with the advertiser's ads (promised but not on the page, on the
  page but not advertised, ad prices not found). Bot challenges are skipped,
  never bypassed; at most 10 sites per run.
- `collector.js`: `siteFacts(text, opts)` and `compareAdVsSite(ad, site)`
  (also on `window.__mai` for browser mode); `top_pages[].landing` (the most
  common own landing URL per advertiser, tracking parameters stripped).
- `report.js <folder> [preset]` accepts a preset override for snapshots
  without `run.json`.

### Changed
- Price extraction and hook selection in `buildReport` moved into shared
  helpers (`priceHits`, `hookPatterns`); no behavior change.

## [0.6.0] - 2026-09-30

### Added
- Excel export: `scripts/export_xlsx.py <snapshot-folder>` writes
  `report.xlsx` (summary with COUNTIF formulas, all ads, all advertisers,
  long-running ads, page networks, and a "Changes" sheet when `diff.json`
  exists). Needs `openpyxl`, never installed silently.
- `scripts/report.js`: rebuilds the full report for a snapshot from its
  `ads.csv` using `collector.js` and the snapshot's preset, so the export
  (and any future tool) always uses the current report logic instead of a
  possibly outdated `report.json`.

## [0.5.1] - 2026-09-30

### Changed
- `scrape.py` without `--out` now saves to `out/<preset or query slug>/<date>/`
  (`-2`, `-3` for repeat runs on the same day), so repeated runs are
  separate snapshots.
- `compare.js out/<niche>` compares the two latest snapshots in a folder on
  its own, and notes when the two snapshots used different queries.
- `SKILL.md`: instructions for Claude to make and compare snapshots on plain
  requests ("make a snapshot", "compare with the previous one") without the
  user touching a terminal, and what to do in a plain chat without file access.

## [0.5.0] - 2026-09-30

### Added
- Snapshot comparison: `scripts/compare.js <older> <newer>` writes
  `diff.json` (new ads, stopped ads, share of young tests that disappeared,
  ads that gained creative variants, pages that appeared/vanished/grew).
  Logic is `diffSnapshots()` in `collector.js`; `parseCsv()` reads an
  `ads.csv` back (inverse of `toCsv`, undoes the formula-injection prefix).
- A missing ad is only a confident stop if one of its queries was re-run and
  returned fewer than 90 ads; otherwise it may have dropped out of the top
  of the results (the library shows ~120 ads per query).
- `scrape.py` writes `run.json` (date, country, queries, preset) next to
  the report, used as the snapshot date.

## [0.4.3] - 2026-09-29

### Added
- `creative_clusters`: the same ad copy running on 2+ different pages
  (copied creative / page network), with pages, ad count and oldest age.
- `store_groups`: several pages sending traffic to the same own site.
  On the third live US run these exposed networks like one posture-corrector
  ad on 3 pages (~920 days) and "Community" pages sharing one supplement store.

### Fixed
- Local-business detection had a false positive on an online store (a single
  "visit us"/"come in" phrase). Signals are now strong (address "City, ST
  12345", "Get directions", "free estimate", "law firm", "dealership", ...)
  or weak ("visit us", "book now": only when at least half of a page's ads
  have one). Verified offline against a real 781-ad export.

## [0.4.2] - 2026-09-29

Fixes from the second live `ecom-dropship-us` run (407 ads), where local
pet shops, tint shops, Amazon/eBay/Temu and affiliate bloggers filled the
results and old local pages topped the "longrun" list.

### Added
- Door `Партнёрская ссылка` (`urlgeni.us`, `geni.us`, `amzlink.to`,
  `amzn.to`, ...), not listed as an advertiser's site.
- Report: `local_pages` (physical-business CTAs/phrases), `platform_pages`
  (all ads go to marketplaces/app stores), `shopify_stores`
  (`*.myshopify.com` sites); `local`/`platform` flags on `top_pages`.
- `report({onlineOnly: true})` (preset flag `online_only`) removes local and
  platform pages from `longrun` and `samples`.

### Changed
- `longrun` is ranked by creative variants first, then age: many variants of
  one ad means active testing.
- `ecom-dropship-us` queries specific products ("car door lock cover", "pet
  stain remover", "led car lights", ...) instead of broad categories.

## [0.4.1] - 2026-09-29

Fixes from the first live `ecom-dropship-us` run (165 ads).

### Fixed
- Catalog/DPA ads with an unresolved `{{product.brand}}` and no card text:
  placeholders are stripped, the ad gets `catalog: true`, and the report
  has `catalog_ads`.
- `tiktok.com` was treated as a marketplace, so TikTok's own ads landed in
  "Маркетплейс" (only `shop.tiktok.com` now). App Store/Google Play links
  are a separate door "Установка приложения"; `bit.ly` and other short
  links are "Короткая ссылка" (the real destination is hidden), and neither
  is listed as an advertiser's own site.
- Ukrainian base hooks were reported (all zero) for a US niche. Presets can
  set `base_hooks: false`; `report({baseHooks: false})` reports only the
  preset's hooks.
- `ecom-dropship-us` queried hook phrases ("50% off today only"), which
  matched realtors, charities and coaches and made the hook counts
  circular. It now queries product categories, has hooks for discount,
  bonus/gift, urgency, personalization, "original vs knockoff", and a
  longer noise list.
- `__mai.scroll()` stopped early on the first page after opening (30 ads vs
  114 on later queries): at least 5 rounds and 4 idle rounds now, and
  `scrape.py` waits for `networkidle` before the first collect. Not yet
  re-verified on a live run.

## [0.4.0] - 2026-09-29

### Added
- Presets for online niches: `ecom-dropship-us` (English queries by
  product type and offer phrase, country US, prices in USD, hooks: free
  shipping, BOGO, limited stock, TikTok/viral, money-back, reviews,
  urgency), `infobiz-marketing` and `infobiz-beauty` (webinars, lead
  magnets, "from zero", student results, seats/cohort start, certificates,
  practice on models).
- Presets may set `country` and `currency`; `scrape.py` uses the preset's
  country unless `--country` is given.
- `report({currency: 'USD'})`: dollar prices and "was $X now $Y" /
  "$Y (was $X)" discount pairs. `prices` now also has `currency`,
  `pct_off_mentions` and `median_pct_off` ("50% off", "знижка 20%", "-15%").
- Doors: `Маркетплейс` (Prom, Rozetka, OLX, Kasta, Amazon, Etsy, eBay,
  Walmart, Temu, AliExpress, TikTok Shop) and `Telegram-бот` (t.me links
  ending in "bot"). Marketplace domains are no longer listed as an
  advertiser's own site.

## [0.3.1] - 2026-09-29

### Added
- README (EN/RU): "Niche presets" section with preset ids and how to add one.
- `scrape.py --list-presets`.

### Changed
- `SKILL.md`: an explicit rule to use a matching preset without asking,
  say which one was used, and offer to save custom queries as a new preset.

## [0.3.0] - 2026-09-29

### Added
- Niche presets in `presets/` (beauty, dentistry, fitness, auto-service):
  services in Ukrainian/Russian, niche-specific hook regexes, and noise
  words. `buildQueries(preset, cities, max)` turns them into search queries
  (also `window.__mai.buildQueries`); `scrape.py` gets `--preset`,
  `--city-uk`, `--city-ru`, `--max-queries`.
- `report({extraHooks, noise})`: preset hooks are counted in `hook_freq`;
  `noise_candidates` lists pages whose ads mention noise words (courses,
  schools, ...) for review — nothing is removed automatically.
- Generic `адрес/район` hook (📍, вул., район, метро, ...).
- Express mode (`--express`, or "quick look" in SKILL.md): first 3 queries,
  report sections 1, 3 and 6 only.

### Changed
- `scrape.py` search-field selectors: the live field is
  `input[type=search]` ("Search by keyword or advertiser"), now tried first.

### Not included
- An in-page `__mai.search(q)`. Tested live: the Ads Library ignores
  synthetic Enter and `popstate` events, so a new search needs real input
  from the browser tool. Documented in `references/browser-mode.md`.

## [0.2.2] - 2026-09-29

### Fixed
- `classifyDoor`: a "Send message" ad whose link is `instagram.com` or
  `facebook.com` is now Direct/Messenger, not a profile ad. v0.2.0/0.2.1
  put the domain check first, so in a live run ~70% of Direct ads were
  reported as "Instagram profile".
- The `library_says` counter only matched English ("results"); it now also
  reads Ukrainian/Russian UI, so the captured-vs-shown check works there too.
- `__mai.scroll()` is adaptive: scrolls until the buffer stops growing for
  3 rounds (max 15), instead of a fixed 6 rounds that missed late GraphQL
  responses (29 of 49 ads captured in a live run).

### Added
- Report: `prices` (ads with a price, min/median/max, median discount from
  "X замість Y" pairs); `library_url` per advertiser and `url` per longrun
  ad so creatives open in one click.
- `longrun` keeps at most 2 ads per advertiser; `samples` uses each
  advertiser's oldest ad.

## [0.2.1] - 2026-09-28

Security/privacy review of the published v0.2.0 repo and release.

### Fixed
- `toCsv`: a field starting with `=`, `+`, `-`, or `@` (a formula-injection
  payload an advertiser could put in an ad's title/body/CTA/page name) is
  now prefixed with a quote, so Excel/Google Sheets treat it as text
  instead of evaluating it as a formula when `ads.csv` is opened.
- `tests/fixtures/whatsapp-ad.json`: replaced a plausible-looking real
  Ukrainian mobile number with the same placeholder used
  elsewhere in the fixtures (`380000000000`).
- `examples/sample-report.md`: renamed advertisers to `Salon A`–`Salon J`
  (matching the fictional-name convention CLAUDE.md asked for) — a couple
  of the previous names ("Nail Bar Odesa", "Beauty Point", "Manicure Lab")
  read as plausible real business names for the niche/city they're set in.

### Added
- `SKILL.md` and `references/browser-mode.md`: an explicit note that ad
  text (title/body/cta) is untrusted third-party data, not instructions —
  any command-like text embedded in an ad should be treated as ordinary ad
  copy, never acted on.
- A `toCsv` test covering the formula-injection fix.

## [0.2.0] - 2026-09-28

Rebuild of the v0.1 prototype into a repo other people can install and Claude
Code can keep developing.

### Added
- `scripts/scrape.py`: a Playwright-based CLI collector, so the skill works
  in Claude Code without browser MCP tools. Installs `collector.js` via
  `page.add_init_script`, drives the Ads Library's search SPA, and writes
  `out/<slug>/report.json` + `out/<slug>/ads.csv`. Refuses to continue past a
  login wall or captcha/checkpoint. Capped at 15 queries per run.
- `tests/` (`node:test`) with 8 synthetic Ads Library fixtures covering a
  plain ad, a DCO ad, a carousel, an `l.facebook.com` redirect link, `wa.me`,
  `t.me`, no link, and a generic "Send message" CTA.
- `references/browser-mode.md`, `references/field-mapping.md`,
  `references/troubleshooting.md` — split out of SKILL.md so it stays under
  500 lines and this environment's tool names live in one place.
- `.claude-plugin/marketplace.json` and
  `plugins/meta-ads-niche-report/.claude-plugin/plugin.json`, so the skill
  installs as a Claude Code plugin via `/plugin marketplace add`.
- `LICENSE` (MIT), `examples/sample-report.md` (fictional data).

### Changed
- `collector.js` split into pure, unit-testable functions (`normalizeAd`,
  `classifyDoor`, `domainOf`, `buildReport`, `toCsv`) plus a browser-glue
  layer (`installBrowser`) that installs `window.__mai`. Same file now works
  both pasted into a page and `require()`'d from Node for tests.
- `SKILL.md` rewritten as v0.2: picks a collection mode (browser tools vs.
  CLI) instead of assuming a browser is available, and country/city are
  parameters — Odesa/Ukraine are kept only as an example.
- Hook-detection patterns moved into a `HOOK_PATTERNS` config object with
  Ukrainian/Russian/English coverage (previously Ukrainian/Russian only).

### Fixed
- DCO ads: when `snapshot.title`/`body` carried an unresolved
  `{{product.name}}` template, the collector now substitutes the first
  non-empty `snapshot.cards[]` entry instead of showing the literal template,
  and records `ncards`.
- `classifyDoor`: a link to `t.me` with a generic "Message" CTA was
  misclassified as generic Messenger instead of Telegram, because the CTA
  regex ran before the domain check. Domain checks now run first.
- CLI mode: the embedded-JSON scan (the "first load" SSR data path) ran once
  at `page.add_init_script` time, before the DOM existed, so it silently
  missed that data path. It now re-runs on every `collect()` call.
- `scrape.py`: `slugify()` dropped Cyrillic characters entirely (NFKD+ASCII
  has no Cyrillic decomposition), so every Ukrainian/Russian query produced
  the same generic `out/niche/` folder. Added Cyrillic-to-Latin
  transliteration. Argument validation also now runs before Playwright is
  imported, so a missing `--keywords` gives a clear message even before
  Playwright is installed.
- `SKILL.md` frontmatter: an unquoted `description` containing `": "`
  (colon + space) inside a plain YAML scalar failed to parse silently —
  Claude Code loads such a skill with empty metadata instead of erroring.
  Found by running `claude plugin validate`. Quoted the description.
- `SKILL.md` frontmatter: the description also used `<city>` as a
  placeholder, which claude.ai's skill-upload validator rejects as an XML
  tag. Found by uploading the skill to claude.ai. Reworded to avoid angle
  brackets.

## [0.1.0] - Prototype

Initial version, developed and tested live against the Meta Ads Library
(beauty salons and dental clinics, Odesa) before this repository existed.

- `SKILL.md` + `collector.js`: browser-only workflow — install the collector
  via a JS-execution tool, drive the Ads Library's SPA search, scroll,
  collect, and aggregate into a report (doors, CTAs, hook frequencies,
  longest-running ads).
- Known gap carried into this rewrite and fixed in 0.2.0: DCO ads showed
  their raw `{{product.name}}` template instead of real text.
