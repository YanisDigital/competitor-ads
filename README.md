# meta-ads-niche-report

A Claude skill that collects active competitor ads from the **Meta Ads
Library** (Facebook/Instagram) for a niche and city, and turns them into a
report a media buyer can act on: who's advertising, where the ads lead
(Direct, an Instagram profile, a site, WhatsApp, Telegram), which offers and
hooks repeat across advertisers, which ads have been running the longest,
and which angles almost nobody is using. No paid scraping API.

Русская версия: [README.ru.md](README.ru.md)

## Example output

[examples/sample-report.md](examples/sample-report.md) — a full sample
report with fictional advertiser names and invented numbers, showing the
8-section format the skill produces.

## How it works

The Ads Library (`facebook.com/ads/library`) is browsable without logging
in. Ads arrive two ways: JSON embedded in the page on first load, and
`graphql` responses as you scroll or search. [`scripts/collector.js`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/collector.js)
intercepts both, entirely client-side — nothing paid, nothing to sign up
for. It's the single source of the collection/aggregation logic; both
collection modes below call it as-is.

There are two ways to run it, and the skill picks between them automatically:

1. **Browser mode** — a browser tool already available in your Claude
   session (Cowork's built-in browser, Claude in Chrome, etc.) drives the
   Ads Library directly. See
   [references/browser-mode.md](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/references/browser-mode.md).
2. **CLI mode** — [`scripts/scrape.py`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/scrape.py)
   drives a real Chromium via Playwright. Useful in Claude Code, where
   there's a shell but no browser tool.

Cloud containers get a `403` from `facebook.com` outright — this only works
from an environment with a normal, non-datacenter network path (your own
machine, or a session with a real browser tool).

## Install

### claude.ai / Cowork

Zip the skill folder —
`plugins/meta-ads-niche-report/skills/meta-ads-niche-report/` — then go to
**Settings → Skills → Upload skill** and upload the zip.

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

For common niches the skill ships ready-made presets in
[`presets/`](plugins/meta-ads-niche-report/skills/meta-ads-niche-report/presets):
services in Ukrainian and Russian, niche-specific hooks, and noise words
(courses, schools, ...) to review. In Claude the preset is picked
automatically when your niche matches; the skill tells you which one it
used. If your niche isn't listed, it builds the queries itself.

| Niche | Preset id |
|---|---|
| Beauty salons, nails, brows, lashes | `beauty` |
| Dental clinics | `dentistry` |
| Gyms, fitness studios, trainers | `fitness` |
| Car service, tires, detailing | `auto-service` |
| Dropshipping / Shopify stores selling to the US (country US, prices in $) | `ecom-dropship-us` |
| Online courses: targeting, SMM, marketing | `infobiz-marketing` |
| Courses for beauty professionals | `infobiz-beauty` |

CLI: `python scrape.py --preset beauty --city-uk Одеса --city-ru Одесса`
(`--express` for a 3-query quick look, `--list-presets` to list them). To
add a niche, copy any preset JSON, change `id`, `services`, `extra_hooks`
and `noise`, and drop it into the same folder.

## Monitoring: compare two snapshots

Run `scrape.py` twice with the same preset/queries (say, a week or two
apart, into different `--out` folders), then:

```bash
node plugins/meta-ads-niche-report/skills/meta-ads-niche-report/scripts/compare.js out/week1 out/week2
```

It writes `out/week2/diff.json`: new ads, stopped ads, how many young tests
(<30 days old) disappeared, ads that gained creative variants (scaling), and
pages that appeared, vanished or grew. An ad missing from the second run only
counts as confidently stopped if its query was re-run and returned fewer
than 90 ads; otherwise it may just have dropped out of the top of the results.

## Requirements

- **Browser mode**: a browser tool in your Claude session (built-in browser,
  Claude in Chrome, or similar) — no install needed.
- **CLI mode**: Python 3.10+ and [Playwright](https://playwright.dev/python/):
  ```bash
  pip install playwright
  python -m playwright install chromium
  ```
  Neither of these is installed automatically by the skill or by this repo's
  tests — you run them yourself when you actually want to collect.

## Limitations

- Only ad **text** is analyzed (title, body, CTA, link) — not creative
  images/video content.
- A report is a **snapshot at run time**; Meta's ad inventory changes daily.
- Outside the EU, Meta doesn't expose ad spend or reach for commercial ads,
  so an advertiser's "strength" is only inferred from ad count and how long
  ads have run.
- Search matches ad **text**, not advertiser geography — a city name has to
  appear in the ad itself to be found by a city-scoped query.

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
