# Changelog

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
  Ukrainian mobile number (`+380501234567`) with the same placeholder used
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
