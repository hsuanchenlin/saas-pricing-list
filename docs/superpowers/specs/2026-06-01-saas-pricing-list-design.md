# SaaS Pricing List — Design

**Date:** 2026-06-01
**Status:** Approved

## Summary

A static website that lists 100+ SaaS services with their USD pricing
(monthly and annual) in an interactive, sortable/filterable table. The dataset
is the single source of truth, refreshed on a schedule by a CI job that
researches current prices and verifies each against a cited source. Personal /
portfolio project.

Examples of services to include: Netflix, Spotify, Duolingo, YouTube Premium,
rss.app, and ~100 more across ~10 categories.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Data model | Hand-curated JSON, refreshed periodically |
| Catalog size | 100+ services at launch |
| Purpose | Personal / portfolio project |
| Web stack | Plain static site (HTML/CSS/vanilla JS), no build step |
| Refresh mechanism | Scheduled CI job (GitHub Actions cron) |
| Currency | USD only |
| Interactivity | Search, category filter, sortable columns, monthly⇄annual toggle |
| Price source | LLM research with per-price source verification |
| Plans per row | One headline plan per service (v1); multi-tier is out of scope |
| Logos | Service favicons (no stored image files) |
| Hosting | GitHub Pages |

## Architecture

### Repository layout

```
sass-list/
├── index.html              # page shell: header, controls, table, footer
├── style.css               # responsive styling
├── app.js                  # fetches data, renders + wires interactivity
├── data/
│   └── services.json       # canonical dataset (single source of truth)
├── scripts/
│   ├── refresh.mjs         # CI price-research script (Node + Anthropic SDK + web search)
│   └── validate.mjs        # schema/data validator (CI gate + test)
├── .github/workflows/
│   ├── refresh.yml         # monthly cron → run refresh → commit JSON
│   └── deploy.yml          # build-free deploy to GitHub Pages on push to main
└── docs/superpowers/specs/ # this spec
```

The site layer and the data pipeline are intentionally decoupled: the front-end
only consumes `data/services.json`, so the pipeline could later be reimplemented
(e.g. in Rust) without touching the site.

### Data schema (`data/services.json`)

```jsonc
{
  "generated_at": "2026-06-01",          // ISO date; shown in footer
  "services": [
    {
      "id": "netflix",                   // unique, kebab-case slug
      "name": "Netflix",
      "category": "Streaming",           // must match one of the known categories
      "url": "https://netflix.com",      // provider homepage
      "description": "Ad-free movie & TV streaming",
      "free_tier": false,                // does a free plan exist?
      "headline_plan": "Standard",       // which plan the price refers to
      "monthly_usd": 17.99,              // number, or null for Custom/enterprise
      "annual_usd": null,                // total cost/yr if billed annually; null if not offered
      "source_url": "https://help.netflix.com/...",  // auditable source for the price
      "last_verified": "2026-06-01"      // ISO date the price was last verified
    }
  ]
}
```

Notes:
- One row per service, showing the **headline plan** (the standard / most-popular
  paid tier).
- `monthly_usd` / `annual_usd` may be `null` (rendered as "Custom").
- Sorting and the monthly/annual toggle operate on these two fields. When the
  toggle is on "annual", price sort uses `annual_usd` (falling back to
  `monthly_usd * 12` when annual is not offered).

### Front-end (`index.html` + `app.js` + `style.css`)

- **Controls bar:** search box, category dropdown, monthly⇄annual toggle.
- **Table columns:** Logo+Name · Category · Headline plan · Price · Free-tier
  badge · ↗ source link.
- **Logos:** rendered from the service's favicon via a public favicon service,
  keyed on the domain in `url`. No image files stored in the repo.
- **Interactivity (all client-side, vanilla JS):**
  - *Search* — live, case-insensitive substring filter on `name`.
  - *Category filter* — dropdown options derived from the dataset.
  - *Sort* — click any column header to sort asc/desc; price column respects the
    monthly/annual toggle.
  - *Toggle* — switches the displayed price between monthly and annual; when
    `annual_usd < monthly_usd * 12`, shows a "save X%" badge.
- **Footer:** "Prices last updated {generated_at}, in USD. Verify on the
  provider's site." Each row also links to its `source_url`.
- **Graceful states:** `null` price → "Custom"; data fetch failure → friendly
  inline error message.

### Categories (initial ~10)

Streaming/Video · Music · Education/Language · Productivity · Developer Tools ·
Design · Cloud Storage · AI · News/Reading · Communication.

The set of valid categories is enforced by `validate.mjs`.

## Data pipeline

### Bootstrap (one-time, in the build session)

Use the Workflow tool to research the initial 100+ services across the ~10
categories in parallel. Each candidate price is independently re-verified against
a cited source before it is written to `services.json` (adversarial verification —
a wrong price is the primary failure mode for a pricing site). Output conforms to
the schema above and passes `validate.mjs`.

### Recurring refresh (CI)

`scripts/refresh.mjs`:
- For each service, use Claude + the web-search tool to find the current price of
  its headline plan and a source URL.
- **Safety rule:** never overwrite a price that cannot be verified. Keep the
  prior value and leave `last_verified` unchanged rather than write a guess.
- On a successful verification, update `monthly_usd` / `annual_usd` /
  `source_url` / `last_verified`, and bump top-level `generated_at`.
- Requires an `ANTHROPIC_API_KEY` repo secret.

`.github/workflows/refresh.yml`: monthly cron → run `refresh.mjs` →
run `validate.mjs` → commit the diff to `main` (which triggers deploy).

### Deploy (CI)

`.github/workflows/deploy.yml`: on push to `main`, run `validate.mjs`, then
publish the static files to GitHub Pages. No build step.

## Testing & validation

- `scripts/validate.mjs` is the primary automated test. It asserts:
  - every entry has all required fields,
  - `id` values are unique and kebab-case,
  - `category` is one of the known categories,
  - `monthly_usd` / `annual_usd` are a number or `null`,
  - `last_verified` and `generated_at` are valid ISO dates,
  - `source_url` and `url` are present and well-formed URLs.
- It gates both refresh-commits and deploys.
- The UI is verified manually (headless browser QA) after the site is built.

## Out of scope (v1)

- Multiple plan tiers per service (only a single headline plan).
- Multi-currency / regional pricing (USD only).
- User accounts, favorites, price-history charts.
- Server-side rendering / SEO pre-rendering (client-side render is acceptable for
  a personal project).
