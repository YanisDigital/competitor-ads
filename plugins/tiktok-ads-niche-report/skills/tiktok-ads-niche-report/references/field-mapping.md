# Field mapping — where every column comes from

All parsing lives in `scripts/collector.js`; the CSV columns are `CSV_COLS`.

## Ad Library search list — `POST /api/v1/search` → `data[]`

| Column | Source | Notes |
|---|---|---|
| `id` | `id` | Ad id; detail page `https://library.tiktok.com/ads/detail/?ad_id=<id>` |
| `page` | `name` | Advertiser (legal or account name). Some are empty: `(без названия)` |
| `start` / `last` | `first_shown_date` / `last_shown_date` | Milliseconds → unix seconds. Days shown = last − first + 1 (`runDays`). "Active" = last shown within 7 days of the snapshot |
| `reach` | `estimated_audience` | Unique users bucket: `0-1K`, `1K-10K`, `10K-100K`, … (`reachRank` orders them) |
| `category` | `subject` | TikTok's ad category (Life Services, Apps, …) |
| `title` | `title` | Ad caption (the only text of the ad) |
| `image_url` / `video_url` | `videos[0].cover_img` / `videos[0].video_url` | Signed, short-lived. The video goes through `library.tiktok.com/api/v1/cdn/…` and redirects to `*.tiktokcdn.com` |
| `image_urls` | `image_urls[]` | Image (carousel) ads only |
| `audit` | `audit_status` | `1` approved |

Search body: `query`, `query_type: "1"`, `order: "last_shown_date,desc"`,
`offset`, `search_id` (cursor), `limit: 12`; exact phrase adds
`search_clause: {search_terms: [phrase], search_type: 1}`. Response: `total`
(5000 = cap), `has_more`, `search_id`. Requests are signed by the page:
calling the API directly answers 421 "system busy", so the collector only
reads responses the page itself received.

## Ad Library details — `GET /api/v1/items/<id>/details` → `data`

| Column | Source |
|---|---|
| `objective` | `ad.advertising_objective` (Sales, Leads, Traffic, App promotion, Reach, Video views, Community interaction) → `objectiveName()` in Russian |
| `cta` | `ad.call_to_action` (Learn more, Shop now, Book now, …) |
| `link` | `ad.external_url` |
| `adv_id` | `advertiser.adv_biz_ids` → all ads of the advertiser: `https://library.tiktok.com/ads?region=<CC>&adv_biz_ids=<id>` |
| `adv_country` | `advertiser.registry_location` |
| `payer_differs` | `advertiser.sponsor` vs `advertiser.name`: the payer NAME is never stored (it can be a private person), only whether it differs from the advertiser (agency, network, arbitrage) |
| `tt_handle`, `tt_followers` | `advertiser.tt_user.username`, `.follower_count` ("87.1K" → 87100) |
| `target_countries` | `targeting.countries[]` |
| `target_cities` | `targeting.cities[]` + `targeting.provinces[]` (e.g. Warsaw, Masovian) |
| `ages`, `genders` | `targeting.age[]` / `targeting.gender[]` flags per country, union |
| `audience_size` | `targeting.target_audience_size` |
| `targeting_used` | which of interest, audience, creator/video interactions, languages, devices, high spending power were used |

Browser mode reads the same fields from the rendered details page text
(`parseDetailText`); the UI must be in English.

## Creative Center — `GET /creative_radar_api/v1/top_ads/v2/list` → `data.materials[]`

| Column | Source | Notes |
|---|---|---|
| `id` | `id` | Card: `https://ads.tiktok.com/business/creativecenter/topads/<id>/pc/en` |
| `page` | `brand_name` | Usually empty |
| `title` | `ad_title` | |
| `ctr_top` | `ctr` | **Percentile in the industry**: 0.07 = "top 7%". Lower is better; top-20% = winners |
| `likes` | `like` | |
| `cost_level` | `cost` | Budget level: 0 low, 1 medium, 2 high |
| `category` | `industry_key` | `label_14104000000` → name from `top_ads/v2/filters` |
| `objective` | `objective_key` | `campaign_objective_conversion`, `_lead_generation`, `_traffic`, `_video_view`, `_reach`, `_app_install`, `_product_sales` |
| `duration` | `video_info.duration` | Seconds |
| `video_url`, `image_url` | `video_info.video_url[720p…]`, `video_info.cover` | Signed, short-lived |
| `link`, `comments`, `shares` | details: `top_ads/v2/detail?material_id=<id>` → `landing_page`, `comment`, `share` | |

Requests carry the page's signature headers; direct calls answer
"no permission". Headless browsers get a blank page: the CLI opens a visible
window.

Top-level industry codes for the link (`industry=<code>`): 10 Education,
11 Vehicle & Transportation, 12 Baby, Kids & Maternity, 13 Financial
Services, 14 Beauty & Personal Care, 15 Tech & Electronics, 16 Appliances,
17 Travel, 18 Household Products, 19 Pets, 20 Apps, 21 Home Improvement,
22 Apparel & Accessories, 23 News & Entertainment, 24 Business Services,
25 Games, 26 Life Services, 27 Food & Beverage, 28 Sports & Outdoor,
29 Health, 30 E-Commerce (Non-app).

## Derived

- `classifyDoor` (where the ad leads): WhatsApp, Telegram(-бот), TikTok Shop,
  TikTok-профиль, Instagram, Facebook, Маркетплейс, Приложение,
  Мультиссылка/короткая, Сайт; without a link: Лид-форма (objective Leads),
  Сообщения, Звонок, Без ссылки; **Не проверено** while the details were not
  opened.
- Hooks: `HOOK_PATTERNS` + the preset's `extra_hooks`, matched on the
  lowercased text; counted on unique texts per advertiser (copies of one
  video are one text).
- `scaled_copies`: one text uploaded 3+ times by one advertiser — TikTok's
  way of scaling a creative.
