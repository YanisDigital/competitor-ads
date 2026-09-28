# Field mapping — what `collector.js` reads, and from where

Every ad the collector sees starts as a raw Ads Library node with two
top-level keys it cares about: `ad_archive_id` and `snapshot`. Everything
below is read from one of those two, in `normalizeAd(node, kw)`
(`scripts/collector.js`).

| Output field | Source | Notes |
|---|---|---|
| `id` | `node.ad_archive_id` | Stable key; used to dedupe across searches (`window.__mai.store`) and inside `buildReport`. |
| `page_id` | `node.page_id` or `snapshot.page_id` | Whichever is present; the two paths aren't always both populated. |
| `page` | `node.page_name` or `snapshot.page_name` | Advertiser display name. |
| `active` | `node.is_active` | Boolean. |
| `start` / `end` | `node.start_date` / `node.end_date` | Unix seconds. `end` is `null` while active. Age math (`buildReport`) is `(now - start) / 86400`, rounded. |
| `title` / `body` | `snapshot.title` / `snapshot.body` | Each can be a plain string or `{ text: "..." }` — `pick()` normalizes both. Capped to 500 chars in `body`. |
| `title` / `body` (DCO fallback) | `snapshot.cards[]` | If `title`/`body` contain an unresolved `{{...}}` template (or both are empty and cards exist), `firstNonEmptyCard()` picks the first card whose own title/body isn't empty and substitutes it. |
| `cta` | `snapshot.cta_text`, falling back to the chosen card's `cta_text` | E.g. "Learn more", "Send message", "Call now". Drives `classifyDoor` alongside the link's domain. |
| `link` | `snapshot.link_url`, falling back to the chosen card's `link_url` | Raw, possibly wrapped (see `domainOf` below). |
| `cats` | `snapshot.page_categories` | Joined with `\|`. Used to eyeball noise (real estate, schools) in `top_pages`. |
| `platforms` | `node.publisher_platform` | Array like `["facebook", "instagram"]`, joined with `\|`. |
| `fmt` | `snapshot.display_format` | e.g. `image`, `video`, `carousel`, `dco`. |
| `variants` | `node.collation_count` | How many creative variants the Library folded into this one ad. Default `1`. |
| `ncards` | `snapshot.cards.length` | `0` for a single-creative ad. |
| `kws` | accumulated by `window.__mai.collect()` | Which search queries surfaced this ad; `normalizeAd` itself only sets the current one. |

## Derived fields (not read directly — computed)

- **`domainOf(url)`** parses `link` with `URL`, and if the host ends in
  `facebook.com` and there's a `?u=` query param (the
  `l.facebook.com/l.php?u=...` redirect wrapper), it re-parses that inner
  URL instead. Strips a leading `www.`/`l.`/`m.` from whatever hostname it
  lands on.
- **`classifyDoor(rec)`** turns `link`'s domain + `cta` text into one of:
  WhatsApp, Telegram, Instagram-профиль, Facebook-страница,
  Директ/Messenger, Звонок, Сайт, Без ссылки. Domain checks run before
  generic CTA-text checks (a link to `t.me` outranks a generic "Message"
  CTA — see the code comment for why).
- **`hook_freq`** (in `buildReport`) matches `HOOK_PATTERNS` (top of
  `collector.js`) against lowercased `title + " " + body`. Each pattern is
  a single regex covering Ukrainian/Russian/English phrasing for the same
  hook (discount, guarantee, free, deadline, etc.).

## Where the raw nodes come from

Two independent paths feed `window.__mai.ads` before `collect()` reads it
(see `installBrowser()` in `scripts/collector.js`):

1. `<script type="application/json">` tags already in the page HTML (the
   "first load" SSR batch).
2. `fetch`/`XHR` responses whose URL contains `graphql` (new searches,
   scroll-triggered pagination) — intercepted by patching
   `XMLHttpRequest.prototype.open` and `window.fetch`.

Both paths get walked recursively (`walk()`) for any object with both
`ad_archive_id` and `snapshot` keys, so the collector tends to survive
Meta reshuffling the surrounding response structure — it doesn't rely on
a fixed path into the GraphQL payload.
