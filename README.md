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

## Deploy

Pushing to `main` runs validation + tests and deploys to GitHub Pages.
Enable Pages (Settings → Pages → Source: GitHub Actions) and add an
`ANTHROPIC_API_KEY` repo secret for the monthly refresh job.
