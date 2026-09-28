# Changelog

## [0.2.0] - Unreleased

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

## [0.1.0] - Prototype

Initial version, developed and tested live against the Meta Ads Library
(beauty salons and dental clinics, Odesa) before this repository existed.

- `SKILL.md` + `collector.js`: browser-only workflow — install the collector
  via a JS-execution tool, drive the Ads Library's SPA search, scroll,
  collect, and aggregate into a report (doors, CTAs, hook frequencies,
  longest-running ads).
- Known gap carried into this rewrite and fixed in 0.2.0: DCO ads showed
  their raw `{{product.name}}` template instead of real text.
