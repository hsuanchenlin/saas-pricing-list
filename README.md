# SaaS Pricing List

A static website listing 100+ SaaS services with their USD monthly/annual prices
in a searchable, filterable, sortable table. Each price is verified against a
cited source and the dataset is refreshed monthly by a GitHub Actions job.

## Develop

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

No build step — `index.html` loads `app.js`, which fetches `data/services.json`
and renders the table. Search, category filter, column sort, and the
monthly⇄annual toggle all run client-side.

## Data

- `data/services.json` is the single source of truth.
- `npm run validate` checks the dataset (required fields, unique kebab ids,
  known categories, number-or-null prices, ISO dates, valid URLs).
- `npm test` runs unit tests (`node --test`).
- `npm run refresh` re-verifies prices via Claude + web search (needs
  `ANTHROPIC_API_KEY`). It never overwrites a price it cannot verify.

## Subscription tracker

`tracker.html` lets signed-in users record subscriptions and get an email before each
renewal. Backend: Supabase (magic-link auth + Postgres + RLS); reminder cron + email:
a Vercel serverless function (`api/send-reminders.ts`) on a daily schedule via Resend.

### Setup
1. Supabase: apply `supabase/migrations/0001_subscriptions.sql` in the SQL Editor; set
   Auth redirect URLs to the Vercel domain + `http://localhost:3000`.
2. Resend: verify a sender; get `RESEND_API_KEY`.
3. Vercel: import the repo; set env vars `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `RESEND_API_KEY`, `REMINDER_FROM`, `CRON_SECRET`.

### Local dev
`npx vercel dev` serves the static site + `/api` functions on :3000.
`npm test` runs unit tests; `npm run validate` checks the catalog data.

## Deploy

The site (catalog + tracker) is hosted on **Vercel**, which auto-deploys on every push
to `main`. The monthly `refresh.yml` job re-verifies catalog prices and commits
`data/services.json` (needs an `ANTHROPIC_API_KEY` repo secret); that commit triggers a
Vercel redeploy.
