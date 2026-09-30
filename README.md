# meta-ads-niche-report

A Claude skill that collects active competitor ads from the **Meta Ads
Library** (Facebook/Instagram) and turns them into a report a media buyer
can act on. It works for local businesses (niche + city) and for online
niches (US dropshipping, courses). No paid scraping API.

Русская версия: [README.ru.md](README.ru.md)

## What you get

- **Who advertises**, how many ads, how long they've been running, where the
  ads lead (Direct/Messenger, Instagram profile, site, marketplace, app
  store, WhatsApp, Telegram, Telegram bot, affiliate link).
- **Which offers and hooks repeat**: discounts, free shipping, bonus,
  personalization, guarantee, urgency and more, with niche-specific hooks
  from presets. Prices and typical discounts (UAH or USD).
- **Long-running ads**, ranked by number of creative variants (many variants
  of one ad usually means active testing), with links to the creatives.
- **Page networks**: the same ad copy on several pages, and several pages
  sending traffic to one store.
- **Noise flags**: local shops, big platforms (Amazon, eBay, app-install
  ads), courses/schools, so they don't distort conclusions.
- **Snapshot comparison** (new, stopped, scaling ads) and an **Excel export**.
- **Untapped angles** for the client, written by Claude from the data.
- **Ready-made ad hypotheses**: 3-5 drafts (headline, text, CTA, where it
  leads, creative format, what to test and the success metric), each tied to
  evidence in the data (under-used hooks, hooks over-represented in
  long-running ads, ad-vs-site gaps) with a Meta-policy risk note.

[examples/sample-report.md](examples/sample-report.md) is a full sample
report (fictional data) in the 8-section format the skill produces.

## Quick start

1. Install the skill (below).
2. In Claude, ask in plain words, for example: "analyze competitor ads for
   beauty salons in Odesa", or "make a snapshot for US dropshipping".
3. A week or two later: "make a new snapshot and compare with the previous
   one", then "save it to Excel".

You never need a terminal: Claude runs the commands itself. That needs Claude
Code or the **Code tab of the desktop app** (file and command access). In a
plain chat only the browser-mode report works; snapshots, comparison and
Excel need the Code tab.

## How it works

The Ads Library (`facebook.com/ads/library`) is browsable without logging
in. Ads arrive two ways: JSON embedded in the page on first load, and
`graphql` responses as you scroll or search. [`scripts/collector.js`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js)
intercepts both, entirely client-side. It is the single source of the
collection and report logic; everything else calls it.

Two ways to collect, chosen automatically:

1. **Browser mode** — a browser tool already in your Claude session
   (Cowork's built-in browser, Claude in Chrome, the desktop app's browser)
   drives the Ads Library. See
   [references/browser-mode.md](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/references/browser-mode.md).
2. **CLI mode** — [`scripts/scrape.py`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/scrape.py)
   drives a real Chromium via Playwright and saves a dated snapshot to
   `out/<preset>/<date>/` (`ads.csv`, `report.json`, `run.json`).

Cloud containers get a `403` from `facebook.com` — this only works from a
normal, non-datacenter network path (your own machine, or a session with a
real browser tool).

## Install

### claude.ai / Cowork / desktop app chat

Download `meta-ads-niche-report.zip` from the
[latest release](https://github.com/YanisDigital/competitor-ads/releases/latest)
and upload it in **Settings → Skills → Upload skill**.

### Claude Code

Either:
- copy `plugins/meta-ads-niche-report/skills/meta-ads-niche-report/` into
  `~/.claude/skills/meta-ads-niche-report/`, or
- add this repo as a plugin marketplace and install from it:
  ```text
  /plugin marketplace add YanisDigital/competitor-ads
  /plugin install meta-ads-niche-report@meta-ads-niche-report
  ```

## Niche presets

Presets in
[`presets/`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/presets)
hold ready-made queries (services × languages), niche-specific hooks and
noise words. In Claude the preset is picked automatically when your niche
matches, and the skill tells you which one it used. If your niche isn't
listed, it builds the queries itself.

| Niche | Preset id | Notes |
|---|---|---|
| Beauty salons, nails, brows, lashes | `beauty` | Ukrainian/Russian, needs a city |
| Dental clinics | `dentistry` | Ukrainian/Russian, needs a city |
| Gyms, fitness studios, trainers | `fitness` | Ukrainian/Russian, needs a city |
| Car service, tires, detailing | `auto-service` | Ukrainian/Russian, needs a city |
| Dropshipping / Shopify stores selling to the US | `ecom-dropship-us` | English, country US, prices in $, no city, product-level queries |
| Online courses: targeting, SMM, marketing | `infobiz-marketing` | Ukrainian/Russian, no city |
| Courses for beauty professionals | `infobiz-beauty` | Ukrainian/Russian, no city |

CLI: `python scrape.py --preset beauty --city-uk Одеса --city-ru Одесса`
(`--express` for a 3-query quick look, `--max-queries`, `--list-presets`).
To add a niche, copy any preset JSON, change `id`, `services`,
`extra_hooks` and `noise`, and drop it into the same folder. Presets may also
set `country`, `currency` and `online_only` (drops local shops and big
platforms from the long-running list).

## Monitoring: compare two snapshots

Run the same preset twice, a week or two apart (each run is saved to its own
dated folder), then ask Claude to compare, or run:

```bash
node plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/compare.js out/<preset>
```

With one folder it compares the two latest snapshots inside;
`compare.js out/a out/b` compares two specific ones. The result is
`diff.json` in the newer folder: new ads, stopped ads, the share of young
tests (<30 days old) that disappeared, ads that gained creative variants
(scaling), and pages that appeared, vanished or grew.

The library only shows the top of each result list (about 120 ads per query),
so an ad missing from the second run may just have dropped out of the top. A
stop counts as confident only if its query was re-run and returned fewer than
90 ads.

## Client brief for the hypotheses

Ad hypotheses are only useful if they promise things the client can deliver.
Before writing them, Claude asks up to 5 short questions (product and price,
guarantee, reviews and whether they may be quoted, bonus/bundles/free
shipping, copies on the market, real deadlines) and saves the answers to
`client.json` (template:
[client.example.json](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/client.example.json);
`null` = not asked yet, `false`/`0` = not true). `scripts/client_fit.js` then
sorts the snapshot's hooks into usable, blocked (the client said it isn't
true) and "still to ask", and hypotheses use the confirmed facts verbatim
instead of placeholders. The file stays in `out/`, which is not published.

## Landing-page check

Ask Claude "check the sites of the leaders", or run
`python plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/check_sites.py out/<preset>/<date> --top 5`.
For the top advertisers it opens the landing page their ads actually link to
and records title, headings, prices, hooks (free shipping, guarantee, ...),
whether it is a Shopify store, a first-screen screenshot, and compares it with
the ads: what the ads promise but the page doesn't show, what the page shows
but the ads don't mention, ad prices not found on the page. Output:
`sites.json` and `sites/*.png` in the snapshot folder. A mismatch is a lead,
not proof (banners and pop-ups may be missing from the page text). Sites with
a bot challenge are skipped, never bypassed.

## Excel export

Ask Claude "save the last snapshot to Excel", or run
`python plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/export_xlsx.py out/<preset>/<date>`.
It writes `report.xlsx` into that folder: a summary sheet (formulas), all ads
with links to the creatives, all advertisers (local/platform flags, shared
sites), long-running ads, page networks and, if you compared snapshots, a
"Changes" sheet.

## Requirements

- **Browser mode**: a browser tool in your Claude session — nothing to install.
- **CLI mode (snapshots)**: Python 3.10+ and [Playwright](https://playwright.dev/python/):
  ```bash
  pip install playwright
  python -m playwright install chromium
  ```
- **Comparison and Excel export**: Node.js (for `compare.js` and the report
  rebuild) and, for Excel, `pip install openpyxl`.

Nothing is installed automatically by the skill or by this repo's tests —
you (or Claude, with your OK) install these when you actually need them.

## Limitations

- Only ad **text** is analyzed (title, body, CTA, link), not the images or
  video of the creative.
- A report is a **snapshot at run time**, and the library returns about 120
  ads per query (the top by reach), not the whole market.
- Outside the EU, Meta doesn't expose ad spend or reach for commercial ads,
  so an advertiser's "strength" is inferred from ad count, age and number of
  creative variants.
- Search matches ad **text**, not advertiser geography — a city has to appear
  in the ad itself to be found by a city-scoped query.
- Dropshipping can't be told apart from an ordinary small brand from the
  data alone; the skill narrows candidates, you judge after opening the
  creatives and sites. Local-shop and platform detection is heuristic.
- Hook counts are regex matches on ad text. A hook whose words appear in your
  own search queries is circular and shouldn't be read as a niche signal.

## Disclaimer

> **This is a research tool for publicly available advertising data.**
> The Meta Ads Library is browsable without logging in, but automated
> collection from it may conflict with Meta's Terms of Service. You are
> responsible for how you use this tool and for complying with applicable
> law — including data-protection law (e.g. GDPR) if you handle any personal
> contact information you find through it. This project is not affiliated
> with, endorsed by, or sponsored by Meta or Anthropic.
>
> The tooling here deliberately never logs in, never reuses another
> account's session/cookies, never bypasses a captcha, and never rotates
> proxies or spoofs a browser fingerprint. If the Ads Library shows a login
> wall or a captcha, both collection modes stop on their own instead of
> working around it — see
> [references/troubleshooting.md](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/references/troubleshooting.md).

## License

[MIT](LICENSE)

## Changelog

[CHANGELOG.md](CHANGELOG.md)
