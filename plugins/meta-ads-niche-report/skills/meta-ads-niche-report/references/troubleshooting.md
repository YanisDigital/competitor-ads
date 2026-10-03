# Troubleshooting

## Login wall or captcha/checkpoint appears

Stop immediately and tell the user. Never log in, never reuse an existing
Meta session's cookies, never attempt to solve or bypass a captcha. In
browser mode this usually means the environment's network path to
facebook.com looks automated; retrying from a different environment (a
real user machine, not a cloud container) is the only supported fix. In
CLI mode, `scrape.py` already detects both cases and stops with a clear
error (`BlockedError`) instead of trying to work around them.

## `facebook.com` returns 403 / nothing loads

Cloud containers are blocked by Meta outright. This only works from an
environment with a real, non-datacenter network path — a user's own
machine (browser mode via Cowork/Claude in Chrome, or CLI mode via
`scrape.py` run locally). There is no curl/fetch workaround; don't try one.

## Browser tool does not respond

If the browser extension or built-in browser call hangs or returns a
connection error, do not retry it in a loop. Tell the user once (a
permission prompt may be waiting in the app, or the extension may be
off) and offer the other mode. Do not fall back to `scrape.py` inside a
cloud container: Meta refuses those requests (see the 403 section).

## `[rate-limited: first batch only]` / `rate_limited_queries` in run.json

A visible browser (`--headed`) does not lift it: checked on 2026-10-03 with
the same three queries, all three were still limited. Browser mode inside a
normal browser session was not limited in an earlier run; that is the only
option seen to give fuller results so far.

Meta answered the "load more" requests with `Rate limit exceeded`
(GraphQL error 1675004), so those queries hold only the first batch of
about 30 top ads, not the full count the Library shows. `collector.js`
detects it and stops scrolling; nothing works around it. Tell the user
the sample for those queries is partial; rerun later (the limit seems to
build up over many runs in a short time) or collect in browser mode.

## CLI mode: a later query says "no ads match" or the page shows "Something went wrong"

Older `scrape.py` versions typed each query into the in-page search box.
In headless Chromium that search returned no ads for queries that have
results and crashed the page by the third search. The script now opens
every query by its own URL and carries the collected records over with
`window.__mai.load()`.

## `captured` stays well below `library_says`

Normal in small amounts — the Library counts creative variants of the same
underlying ad separately, so `captured` (unique `ad_archive_id`s) is
usually a bit lower. If the gap is large, call
`window.__mai.scroll(); window.__mai.collect('<query>')` again to load
more of the results list before giving up on that query.

## `captured: 0` and an empty `library_says`

Nothing matched that query — this is a legitimate empty result, not an
error. Move on to the next keyword.

## Ads look mostly empty (no title/body/cta)

The Ads Library's internal response shape changed. `collector.js`'s
`walk()` finds any object with both `ad_archive_id` and `snapshot`, so it
usually survives small reshuffles, but if fields inside `snapshot` were
renamed, `normalizeAd()` needs updating. Inspect a live example first:

```javascript
Object.values(window.__mai.store)[0]
```

Compare its shape against `references/field-mapping.md` and adjust
`normalizeAd()` in `scripts/collector.js` — that file is the single
source of truth for both browser mode and `scrape.py`; never duplicate
the fix in Python.

## DCO ads show `{{product.name}}` or similar literally

This means `normalizeAd()`'s DCO fallback didn't find a usable
`snapshot.cards[]` entry — either the ad has no cards, or every card's own
`title`/`body` is also empty. Check `ncards` on that record; `ncards: 0`
means there was nothing to fall back to (the ad itself just carries an
unresolved template with no per-card content, which does happen).

## Browser mode: search field not found / clicks land on the wrong element

The Ads Library's DOM structure changed. Re-run `find` for "Search by
keyword" to get a fresh `ref` rather than reusing stale coordinates from
earlier in the session — the page can reflow after a search.

## CLI mode: headless run returns nothing, or shows a login prompt

Re-run with `--headed` (a visible browser window). Some environments only
succeed with a real, visible browser session; if `--headed` also fails,
the environment likely doesn't have a network path Meta will serve
without blocking (see the 403 section above).

## Noise in results (real estate, unrelated schools, random keyword matches)

Expected — the Library searches ad *text*, not advertiser category. Use
`window.__mai.exclude(['Page name', ...])` after reviewing
`report().top_pages`, or call out irrelevant categories as a separate
paragraph in the report instead of silently dropping them (e.g. "courses
for beauty professionals" is real signal, just not a competitor).
