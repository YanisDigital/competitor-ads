# Strategy for the first month (template)

Use only numbers from the snapshot and from client.json. No forecast of results. Every assumption is written as an assumption.

## 0. Before writing
- Conversion channel (client.json `conversion_channel`): site purchase, Direct/messenger, lead form, call. It sets the campaign objective, whether a pixel matters and how learning is counted.
- Directions (`directions`): B2C, B2B or both. Different offers, different budgets: write one block per direction.
- Budget: say exactly what the number is for. "400 UAH per day" is per campaign or for all campaigns? Ask once if the brief does not say.

## 1. Facts from the snapshot (observation, then reading)
- Competitors: N advertisers after the confirmed cleaning (criterion in curation.json), the sample is small/large.
- Shares by advertiser: formats, doors, age (formats_by_advertiser, doors_by_advertiser). Campaigns, not ad counts. The dominant advertiser if any.
- Long-running ads and fresh launches, with links.
- Free angles that are not circular (strength strong or moderate).

## 2. Weeks 1-4
| Week | What goes live | Variable under test | Success metric | Minimum data |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

Tests come from test_plan.json (rounds, at most 2 parallel tests with different variable types).

## 3. Budget (assumptions)
- Per test: 2 variants x about 50 events x target CPA (a rule of thumb, verify it).
- Split between directions and channels, with the stated daily budget and what it does not cover.

## 4. What to confirm with the client
List from `confirm_with_client` of the hypotheses and the empty fields of client.json.

## 5. Risks
Policy risks (Meta advertising standards), deadlines the client cannot keep, claims that are not confirmed.
