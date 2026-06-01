# SaaS Pricing List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static website that lists 100+ SaaS services with USD monthly/annual pricing in an interactive (search/filter/sort/toggle) table, backed by a verified JSON dataset and refreshed by a scheduled CI job.

**Architecture:** Plain static site (no build step) — `index.html` + `style.css` + `app.js`, where `app.js` fetches `data/services.json` and renders an interactive table. All non-DOM logic lives in a pure `lib.mjs` module so it is unit-testable with Node's built-in test runner. A `validate.mjs` script gates data quality. Pricing is gathered by an LLM-research pipeline (bootstrapped via the Workflow tool now; refreshed monthly via `refresh.mjs` in GitHub Actions).

**Tech Stack:** HTML/CSS/vanilla JS (ES modules), Node 20+ (built-in `node --test`), `@anthropic-ai/sdk` (web search) for the refresh script, GitHub Actions + GitHub Pages.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Node project metadata, `type: module`, test/validate scripts |
| `categories.mjs` | Single source of truth for the valid category list |
| `lib.mjs` | Pure functions: price formatting, annual math, savings %, filter, sort |
| `lib.test.mjs` | Unit tests for `lib.mjs` |
| `scripts/validate.mjs` | Exports `validate(data)`; CLI validates `data/services.json` |
| `scripts/validate.test.mjs` | Unit tests for the validator |
| `scripts/refresh.mjs` | CI price-research script (Anthropic SDK + web search) |
| `data/services.json` | Canonical dataset (single source of truth) |
| `index.html` | Page shell: header, controls, table skeleton, footer |
| `style.css` | Responsive styling |
| `app.js` | DOM rendering + event wiring; imports `lib.mjs` |
| `.github/workflows/deploy.yml` | Validate + deploy to GitHub Pages on push to `main` |
| `.github/workflows/refresh.yml` | Monthly cron → refresh → validate → commit |
| `README.md` | Project overview + how to run/refresh |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `categories.mjs`
- Create: `data/services.json` (tiny seed fixture; replaced in Task 6)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "saas-pricing-list",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "validate": "node scripts/validate.mjs"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Create `categories.mjs`**

```js
// The canonical set of valid categories. Both the validator and the
// front-end derive their category options from here.
export const CATEGORIES = [
  "Streaming",
  "Music",
  "Education",
  "Productivity",
  "Developer Tools",
  "Design",
  "Cloud Storage",
  "AI",
  "News & Reading",
  "Communication",
];
```

- [ ] **Step 3: Create a seed `data/services.json`**

```json
{
  "generated_at": "2026-06-01",
  "services": [
    {
      "id": "netflix",
      "name": "Netflix",
      "category": "Streaming",
      "url": "https://netflix.com",
      "description": "Ad-free movie & TV streaming",
      "free_tier": false,
      "headline_plan": "Standard",
      "monthly_usd": 17.99,
      "annual_usd": null,
      "source_url": "https://help.netflix.com/en/node/24926",
      "last_verified": "2026-06-01"
    },
    {
      "id": "spotify",
      "name": "Spotify",
      "category": "Music",
      "url": "https://spotify.com",
      "description": "Music & podcast streaming",
      "free_tier": true,
      "headline_plan": "Premium Individual",
      "monthly_usd": 11.99,
      "annual_usd": 119.99,
      "source_url": "https://www.spotify.com/us/premium/",
      "last_verified": "2026-06-01"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json categories.mjs data/services.json
git commit -m "chore: scaffold project + seed data fixture"
```

---

## Task 2: Pure logic library (`lib.mjs`) — TDD

**Files:**
- Create: `lib.mjs`
- Test: `lib.test.mjs`

Functions to implement: `formatPrice`, `annualTotal`, `displayedPrice`, `savingsPercent`, `priceSortValue`, `filterServices`, `sortServices`.

- [ ] **Step 1: Write the failing tests**

```js
// lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPrice,
  annualTotal,
  displayedPrice,
  savingsPercent,
  priceSortValue,
  filterServices,
  sortServices,
} from "./lib.mjs";

const SVC = {
  monthlyOnly: { id: "a", name: "Aaa", category: "Music", monthly_usd: 10, annual_usd: null },
  withAnnual: { id: "b", name: "Bbb", category: "AI", monthly_usd: 10, annual_usd: 96 },
  custom: { id: "c", name: "Ccc", category: "AI", monthly_usd: null, annual_usd: null },
};

test("formatPrice renders dollars or Custom", () => {
  assert.equal(formatPrice(17.99), "$17.99");
  assert.equal(formatPrice(10), "$10.00");
  assert.equal(formatPrice(null), "Custom");
});

test("annualTotal uses annual_usd, else monthly*12, else null", () => {
  assert.equal(annualTotal(SVC.withAnnual), 96);
  assert.equal(annualTotal(SVC.monthlyOnly), 120);
  assert.equal(annualTotal(SVC.custom), null);
});

test("displayedPrice respects mode", () => {
  assert.equal(displayedPrice(SVC.withAnnual, "monthly"), 10);
  assert.equal(displayedPrice(SVC.withAnnual, "annual"), 96);
  assert.equal(displayedPrice(SVC.monthlyOnly, "annual"), 120);
});

test("savingsPercent only when annual beats 12x monthly", () => {
  assert.equal(savingsPercent(SVC.withAnnual), 20); // 96 vs 120 -> 20%
  assert.equal(savingsPercent(SVC.monthlyOnly), null);
  assert.equal(savingsPercent(SVC.custom), null);
});

test("priceSortValue normalizes to a monthly-equivalent number, nulls last", () => {
  assert.equal(priceSortValue(SVC.withAnnual, "monthly"), 10);
  assert.equal(priceSortValue(SVC.withAnnual, "annual"), 8); // 96/12
  assert.equal(priceSortValue(SVC.custom, "monthly"), Infinity);
});

test("filterServices by query and category", () => {
  const list = [SVC.monthlyOnly, SVC.withAnnual, SVC.custom];
  assert.deepEqual(filterServices(list, { query: "bb", category: "" }).map(s => s.id), ["b"]);
  assert.deepEqual(filterServices(list, { query: "", category: "AI" }).map(s => s.id), ["b", "c"]);
  assert.deepEqual(filterServices(list, { query: "", category: "" }).length, 3);
});

test("sortServices by name and by price", () => {
  const list = [SVC.withAnnual, SVC.monthlyOnly, SVC.custom];
  assert.deepEqual(sortServices(list, "name", "asc", "monthly").map(s => s.id), ["a", "b", "c"]);
  assert.deepEqual(sortServices(list, "name", "desc", "monthly").map(s => s.id), ["c", "b", "a"]);
  // price asc, custom (Infinity) sorts last regardless of direction nulls? -> last on asc
  assert.deepEqual(sortServices(list, "price", "asc", "annual").map(s => s.id), ["b", "a", "c"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib.test.mjs`
Expected: FAIL — `Cannot find module './lib.mjs'` / functions undefined.

- [ ] **Step 3: Implement `lib.mjs`**

```js
// lib.mjs — pure, DOM-free logic. Imported by both app.js and lib.test.mjs.

export function formatPrice(value) {
  if (value == null) return "Custom";
  return "$" + Number(value).toFixed(2);
}

export function annualTotal(service) {
  if (service.annual_usd != null) return service.annual_usd;
  if (service.monthly_usd != null) return service.monthly_usd * 12;
  return null;
}

export function displayedPrice(service, mode) {
  return mode === "annual" ? annualTotal(service) : service.monthly_usd;
}

export function savingsPercent(service) {
  const { monthly_usd, annual_usd } = service;
  if (monthly_usd == null || annual_usd == null) return null;
  const full = monthly_usd * 12;
  if (annual_usd >= full) return null;
  return Math.round((1 - annual_usd / full) * 100);
}

// Always returns a monthly-equivalent number so price sorting is consistent
// across the toggle. Missing prices sort last (Infinity).
export function priceSortValue(service, mode) {
  const total = annualTotal(service);
  if (total == null) return Infinity;
  return mode === "annual" ? total / 12 : (service.monthly_usd ?? Infinity);
}

export function filterServices(services, { query, category }) {
  const q = (query || "").trim().toLowerCase();
  return services.filter((s) => {
    const matchesQuery = !q || s.name.toLowerCase().includes(q);
    const matchesCategory = !category || s.category === category;
    return matchesQuery && matchesCategory;
  });
}

export function sortServices(services, column, dir, mode) {
  const factor = dir === "desc" ? -1 : 1;
  const copy = [...services];
  copy.sort((a, b) => {
    let av, bv;
    if (column === "price") {
      av = priceSortValue(a, mode);
      bv = priceSortValue(b, mode);
    } else {
      av = String(a[column] ?? "").toLowerCase();
      bv = String(b[column] ?? "").toLowerCase();
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return copy;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib.test.mjs`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib.mjs lib.test.mjs
git commit -m "feat: add pure pricing/filter/sort logic with tests"
```

---

## Task 3: Data validator (`scripts/validate.mjs`) — TDD

**Files:**
- Create: `scripts/validate.mjs`
- Test: `scripts/validate.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// scripts/validate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.mjs";

function goodEntry(overrides = {}) {
  return {
    id: "netflix",
    name: "Netflix",
    category: "Streaming",
    url: "https://netflix.com",
    description: "Ad-free movie & TV streaming",
    free_tier: false,
    headline_plan: "Standard",
    monthly_usd: 17.99,
    annual_usd: null,
    source_url: "https://help.netflix.com/x",
    last_verified: "2026-06-01",
    ...overrides,
  };
}

function goodDoc(services) {
  return { generated_at: "2026-06-01", services };
}

test("valid document has no errors", () => {
  assert.deepEqual(validate(goodDoc([goodEntry()])), []);
});

test("missing required field is reported", () => {
  const e = goodEntry();
  delete e.source_url;
  const errors = validate(goodDoc([e]));
  assert.ok(errors.some((m) => m.includes("source_url")));
});

test("duplicate ids are reported", () => {
  const errors = validate(goodDoc([goodEntry(), goodEntry()]));
  assert.ok(errors.some((m) => m.toLowerCase().includes("duplicate")));
});

test("unknown category is reported", () => {
  const errors = validate(goodDoc([goodEntry({ category: "Nonsense" })]));
  assert.ok(errors.some((m) => m.includes("category")));
});

test("non-kebab id is reported", () => {
  const errors = validate(goodDoc([goodEntry({ id: "Netflix_1" })]));
  assert.ok(errors.some((m) => m.includes("id")));
});

test("price must be number or null", () => {
  const errors = validate(goodDoc([goodEntry({ monthly_usd: "free" })]));
  assert.ok(errors.some((m) => m.includes("monthly_usd")));
});

test("bad date is reported", () => {
  const errors = validate(goodDoc([goodEntry({ last_verified: "06/01/2026" })]));
  assert.ok(errors.some((m) => m.includes("last_verified")));
});

test("bad url is reported", () => {
  const errors = validate(goodDoc([goodEntry({ url: "not a url" })]));
  assert.ok(errors.some((m) => m.includes("url")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/validate.test.mjs`
Expected: FAIL — `Cannot find module './validate.mjs'`.

- [ ] **Step 3: Implement `scripts/validate.mjs`**

```js
// scripts/validate.mjs
import { readFile } from "node:fs/promises";
import { CATEGORIES } from "../categories.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isIsoDate(v) {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}
function isUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}
function isPrice(v) {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

// Returns an array of human-readable error strings. Empty array = valid.
export function validate(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["root: document is not an object"];
  if (!isIsoDate(doc.generated_at)) errors.push("generated_at: must be an ISO date (YYYY-MM-DD)");
  if (!Array.isArray(doc.services)) return [...errors, "services: must be an array"];

  const seen = new Set();
  doc.services.forEach((s, i) => {
    const at = `services[${i}]`;
    const need = (cond, msg) => { if (!cond) errors.push(`${at}: ${msg}`); };

    need(typeof s.id === "string" && KEBAB.test(s.id), "id must be kebab-case string");
    if (typeof s.id === "string") {
      if (seen.has(s.id)) errors.push(`${at}: duplicate id "${s.id}"`);
      seen.add(s.id);
    }
    need(typeof s.name === "string" && s.name.length > 0, "name is required");
    need(CATEGORIES.includes(s.category), `category "${s.category}" not in known categories`);
    need(isUrl(s.url), "url must be a valid URL");
    need(typeof s.description === "string", "description is required");
    need(typeof s.free_tier === "boolean", "free_tier must be boolean");
    need(typeof s.headline_plan === "string" && s.headline_plan.length > 0, "headline_plan is required");
    need(isPrice(s.monthly_usd), "monthly_usd must be a number or null");
    need(isPrice(s.annual_usd), "annual_usd must be a number or null");
    need(isUrl(s.source_url), "source_url must be a valid URL");
    need(isIsoDate(s.last_verified), "last_verified must be an ISO date (YYYY-MM-DD)");
  });
  return errors;
}

// CLI entry: validate data/services.json relative to repo root.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const path = new URL("../data/services.json", import.meta.url);
  const doc = JSON.parse(await readFile(path, "utf8"));
  const errors = validate(doc);
  if (errors.length) {
    console.error(`✗ ${errors.length} validation error(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`✓ ${doc.services.length} services valid`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/validate.test.mjs`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Run the validator CLI against seed data**

Run: `npm run validate`
Expected: `✓ 2 services valid`

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.mjs scripts/validate.test.mjs
git commit -m "feat: add data validator with tests"
```

---

## Task 4: Front-end shell (`index.html` + `style.css`)

**Files:**
- Create: `index.html`
- Create: `style.css`

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SaaS Pricing List — monthly & annual prices</title>
    <meta name="description" content="A curated, regularly-updated list of SaaS service prices (USD), monthly and annual." />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="site-header">
      <h1>SaaS Pricing List</h1>
      <p class="tagline">Monthly &amp; annual prices for popular services, in USD.</p>
    </header>

    <section class="controls" aria-label="Filters">
      <input id="search" type="search" placeholder="Search services…" autocomplete="off" />
      <select id="category" aria-label="Filter by category">
        <option value="">All categories</option>
      </select>
      <div class="toggle" role="group" aria-label="Billing period">
        <button id="toggle-monthly" class="active" data-mode="monthly">Monthly</button>
        <button id="toggle-annual" data-mode="annual">Annual</button>
      </div>
    </section>

    <p id="status" class="status" role="status"></p>

    <table id="table" class="pricing">
      <thead>
        <tr>
          <th data-column="name" class="sortable" aria-sort="none">Service</th>
          <th data-column="category" class="sortable" aria-sort="none">Category</th>
          <th>Plan</th>
          <th data-column="price" class="sortable" aria-sort="none">Price</th>
          <th>Free tier</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>

    <footer class="site-footer">
      <p id="updated"></p>
      <p>Prices in USD. Always verify on the provider's own site before subscribing.</p>
    </footer>

    <script type="module" src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `style.css`**

```css
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --text: #e7e9ee;
  --muted: #9aa1ad;
  --accent: #5b8cff;
  --border: #262b35;
  --good: #3ecf8e;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
}
.site-header { padding: 2.5rem 1.25rem 1rem; text-align: center; }
.site-header h1 { margin: 0; font-size: 2rem; }
.tagline { color: var(--muted); margin: .35rem 0 0; }

.controls {
  display: flex; flex-wrap: wrap; gap: .75rem;
  max-width: 1000px; margin: 1rem auto; padding: 0 1.25rem; align-items: center;
}
.controls #search { flex: 1 1 240px; }
.controls input, .controls select {
  background: var(--panel); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px; padding: .55rem .7rem; font: inherit;
}
.toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.toggle button {
  background: var(--panel); color: var(--muted); border: 0; padding: .55rem .9rem; cursor: pointer; font: inherit;
}
.toggle button.active { background: var(--accent); color: #fff; }

.status { max-width: 1000px; margin: 0 auto; padding: 0 1.25rem; color: var(--muted); min-height: 1.25rem; }

table.pricing {
  width: 100%; max-width: 1000px; margin: .5rem auto 2rem; border-collapse: collapse; padding: 0 1.25rem;
}
.pricing th, .pricing td { padding: .7rem .75rem; border-bottom: 1px solid var(--border); text-align: left; }
.pricing thead th { color: var(--muted); font-weight: 600; }
.pricing th.sortable { cursor: pointer; user-select: none; }
.pricing th.sortable[aria-sort="ascending"]::after { content: " ▲"; color: var(--accent); }
.pricing th.sortable[aria-sort="descending"]::after { content: " ▼"; color: var(--accent); }

.svc { display: flex; align-items: center; gap: .6rem; }
.svc img { width: 20px; height: 20px; border-radius: 4px; background: #fff; }
.price { font-variant-numeric: tabular-nums; font-weight: 600; }
.save { color: var(--good); font-size: .8rem; margin-left: .4rem; }
.badge { font-size: .75rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.badge.yes { color: var(--good); border-color: var(--good); }
a { color: var(--accent); }

.site-footer { max-width: 1000px; margin: 0 auto; padding: 1.25rem; color: var(--muted); font-size: .9rem; }

@media (max-width: 640px) {
  .pricing thead { display: none; }
  .pricing, .pricing tbody, .pricing tr, .pricing td { display: block; width: 100%; }
  .pricing tr { border: 1px solid var(--border); border-radius: 10px; margin: 0 1.25rem 1rem; padding: .5rem; }
  .pricing td { border: 0; padding: .25rem .5rem; }
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat: add static page shell and styles"
```

---

## Task 5: Front-end behavior (`app.js`)

**Files:**
- Create: `app.js`

Verification is via headless browser (no unit DOM test) since all testable logic
already lives in `lib.mjs`. `app.js` is the thin DOM layer.

- [ ] **Step 1: Implement `app.js`**

```js
// app.js — DOM rendering and event wiring. Pure logic lives in lib.mjs.
import {
  formatPrice, displayedPrice, savingsPercent, filterServices, sortServices,
} from "./lib.mjs";
import { CATEGORIES } from "./categories.mjs";

const state = { services: [], mode: "monthly", query: "", category: "", sort: { column: "name", dir: "asc" } };

const $ = (sel) => document.querySelector(sel);
const rowsEl = $("#rows");
const statusEl = $("#status");

function faviconUrl(serviceUrl) {
  try {
    const host = new URL(serviceUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch { return ""; }
}

function render() {
  const filtered = filterServices(state.services, { query: state.query, category: state.category });
  const sorted = sortServices(filtered, state.sort.column, state.sort.dir, state.mode);

  rowsEl.innerHTML = "";
  for (const s of sorted) {
    const price = displayedPrice(s, state.mode);
    const save = state.mode === "annual" ? savingsPercent(s) : null;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="svc"><img alt="" loading="lazy" src="${faviconUrl(s.url)}" /><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></span></td>
      <td>${s.category}</td>
      <td>${s.headline_plan}</td>
      <td class="price">${formatPrice(price)}${save ? `<span class="save">save ${save}%</span>` : ""}</td>
      <td><span class="badge ${s.free_tier ? "yes" : ""}">${s.free_tier ? "Free tier" : "No"}</span></td>
      <td><a href="${s.source_url}" target="_blank" rel="noopener">source ↗</a></td>`;
    rowsEl.appendChild(tr);
  }
  statusEl.textContent = `${sorted.length} of ${state.services.length} services`;
}

function wireControls() {
  // Category dropdown options
  const sel = $("#category");
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c; sel.appendChild(opt);
  }

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  sel.addEventListener("change", (e) => { state.category = e.target.value; render(); });

  for (const btn of document.querySelectorAll(".toggle button")) {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll(".toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  }

  for (const th of document.querySelectorAll("th.sortable")) {
    th.addEventListener("click", () => {
      const col = th.dataset.column;
      if (state.sort.column === col) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { column: col, dir: "asc" };
      }
      document.querySelectorAll("th.sortable").forEach((h) => h.setAttribute("aria-sort", "none"));
      th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      render();
    });
  }
}

async function init() {
  wireControls();
  try {
    const res = await fetch("data/services.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    state.services = doc.services;
    $("#updated").textContent = `Prices last updated ${doc.generated_at}.`;
    render();
  } catch (err) {
    statusEl.textContent = "Could not load pricing data. Please try again later.";
    console.error(err);
  }
}

init();
```

- [ ] **Step 2: Serve the site locally**

Run: `python3 -m http.server 8000` (run in background) — serves repo root.
Expected: server listening on http://localhost:8000

- [ ] **Step 3: QA in a headless browser**

Use the `browse` skill (or `/browse`) to open `http://localhost:8000` and verify:
- table shows the 2 seed services with favicons,
- typing in search filters rows,
- selecting a category filters rows,
- clicking the **Annual** toggle changes Spotify's price to `$119.99` with a "save %" badge and Netflix to `$215.88`,
- clicking the **Price** and **Service** headers re-sorts (arrow indicator updates),
- footer shows "Prices last updated 2026-06-01."

Fix any issues found before committing.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add interactive table rendering and controls"
```

---

## Task 6: Bootstrap the dataset (100+ services) via Workflow

**Files:**
- Modify: `data/services.json` (replace seed with full dataset)

This task uses the **Workflow tool** to research and verify pricing. The user has
opted into workflows. Scale to ~100+ services across the 10 categories.

- [ ] **Step 1: Run the research workflow**

Author and run a Workflow script that:
1. Defines the target services per category (~10–12 per category). Always include the user's named examples: Netflix, Spotify, Duolingo, YouTube Premium, rss.app.
2. **Stage A (research):** one agent per category researches each service's headline plan, monthly price, annual price (if offered), free-tier flag, homepage URL, and a source URL — using web search. Returns entries matching the schema (a JSON Schema is passed to `agent()` so output is validated).
3. **Stage B (verify):** for each researched entry, an independent agent re-checks the price against the cited `source_url` and returns `{ verified: boolean, corrected?: {...} }`. Default to `verified: false` when uncertain.
4. Keep only verified entries (apply corrections). Drop or log any service that fails verification so the count of dropped services is visible (no silent truncation).
5. Assign kebab-case `id`s, set `last_verified` and top-level `generated_at` to today's date (`2026-06-01`), and assemble the final document.

Use the canonical schema from the spec for the `agent()` `schema` option. Pipeline the two stages so verification of one category starts while others are still being researched.

- [ ] **Step 2: Write the assembled document to `data/services.json`**

Write the workflow's final result (pretty-printed JSON) to `data/services.json`.

- [ ] **Step 3: Validate the full dataset**

Run: `npm run validate`
Expected: `✓ N services valid` with N ≥ 100. If errors are reported, fix the offending entries (or drop them) and re-run until clean.

- [ ] **Step 4: Re-QA the live site**

Restart `python3 -m http.server 8000` if needed and re-open in the browse skill.
Verify the table now lists 100+ services, category dropdown filtering works across
all categories, and sorting by price behaves with the full dataset.

- [ ] **Step 5: Commit**

```bash
git add data/services.json
git commit -m "data: add verified pricing for 100+ services"
```

---

## Task 7: Recurring refresh script (`scripts/refresh.mjs`)

**Files:**
- Create: `scripts/refresh.mjs`
- Modify: `package.json` (add `refresh` script + `@anthropic-ai/sdk` dependency)

This script is what the monthly CI cron runs. It is not part of the page bundle.

- [ ] **Step 1: Add the dependency and script**

Run: `npm install @anthropic-ai/sdk`

Then add to `package.json` `scripts`:

```json
    "refresh": "node scripts/refresh.mjs"
```

- [ ] **Step 2: Implement `scripts/refresh.mjs`**

```js
// scripts/refresh.mjs
// Re-verifies each service's headline-plan price via Claude + web search.
// SAFETY: never overwrites a price that cannot be verified — keeps the prior
// value and leaves last_verified unchanged.
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { validate } from "./validate.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const dataPath = new URL("../data/services.json", import.meta.url);
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const RESULT_SCHEMA = `Return ONLY a JSON object:
{"verified": boolean, "monthly_usd": number|null, "annual_usd": number|null, "source_url": string}
verified=false if you are not confident. monthly_usd/annual_usd are the headline plan price in USD; annual_usd is the total yearly cost if billed annually, else null.`;

async function checkService(s) {
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    messages: [{
      role: "user",
      content: `Find the CURRENT US price (USD) of the "${s.headline_plan}" plan for ${s.name} (${s.url}). ${RESULT_SCHEMA}`,
    }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verified: false };
  try { return JSON.parse(match[0]); } catch { return { verified: false }; }
}

const doc = JSON.parse(await readFile(dataPath, "utf8"));
let updated = 0, kept = 0;
for (const s of doc.services) {
  let r;
  try { r = await checkService(s); } catch (e) { console.error(`! ${s.id}: ${e.message}`); r = { verified: false }; }
  if (r && r.verified) {
    s.monthly_usd = r.monthly_usd ?? s.monthly_usd;
    s.annual_usd = r.annual_usd ?? null;
    if (r.source_url) s.source_url = r.source_url;
    s.last_verified = TODAY;
    updated++;
  } else {
    console.warn(`~ ${s.id}: not verified, keeping prior value`);
    kept++;
  }
}
doc.generated_at = TODAY;

const errors = validate(doc);
if (errors.length) {
  console.error("Refusing to write — validation failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
await writeFile(dataPath, JSON.stringify(doc, null, 2) + "\n");
console.log(`✓ refreshed ${updated} services, kept ${kept} unverified, ${doc.services.length} total`);
```

- [ ] **Step 3: Commit (do not run live here — it consumes API credits)**

```bash
git add scripts/refresh.mjs package.json package-lock.json
git commit -m "feat: add monthly price-refresh script"
```

---

## Task 8: CI workflows

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.github/workflows/refresh.yml`

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm run validate
      - run: node --test
      - uses: actions/upload-pages-artifact@v3
        with: { path: "." }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create `.github/workflows/refresh.yml`**

```yaml
name: Refresh prices
on:
  schedule:
    - cron: "0 6 1 * *"   # 06:00 UTC on the 1st of each month
  workflow_dispatch:
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run refresh
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - run: npm run validate
      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/services.json
          git diff --staged --quiet || git commit -m "data: monthly price refresh"
          git push
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/refresh.yml
git commit -m "ci: add deploy and monthly refresh workflows"
```

> **Note:** `npm ci` in `refresh.yml` requires a committed `package-lock.json` (created in Task 7). After pushing to GitHub, enable Pages (Settings → Pages → Source: GitHub Actions) and add the `ANTHROPIC_API_KEY` repo secret. These are manual one-time GitHub UI steps, performed by the user.

---

## Task 9: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# SaaS Pricing List

A static website listing 100+ SaaS services with their USD monthly/annual prices
in a searchable, filterable, sortable table. Data is verified against cited
sources and refreshed monthly by a GitHub Actions job.

## Develop

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Data

- `data/services.json` is the single source of truth.
- `npm run validate` checks the dataset.
- `npm test` runs unit tests (`node --test`).
- `npm run refresh` re-verifies prices via Claude + web search (needs `ANTHROPIC_API_KEY`).

## Deploy

Pushing to `main` runs validation + tests and deploys to GitHub Pages.
Enable Pages (Settings → Pages → Source: GitHub Actions) and add an
`ANTHROPIC_API_KEY` repo secret for the monthly refresh job.
```

- [ ] **Step 2: Run the full check suite**

Run: `node --test && npm run validate`
Expected: all tests pass and `✓ N services valid`.

- [ ] **Step 3: Final headless-browser QA pass**

Open the served site and confirm the full dataset renders and every control works
(search, category, sort, monthly/annual toggle). Fix anything broken.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review

**Spec coverage:**
- Static site (HTML/CSS/JS, no build) → Tasks 4, 5 ✓
- 100+ services dataset → Task 6 ✓
- JSON schema (all fields) → Task 1 (shape), Task 3 (enforced) ✓
- Search / category / sort / monthly⇄annual toggle → Task 2 (logic) + Task 5 (UI) ✓
- USD only → reflected throughout; no currency field ✓
- Favicon logos → Task 5 `faviconUrl` ✓
- Periodic CI refresh + verification + "never overwrite unverified" rule → Tasks 6 (bootstrap verify), 7 (refresh), 8 (cron) ✓
- Validator as primary test, gates deploy + refresh → Tasks 3, 8 ✓
- GitHub Pages deploy → Task 8 ✓
- Categories enforced → Task 1 `categories.mjs` + Task 3 validator ✓
- Out-of-scope items (multi-plan, multi-currency, SSR) → not implemented ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. (Task 6 is inherently a generative research step, but its inputs/outputs/validation gate are fully specified.)

**Type consistency:** Field names (`monthly_usd`, `annual_usd`, `headline_plan`, `free_tier`, `source_url`, `last_verified`, `generated_at`) are identical across schema, validator, `lib.mjs`, `app.js`, and `refresh.mjs`. Function names (`formatPrice`, `annualTotal`, `displayedPrice`, `savingsPercent`, `priceSortValue`, `filterServices`, `sortServices`, `validate`) are consistent between definition, tests, and callers.
