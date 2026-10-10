# tiktok-ads-niche-report

A Claude skill that collects competitor ads from **TikTok** and turns them into
a report and a set of ready-to-test ad hypotheses for a media buyer: who
advertises, where the ads lead, which hooks and video formats repeat, which
videos run longest or are being scaled, what nobody says, and what changed
since the last snapshot. No paid scraping API.

Русская версия: [README.ru.md](README.ru.md) · Sibling plugin for Facebook and
Instagram: [meta-ads-niche-report](../meta-ads-niche-report/skills/meta-ads-niche-report/SKILL.md)
(same repository, same workflow).

## Two sources, and why the country matters

TikTok publishes two public sources, and they are very different:

| | **TikTok Ad Library** | **Creative Center → Top Ads** |
|---|---|---|
| Countries | EU/EEA, GB, CH, TR only (33 countries) | Ukraine, US and about 30 more |
| What it is | All ads shown in the country (a DSA duty) | A curated sample of top auction ads picked by TikTok |
| Search | Ad text and advertiser name (any word, or an exact phrase) | Industry code, plus brand/product words |
| Advertisers | Yes (TikTok account, followers, country) | Almost always hidden |
| Timing | First and last shown date → days shown | None |
| Metrics | Reach bucket; in the ad details: objective, CTA, link, targeting (age, gender, cities, interests) | CTR percentile in the industry, likes, budget level, video length; in the card: landing page |

The skill picks the source from the country. **For Ukraine and the US there is
no equivalent of the Meta competitor report**: only Creative Center exists, and
the report says plainly that it shows what works in an industry, not what your
competitors do.

## What you get

- Who advertises (with their TikTok account and followers), how long their ads
  ran, reach, where the ads lead (site, app, lead form, TikTok Shop, messages),
  objectives, CTAs and targeting.
- Hooks and prices counted on **unique videos** (advertisers upload one video
  dozens of times; 189 ads can be 15 advertisers), with a strength label per
  hook (strong / moderate / weak) and the copies of a video shown as scaling.
- Videos cut into storyboards (hook 0–3 s, quarters, end) with a tag vocabulary
  (hook type, format, face in the first second, text overlay, end CTA).
- Leaders' landing pages next to their ads (promised vs on the page, prices,
  tracking pixels, a phone-width screenshot).
- Two snapshots compared: stops (visible from the last-shown date), scaling,
  young tests switched off, new advertisers.
- 3–5 ad hypotheses for the client (hook for the first 2 seconds, a 15–30 s
  scenario, ad text up to 100 characters, a TikTok CTA button), linted against
  TikTok's ad rules and the client's confirmed facts, ranked into a test plan.
- Excel and a single-file HTML report.

## Install

**Claude Code** (terminal or the Code tab of the desktop app). Either:

```text
/plugin marketplace add YanisDigital/competitor-ads
/plugin install tiktok-ads-niche-report@meta-ads-niche-report
```

(the marketplace keeps the name of the first plugin so existing install
commands keep working), or copy
`plugins/tiktok-ads-niche-report/skills/tiktok-ads-niche-report/` into
`~/.claude/skills/tiktok-ads-niche-report/`.

**claude.ai chat**: zip the skill folder above and upload it in
*Settings → Skills*. This only adds the skill; collecting needs a connected
browser (built-in browser of the desktop app, or Claude in Chrome) or the
command line.

## Requirements

- **Browser mode**: a browser tool connected to your Claude session. Nothing to
  install for the built-in browser of the desktop app.
- **CLI mode, details and the site check**: Python 3.10+ and Playwright:
  ```bash
  pip install playwright
  python -m playwright install chromium
  ```
  TikTok Creative Center refuses headless browsers, so for that source a
  visible browser window opens (nothing is disguised).
- **Everything else**: Node.js; for Excel also `pip install openpyxl`.

Nothing is installed automatically.

## Quick start

```bash
python scripts/scrape.py --preset fitness --country PL           # Ad Library
python scripts/details.py out/fitness-pl/<date> --limit 40       # CTA, link, targeting
python scripts/fetch_creatives.py out/fitness-pl/<date>          # videos → storyboards
node scripts/export_html.js out/fitness-pl/<date>
python scripts/export_xlsx.py out/fitness-pl/<date>

python scripts/scrape.py --source cc --country UA --industry 14  # Creative Center
```

In practice you just ask Claude: "what ads are running on TikTok for fitness in
Poland". Presets: `fitness`, `beauty`, `dentistry`, `auto-service`, `ecom-eu`,
`infobiz` (queries in 10 languages, niche hooks, noise words, seasons).

The full workflow, report outline and hypothesis rules are in
[SKILL.md](skills/tiktok-ads-niche-report/SKILL.md).

## Security and privacy

- The collector only reads responses that the TikTok pages themselves receive;
  both sites sign their requests, and no direct API calls are made.
- Landing pages (site check, on request only) are third-party code, so page
  JavaScript is off by default, WebSockets are refused, only public addresses
  without credentials are opened, redirects are followed one hop at a time with
  every address checked before it is requested, and ad-click tracking links are
  never opened (they would count as a click in the competitor's campaign).
  Playwright's Chromium runs without its sandbox (the sandbox does not start
  here): use a separate OS user or a VM for risky work.
- The "paid by" name of an ad (can be a private person) is **never stored**;
  only whether the payer differs from the advertiser. Older snapshots:
  `node scripts/scrub.js out/<niche>`.
- Reports: all third-party text escaped, no scripts (CSP), formulas neutralised
  in Excel and CSV, third-party links without `ttclid`/utm parameters, the
  client's budget and CPA left out of the HTML (`--with-budget` adds them).
  `--no-images` builds an HTML file without video frames and screenshots.
- Ad text, names and landing pages are untrusted input for the model:
  collect with command confirmation on.
- Collected data, client briefs and reports stay in `out/` (ignored by git).

## Tests

```bash
node --test tests/tiktok.test.mjs      # from the repository root
```

Logic on recorded TikTok responses, a regex-DoS check and an SSRF check (the
last needs Playwright and internet and is skipped without them).

## Limitations

- The Ad Library exists only for EU/EEA, GB, CH and TR.
- TikTok publishes no budgets or impressions: only a reach bucket (Ad Library)
  or a budget level and CTR percentile (Creative Center). Advertiser strength is
  inferred from videos, copies and days shown.
- Search sees only ads that contain the query words; only the top of each list
  is collected (96 ads per query by default).
- Signed video and cover links expire within hours to days: download creatives
  right after collecting. Sound is not analysed.
- TikTok's pages change; the collector looks for objects by keys, not by a
  fixed path. If fields are empty, see `references/troubleshooting.md`.

## Disclaimer

> **This is a research tool for publicly available advertising data.**
> Automated collection from TikTok may conflict with TikTok's Terms of
> Service. You are responsible for how you use this tool and for complying
> with applicable law, including data-protection law (e.g. GDPR): advertiser
> names and accounts can belong to private persons. This project is not
> affiliated with, endorsed by, or sponsored by TikTok or Anthropic.
>
> The tooling never logs in, never reuses another account's session or
> cookies, never bypasses a captcha or a site's bot protection, never rotates
> proxies and never spoofs a browser fingerprint. A captcha or a login wall
> stops the run.

## License

[MIT](../../LICENSE)
