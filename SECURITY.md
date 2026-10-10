# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Do not open a public issue for a security problem.

Include what you did, what you expected and what happened, and the version (`plugin.json`).
You will get an answer in a few days.

## What is in scope

Both plugins (`meta-ads-niche-report`, `tiktok-ads-niche-report`) read pages and ad data written by third
parties, so the interesting problems are:

- a landing-page link or redirect that makes the browser reach a private network (SSRF);
- a hostile ad text or page that hangs a regular expression (ReDoS) or breaks out of the HTML or Excel
  report (script injection, formula injection);
- downloads from hosts other than the ad platforms' own media CDNs, or unbounded downloads;
- personal data kept or published by mistake (payer and beneficiary names, client briefs).

## Design rules

No login, no cookies of other people, no bypass of captchas or bot protection, no proxies. Ad-click
tracking links are never opened. Collected data stays in `out/` on your machine and is not part of the
repository. Details: `CHANGELOG.md`, sections "Security".
