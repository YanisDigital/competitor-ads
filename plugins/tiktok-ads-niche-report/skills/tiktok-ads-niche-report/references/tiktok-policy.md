# TikTok ad rules to respect in hypotheses

A working summary for writing test ads, not legal advice and not the full
policy. TikTok reviews every ad and changes its Advertising Policies
(ads.tiktok.com → Help Center → Advertising Policies) by country and over
time: check the current text for the niche and the country before launch,
and tell the user that `lint_hypotheses.js` is a heuristic.

## Ad format (Ads Manager, non-Spark ads)

- **Ad text**: up to 100 characters (Latin script; fewer for some scripts),
  no emoji, no excessive capitals or symbols. Spark Ads use the organic
  post's caption instead.
- **Display name**: the brand or app name, up to 40 characters.
- **CTA**: one of TikTok's buttons (Learn more, Shop now, Book now, Contact
  us, Sign up, Download, Order now, Get quote, Send message, Call now, …).
  Text on screen may say anything honest; the button is from the list.
- **Video**: vertical 9:16 recommended, sound on; the first 2–3 seconds carry
  the hook. TikTok recommends 9–15 s for most objectives (check the niche data:
  `durations` in the report).
- The ad language must match the targeted market; the landing page must match
  what the ad promises and work on mobile.

## Content TikTok restricts or rejects

- **Personal attributes**: never imply you know the viewer's weight, health,
  debts, skin problems, sexuality, religion ("Masz nadwagę?", "Your acne…").
- **Weight management**: 18+ only; no unrealistic results ("−10 kg in a
  month"), no before/after bodies, no body shaming or idealised bodies.
- **Cosmetic procedures / aesthetic medicine**: 18+; no promise of a medical
  result; before/after is risky and banned in some markets.
- **Medical and health**: no cure or guaranteed-result claims; licensed
  providers only; some treatments and pharmaceuticals are banned by country.
- **Financial services**: no "get rich quick", guaranteed returns or unrealistic
  income; crypto and loans are restricted by country and need disclosures.
- **Education / coaching (infobiz)**: no income promises ("earn €5000 a
  month"), no fake scarcity.
- **Alcohol**: allowed only in some countries, with an age limit (often 25+
  in targeting), never aimed at minors; banned in others.
- **Gambling, dating, political and issue ads**: restricted or prohibited;
  political ads are not allowed.
- **Misleading elements**: fake buttons, fake system notifications, false
  urgency ("only today" without a real deadline), unproven "#1" / "best",
  implied TikTok endorsement.
- **Third-party IP**: no other brands' logos, celebrity likeness or copyrighted
  music without rights (use TikTok's Commercial Music Library).

## In hypotheses.json

- Put the risk in `risk` ("weight-loss wording: 18+, no body result").
- Use only facts the client confirmed (`client_fit.js`); placeholders for the
  rest, listed in `confirm_with_client`.
- If a hook is common in the niche but breaks these rules (e.g. before/after
  bodies in fitness), say so and propose a compliant angle instead of copying
  it.
