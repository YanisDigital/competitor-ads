# meta-ads-niche-report

A Claude skill that collects active competitor ads from the **Meta Ads
Library** (Facebook/Instagram) and turns them into a report and a set of
ready-to-test ad hypotheses that a media buyer can act on. It works for local
businesses (niche + city) and for online niches (US dropshipping, courses).
No paid scraping API.

Русская версия: [README.ru.md](README.ru.md)

## Where it works (read this first)

> **Uploading the zip to claude.ai is not enough.** Installing a skill installs
> nothing else, and a plain chat cannot open facebook.com. Pick the setup that
> matches how you use Claude.

The skill reads the Ads Library on facebook.com, which Meta serves only to a
real browser on a normal network (cloud containers get HTTP 403). So what
matters is where Claude runs and which browser it can drive:

| Where you use it | Works? | What you must set up |
|---|---|---|
| **Claude Code** (terminal) or the **Code tab of the desktop app** | Yes, everything: collection, site check, comparison, hypotheses tooling, Excel/HTML | One-time installs: Python 3.10+, `pip install playwright`, `python -m playwright install chromium`, Node.js (and `pip install openpyxl` for Excel). Claude asks before installing anything |
| **Code tab or Cowork with the built-in browser** | Collection in browser mode | Nothing for the browser itself. The scripts (report, exports) still need Node.js |
| **Chat in claude.ai or the desktop app, with the Claude in Chrome extension connected** | Collection and the report in browser mode only | Install the **Claude in Chrome** extension, sign in to the *same* account, make sure the browser shows as connected. A chat has no files or commands: no snapshot folders, site check, comparison or exports |
| **Chat without a browser tool** (claude.ai or the desktop app chat tab, no extension) | **No.** Claude cannot reach facebook.com from its sandbox, and the skill stops and says so | Use the Code tab, or connect the extension |

If a chat answers that no browser is connected, the skill is fine: the
connection is missing. Switch to the Code tab, or fix the extension (installed,
enabled, same account, Chrome restarted).

## What you get

- **Who advertises**, how many ads, how long they've been running, where the
  ads lead (Direct/Messenger, Instagram profile, site, marketplace, app
  store, WhatsApp, Telegram, Telegram bot, affiliate link).
- **Which offers and hooks repeat**: discounts, free shipping, bonus,
  personalization, guarantee, urgency and more, with niche-specific hooks from
  presets. Prices and typical discounts (UAH or USD).
- **Long-running ads**, ranked by number of creative variants (many variants
  of one ad usually means active testing), with links to the creatives.
- **Page networks**: the same ad copy on several pages, and several pages
  sending traffic to one store.
- **Noise flags**: local shops, big platforms (Amazon, eBay, app-install ads),
  courses/schools, so they don't distort conclusions.
- **Landing-page check** of the leaders: prices, hooks, Shopify detection,
  screenshot, and what the ads promise that the page doesn't show.
- **Ad hypotheses** with evidence per advertiser, a client brief so they only
  promise what the client can deliver, automatic text checks, a prioritized
  test plan, and hypotheses drawn from what changed between snapshots.
- **Monitoring**: compare two snapshots (new, stopped, scaling ads).
- **Excel** and a **single-file HTML report** to share.

[examples/sample-report.md](examples/sample-report.md) is a full sample
report (fictional data) in the 8-section format the skill produces.

## Quick start

1. Install the skill (below).
2. In Claude, ask in plain words, for example: "analyze competitor ads for
   beauty salons in Odesa", "make a snapshot for US dropshipping", then
   "check the sites of the leaders" and "write ad hypotheses for my client".
3. A week or two later: "make a new snapshot and compare with the previous
   one".
4. To share: "save it to Excel" or "make an HTML report".

You never need a terminal: Claude runs the commands itself. That needs Claude
Code or the **Code tab of the desktop app** (file and command access). In a
plain chat only the browser-mode report works, and only with a connected
browser (see [Where it works](#where-it-works-read-this-first)); snapshots,
the site check, comparison, hypotheses tooling and exports need the Code tab.

## How it works

The Ads Library (`facebook.com/ads/library`) is browsable without logging
in. Ads arrive two ways: JSON embedded in the page on first load, and
`graphql` responses as you scroll or search. [`scripts/collector.js`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js)
intercepts both, entirely client-side. It is the single source of the
collection and analysis logic; every other script calls it.

Two ways to collect, chosen automatically:

1. **Browser mode**: a browser tool already in your Claude session (Cowork's
   built-in browser, Claude in Chrome, the desktop app's browser) drives the
   Ads Library. See
   [references/browser-mode.md](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/references/browser-mode.md).
2. **CLI mode**: [`scripts/scrape.py`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/scrape.py)
   drives a real Chromium via Playwright and saves a dated snapshot to
   `out/<preset>/<date>/`.

Cloud containers get a `403` from `facebook.com`: this only works from a
normal, non-datacenter network path (your own machine, or a session with a
real browser tool).

## Install

### claude.ai / Cowork / desktop app chat

Download `meta-ads-niche-report.zip` from the
[latest release](https://github.com/YanisDigital/competitor-ads/releases/latest)
and upload it in **Settings → Skills → Upload skill**. This only adds the
skill: for collection you still need a connected browser (see
[Where it works](#where-it-works-read-this-first)).

### Claude Code

Either:
- copy `plugins/meta-ads-niche-report/skills/meta-ads-niche-report/` into
  `~/.claude/skills/meta-ads-niche-report/`, or
- add this repo as a plugin marketplace and install from it:
  ```text
  /plugin marketplace add YanisDigital/competitor-ads
  /plugin install meta-ads-niche-report@meta-ads-niche-report
  ```

## The workflow and the files it produces

Everything for one snapshot lives in `out/<preset>/<date>/` (git-ignored,
never published). Each step reads what the earlier ones wrote:

| Step | You say | Script | Writes |
|---|---|---|---|
| Collect | "make a snapshot for ..." | `scrape.py` | `ads.csv`, `report.json`, `run.json` |
| Check the leaders' sites | "check the sites of the leaders" | `check_sites.py` | `sites.json`, `sites/*.png` |
| Client brief | (Claude asks up to 5 questions) | `client_fit.js` | `client.json` (in the folder or its parent) |
| Hypotheses | "write ad hypotheses" | Claude | `hypotheses.json` |
| Check the texts | (automatic) | `lint_hypotheses.js` | `hypotheses_lint.json` |
| Prioritize and plan | (automatic) | `plan_tests.js` | `test_plan.json` |
| Compare with the previous snapshot | "compare with the previous one" | `compare.js` | `diff.json` (in the newer folder) |
| Share | "save to Excel" / "make an HTML report" | `export_xlsx.py` / `export_html.js` | `report.xlsx` / `report.html` |

| Script | Needs |
|---|---|
| `scrape.py`, `check_sites.py` | Python 3.10+, Playwright, and for `check_sites.py` Node.js |
| `compare.js`, `client_fit.js`, `lint_hypotheses.js`, `plan_tests.js`, `export_html.js` | Node.js |
| `export_xlsx.py` | Python, `openpyxl`, Node.js |

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
| Craft beer (breweries, beer shops), Ukraine | `craft-beer-ua` | Ukrainian, no city; broad queries ("on tap", "gift") bring noise, review advertisers by hand |

CLI: `python scrape.py --preset beauty --city-uk Одеса --city-ru Одесса`
(`--express` for a 3-query quick look, `--max-queries`, `--list-presets`,
`--exact` for exact-phrase search: less noise but fewer competitors found).
To add a niche, copy any preset JSON, change `id`, `services`,
`extra_hooks` and `noise`, and drop it into the same folder. Presets may also
set `country`, `currency`, `base_hooks` and `online_only` (drops local shops
and big platforms from the long-running list).

## Landing-page check

`check_sites.py <snapshot> --top 5` opens the landing page the leading
advertisers' ads actually link to and records title, headings, prices, hooks
(free shipping, guarantee, ...), whether it is a Shopify store (detected from
page resources, so it works on custom domains), a first-screen screenshot, and
compares it with the ads: what the ads promise but the page doesn't show, what
the page shows but the ads don't mention, ad prices not found on the page. A
mismatch is a lead, not proof (banners and pop-ups may be missing from the
page text). Sites with a bot challenge are skipped, never bypassed; at most 10
sites per run.

## Ad hypotheses

The hypotheses section is built to avoid overclaiming:

- **Evidence per advertiser.** A hook is counted by advertisers, not by ads,
  with pages that share a site merged into one. Each hook gets a strength
  (`strong`: 5+ advertisers and none above 50%; `moderate`; `weak`: one or two
  advertisers, i.e. one competitor's habit rather than a niche trend), a
  circularity flag (its words appear in your own search queries) and example
  ads with links.
- **Client brief.** Before writing, Claude asks up to 5 short questions
  (product and price, guarantee, reviews and whether they may be quoted,
  bonus/bundles/free shipping, copies on the market, real deadlines) and saves
  `client.json` (template:
  [client.example.json](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/client.example.json);
  `null` = not asked yet, `false`/`0` = not true). `client_fit.js` sorts the
  hooks into usable, blocked (the client said it isn't true) and "still to
  ask"; hypotheses use confirmed facts verbatim instead of placeholders.
- **Automatic text checks** (`lint_hypotheses.js`): required fields, headline
  length (~40 characters), the ~125 characters visible before "See more",
  unfilled placeholders, risky wording (personal attributes, medical or
  absolute claims, before/after, superlatives, all caps, fake urgency) and,
  with `client.json`, promises the client has not confirmed (guarantee days,
  rating, review count, discount, prices, hooks the client denied). These are
  heuristics, not Meta's review: Meta approves ads itself and its policies
  change.
- **Prioritization and test plan** (`plan_tests.js`): score = evidence
  strength × readiness / effort (readiness from the client brief; text errors
  halve it). Tests run in rounds of at most 2 with different variable types
  (creative, offer, landing, audience); with `target_cpa` in `client.json`
  each round gets a budget (2 variants × 50 optimization events × CPA, a rule
  of thumb). The score orders work; it does not predict results.
- **Hypotheses from dynamics.** With two snapshots, `diff.json` carries a
  `dynamics` block: hooks of ads that gained creative variants (what
  competitors scale), hooks over-represented among young tests that
  disappeared (only from confident stops and with enough data), what new
  advertisers bring, and how the format mix moved.

## Curating advertisers and judging queries

Library queries match ad **text**, so results contain non-competitors (a bath
house that mentions beer, glassware shops, event organizers). The skill asks
Claude to read the advertisers and saves the decision in `curation.json` next
to `ads.csv`:

```json
{ "include": { "Brewery A": "Producer", "Shop B": "Beer shop" },
  "exclude": ["Page name"], "notes": "who was removed and why" }
```

`include` is a whitelist (its values become a "Type" column), `exclude` a
blacklist. The report, Excel and HTML are then built from the kept advertisers
only; without the file nothing changes. The report also lists, **per query**,
how many ads and advertisers it found and how many were real competitors, plus
whether Meta refused "load more" (sheet "Запросы" in Excel, a section in HTML),
so weak queries can be replaced.

## Warnings and query hygiene

The report carries a **Warnings** block (Excel summary, HTML top): small sample
(under 10 advertisers: findings are hypotheses, not niche trends), queries
where Meta refused "load more", queries that found nothing, a **season** from
the preset (Oktoberfest, 8 March, Black Friday: part of the ads is temporary)
and a **policy** note for niches Meta restricts (alcohol, health, weight,
income claims). Presets may carry `seasons` (`from`/`to` as `MM-DD`) and
`policy`.

After curation, `node scripts/suggest_queries.js <snapshot>` keeps only the
queries that found at least one competitor, explains each dropped one and
prints a ready `services` list for the preset.

## Monitoring: compare two snapshots

Run the same preset twice, a week or two apart (each run is saved to its own
dated folder), then ask Claude to compare, or run
`node .../scripts/compare.js out/<preset>` (with one folder it compares the
two latest snapshots inside; `compare.js out/a out/b` compares two specific
ones). The result is `diff.json` in the newer folder: new ads, stopped ads,
the share of young tests (<30 days old) that disappeared, ads that gained
creative variants (scaling), pages that appeared, vanished or grew.

The library only shows the top of each result list (about 120 ads per query),
so an ad missing from the second run may just have dropped out of the top. A
stop counts as confident only if its query was re-run and returned fewer than
90 ads.

## Sharing: Excel and HTML

- **Excel** (`export_xlsx.py`): `report.xlsx` with a summary sheet (formulas),
  all ads with links to the creatives, all advertisers (local/platform flags,
  shared sites), long-running ads, page networks and, when the data exists,
  sheets for changes, hypotheses (with the automatic-check column) and the
  test plan.
- **HTML** (`export_html.js`): `report.html`, a single self-contained file
  with no external files, fonts or scripts (charts are pure CSS, screenshots
  are embedded) that opens anywhere, including on a phone, and prints. It has
  the summary, charts, advertisers, long-running ads, page networks and, when
  the data exists, the site check, hypotheses with the test plan, and
  changes. It never includes `client.json`. A strict Content-Security-Policy
  blocks everything except its own inline styles, and all ad text is escaped,
  so a malicious ad cannot inject anything.

## Requirements

- **Browser mode**: a browser tool *connected* to your Claude session: the
  built-in browser of the desktop app / Cowork (nothing to install), or the
  Claude in Chrome extension (install it and sign in to the same account).
  A plain chat without either cannot collect.
- **CLI mode and the site check**: Python 3.10+ and [Playwright](https://playwright.dev/python/):
  ```bash
  pip install playwright
  python -m playwright install chromium
  ```
- **Everything else**: Node.js; for the Excel export also `pip install openpyxl`.

Nothing is installed automatically by the skill or by this repo's tests:
you (or Claude, with your OK) install these when you actually need them.

## Limitations

- Only ad **text** is analyzed (title, body, CTA, link), not the images or
  video of the creative.
- A report is a **snapshot at run time**, and the library returns about 120
  ads per query (the top by reach), not the whole market.
- Outside the EU, Meta doesn't expose ad spend or reach for commercial ads,
  so an advertiser's "strength" is inferred from ad count, age and number of
  creative variants.
- Search matches ad **text**, not advertiser geography: a city has to appear
  in the ad itself to be found by a city-scoped query.
- Dropshipping can't be told apart from an ordinary small brand from the
  data alone; the skill narrows candidates, you judge after opening the
  creatives and sites. Local-shop and platform detection is heuristic.
- Hook counts are regex matches on ad text. Hooks seen at only one or two
  advertisers are marked `weak` and are not a niche trend; treat every
  hypothesis as a test, not a conclusion.
- Comparisons between snapshots need the same queries and small samples make
  "failed test" signals weak.
- The hypothesis text checks and the test-plan score are heuristics.

## Disclaimer

> **This is a research tool for publicly available advertising data.**
> The Meta Ads Library is browsable without logging in, but automated
> collection from it may conflict with Meta's Terms of Service. You are
> responsible for how you use this tool and for complying with applicable
> law, including data-protection law (e.g. GDPR) if you handle any personal
> contact information you find through it. This project is not affiliated
> with, endorsed by, or sponsored by Meta or Anthropic.
>
> The tooling here deliberately never logs in, never reuses another
> account's session/cookies, never bypasses a captcha or a site's bot
> protection, and never rotates proxies or spoofs a browser fingerprint. If
> the Ads Library shows a login wall or a captcha, both collection modes stop
> on their own instead of working around it; see
> [references/troubleshooting.md](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/references/troubleshooting.md).

## License

[MIT](LICENSE)

## Changelog

[CHANGELOG.md](CHANGELOG.md)
