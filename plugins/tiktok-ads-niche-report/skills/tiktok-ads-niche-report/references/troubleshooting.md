# Troubleshooting

## The country is not in the Ad Library

The Ad Library covers only EU/EEA countries, GB, CH and TR (the DSA
transparency obligation). Ukraine, the US, Kazakhstan and others are not there:
use Creative Center (`--source cc`) and say clearly that it is a curated top of
an industry, not the competitors' advertising.

## Captcha, "Verify to continue", slider puzzle, login prompt

Stop. The scripts stop by themselves (`BlockedError`). Never solve or bypass a
captcha, never log in, never reuse cookies, never rotate proxies. Tell the
user, suggest retrying later with fewer queries (`--express`), a longer
`--delay`, or browser mode in their own browser.

## Creative Center shows a blank page or "no permission"

Creative Center refuses headless browsers. `scrape.py --source cc` and
`details.py` for a CC snapshot open a visible window: keep it open until the
run ends. Direct API calls answer "no permission": the page signs its
requests, so the collector only reads what the page loads.

## Ad Library answers 421 "system busy"

Only direct API calls get it (the page signs its own). If the page itself
shows nothing, wait and retry later.

## A query returns thousands of ads (total 5000)

The Library matches ANY word of the query, and also advertiser names. "klub
fitness" found 3 869 ads in Poland (every ad with "klub"). Use one service word
per query, or an exact phrase (`--exact`, or `'"phrase"'` in browser mode).
Exact phrases often return little: that is the trade-off.

## Few competitors, many copies

TikTok advertisers upload the same video many times (new ad id each time):
189 ads can be 15 advertisers. The report counts hooks on unique texts and
shows copies in `scaled_copies`. Fewer than 10 advertisers after curation →
the conclusions are hypotheses (the report warns).

## Local business: city in the query does not work

The city is just another word for the search (any-word match) and exact
"service city" phrases rarely exist in ad text. Search the service words for
the whole country, then use `--city` (text mentions and the cities in the
ads' targeting after `details.py`) and curation to keep the local players.

## Empty fields after a page update

The collector looks for objects by keys (`id` + `first_shown_date`,
`ad_title` + `video_info`), not by a fixed path, and survives most changes.
If everything is empty: check the network responses
(`/api/v1/search`, `/api/v1/items/<id>/details`, `top_ads/v2/list`) and update
`normalizeLibraryAd` / `detailsFromJson` / `normalizeCcAd` in collector.js and
the fixtures in `tests/fixtures`, then `node tests/run.js`.

## Browser mode: `search field not found` / `exact-phrase option not found`

The page is not in English or still loading. Add `&lang=en` to the link or
switch the language at the bottom of the page, wait, retry once.

## Media links expired

TikTok signs video and cover links for hours to days. Download creatives right
after collecting and curating; if all are `expired`, collect again.

## Playwright is missing

Tell the user the commands (do not install silently):
`pip install playwright` and `python -m playwright install chromium`.

## Site check: "blocked", empty page, no pixel

- "The URL you requested has been blocked", Cloudflare "just a moment": the site's
  bot protection. It is skipped and reported; never bypass it.
- Almost no text: the page draws itself with JavaScript, which is off by default
  (the Playwright browser runs without a sandbox). `--with-js` only with the
  user's consent.
- TikTok pixel "not found" with `tag_manager: true`: the pixel may be loaded by
  Google Tag Manager. Say "unknown", not "no pixel".
- A tracking link (ad.doubleclick.net, adform, appsflyer, …) is never opened:
  it would count as a click in the competitor's campaign.

## Comparing snapshots

- "Need at least 2 snapshots": run the same preset/queries again in 2–4 weeks
  without `--out`.
- Different source, country or queries: the comparison refuses or warns; "gone
  from the results" is only confident for ads of shared, uncut queries.
- New advertisers missing from the comparison: `curation.json` is a whitelist;
  `unreviewed_pages` in diff.json lists them — add them to the curation.

## Security notes

- **Redirects in the site check**: every hop is checked before it is requested;
  a redirect to a private address ends in "адрес не публичный…", not in a request.
  If a legitimate site fails with this message, open it by hand. Residual risk:
  DNS rebinding between the two checks (one request wide).
- **Payer names**: never stored. Old snapshots: `node scripts/scrub.js out/<niche>`.
- **Chromium runs with `--no-sandbox`** (Playwright's default); enabling the
  sandbox crashed the browser on the machine this was built on. Keep page
  JavaScript off and use a separate OS user or a VM for risky work.
- **Slow run on a huge page**: page text is cut to 30 000 characters and the
  regexes are bounded (`node tests/redos_check.js`).
