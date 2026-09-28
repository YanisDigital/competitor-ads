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

## `captured` stays well below `library_says`

Normal in small amounts — the Library counts creative variants of the same
underlying ad separately, so `captured` (unique `ad_archive_id`s) is
usually a bit lower. If the gap is large, call
`window.__mai.scroll(6); window.__mai.collect('<query>')` again to load
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

## CLI mode (`scrape.py`): search field not found

Same underlying cause as above. `scrape.py` tries a short list of
selectors (`SEARCH_INPUT_SELECTORS` at the top of the file) before giving
up with a clear error; if the Library's markup changed, update that list.
Run with `--headed` first to see what actually loaded before editing
selectors blind.

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
