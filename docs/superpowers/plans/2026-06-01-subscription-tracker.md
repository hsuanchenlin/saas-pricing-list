# Subscription Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logged-in subscription tracker to the existing static catalog: users sign in via magic link, record subscriptions (service + start/end dates), and get an email a few days before each renewal so they can cancel.

**Architecture:** The vanilla static frontend gains a `tracker.html` page that talks directly to Supabase (magic-link auth + Postgres + RLS) using the public publishable key. A single Vercel serverless function (`api/send-reminders.ts`), triggered daily by Vercel Cron, uses the Supabase secret key to find due subscriptions and email users via Resend. All non-IO logic lives in a pure `lib/reminders.mjs` module that is unit-tested and shared by both the UI and the function.

**Tech Stack:** Vanilla HTML/CSS/JS (ES modules), `@supabase/supabase-js` (browser via esm.sh CDN; server via npm), `resend`, Vercel serverless functions + Cron, Supabase Postgres, Node 20 `node --test`.

**Supabase project:** URL `https://ofitleegdvhbwqebtepk.supabase.co`, publishable key `sb_publishable_D4MoU3UvGChSoQPWPJNDeg_dcq-38ii` (public). Secret key + `RESEND_API_KEY` + `CRON_SECRET` live in Vercel env only.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/reminders.mjs` | Pure logic: date parsing, `isReminderDue`, `daysUntil`, `dueReminders`, `validateSubscriptionInput` |
| `lib/reminders.test.mjs` | Unit tests for the above |
| `supabase/migrations/0001_subscriptions.sql` | `subscriptions` table + index + RLS policies |
| `js/supabase-client.js` | Initializes and exports the browser `supabase` client |
| `js/auth.js` | Magic-link sign in/out + session state wiring |
| `js/subscriptions.js` | Subscription CRUD + rendering + catalog service picker |
| `tracker.html` | Logged-in tracker page (signed-out + signed-in views) |
| `api/send-reminders.ts` | Vercel serverless function: daily reminder sender |
| `vercel.json` | Static config + daily cron schedule |
| `package.json` | Add `@supabase/supabase-js` + `resend` deps; keep test script |
| `index.html` | Add a nav link to the tracker |
| `.github/workflows/deploy.yml` | **Removed** (Vercel auto-deploys) |
| `README.md` | Document the tracker, env vars, and setup |

---

# Phase A — Auth + Subscription CRUD (independently shippable)

## Task 1: Supabase migration

**Files:**
- Create: `supabase/migrations/0001_subscriptions.sql`

This SQL is applied manually in the Supabase SQL Editor (no automated test — it runs
against managed Postgres).

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/0001_subscriptions.sql
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service_id text,
  service_name text not null,
  start_date date not null,
  end_date date not null,
  reminder_days int not null default 3 check (reminder_days between 0 and 90),
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_due_idx
  on public.subscriptions (reminded_at, end_date);

alter table public.subscriptions enable row level security;

create policy "select own" on public.subscriptions
  for select using (auth.uid() = user_id);
create policy "insert own" on public.subscriptions
  for insert with check (auth.uid() = user_id);
create policy "update own" on public.subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own" on public.subscriptions
  for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply it (manual)**

Paste the file contents into Supabase → SQL Editor → Run. Expected: "Success. No rows returned."
Then in Table Editor confirm `subscriptions` exists with RLS enabled (a shield icon).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_subscriptions.sql
git commit -m "feat: add subscriptions table migration with RLS"
```

---

## Task 2: Shared reminder logic (`lib/reminders.mjs`) — TDD

**Files:**
- Create: `lib/reminders.mjs`
- Test: `lib/reminders.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// lib/reminders.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDate, daysUntil, isReminderDue, dueReminders, validateSubscriptionInput,
} from "./reminders.mjs";

test("parseDate accepts ISO dates and rejects junk", () => {
  assert.ok(parseDate("2026-06-10") instanceof Date);
  assert.equal(parseDate("06/10/2026"), null);
  assert.equal(parseDate("nope"), null);
  assert.equal(parseDate(123), null);
});

test("daysUntil counts whole days, negative in the past", () => {
  assert.equal(daysUntil("2026-06-10", "2026-06-01"), 9);
  assert.equal(daysUntil("2026-06-01", "2026-06-01"), 0);
  assert.equal(daysUntil("2026-05-30", "2026-06-01"), -2);
  assert.equal(daysUntil("bad", "2026-06-01"), null);
});

test("isReminderDue fires only inside the window and only once", () => {
  const base = { endDate: "2026-06-10", reminderDays: 3, remindedAt: null };
  assert.equal(isReminderDue({ ...base, today: "2026-06-07" }), true);  // exactly 3 days before
  assert.equal(isReminderDue({ ...base, today: "2026-06-10" }), true);  // on the day
  assert.equal(isReminderDue({ ...base, today: "2026-06-06" }), false); // 4 days before
  assert.equal(isReminderDue({ ...base, today: "2026-06-11" }), false); // already past
  assert.equal(isReminderDue({ ...base, today: "2026-06-08", remindedAt: "2026-06-08T09:00:00Z" }), false);
});

test("dueReminders filters rows using each row's reminder_days", () => {
  const rows = [
    { id: "a", end_date: "2026-06-03", reminder_days: 3, reminded_at: null },
    { id: "b", end_date: "2026-06-20", reminder_days: 3, reminded_at: null },
    { id: "c", end_date: "2026-06-03", reminder_days: 3, reminded_at: "2026-06-01T00:00:00Z" },
  ];
  assert.deepEqual(dueReminders(rows, "2026-06-01").map((r) => r.id), ["a"]);
});

test("validateSubscriptionInput catches each bad field", () => {
  assert.deepEqual(validateSubscriptionInput({
    service_name: "Netflix", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 3,
  }), []);
  assert.ok(validateSubscriptionInput({ service_name: " ", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("service_name")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "x", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("start_date")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "2026-07-02", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("on or after")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 99 })
    .some((m) => m.includes("reminder_days")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/reminders.test.mjs`
Expected: FAIL — `Cannot find module './reminders.mjs'`.

- [ ] **Step 3: Implement `lib/reminders.mjs`**

```js
// lib/reminders.mjs — pure, dependency-free subscription/reminder logic.
// Shared by the tracker UI (js/subscriptions.js) and the reminder function
// (api/send-reminders.ts).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

// Parse an ISO date (YYYY-MM-DD) to a UTC-midnight Date, or null if invalid.
export function parseDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole days from `today` until `endDate` (negative if past). Both ISO strings.
export function daysUntil(endDate, today) {
  const e = parseDate(endDate), t = parseDate(today);
  if (!e || !t) return null;
  return Math.round((e - t) / DAY);
}

// True when a reminder should fire: not yet reminded and today is within
// [endDate - reminderDays, endDate].
export function isReminderDue({ endDate, reminderDays, today, remindedAt }) {
  if (remindedAt) return false;
  const d = daysUntil(endDate, today);
  if (d === null) return false;
  return d >= 0 && d <= reminderDays;
}

// Filter raw subscription rows down to those due for a reminder today.
export function dueReminders(rows, today) {
  return rows.filter((r) =>
    isReminderDue({
      endDate: r.end_date,
      reminderDays: r.reminder_days,
      today,
      remindedAt: r.reminded_at,
    })
  );
}

// Validate add/edit form input. Returns array of error strings ([] = valid).
export function validateSubscriptionInput({ service_name, start_date, end_date, reminder_days }) {
  const errors = [];
  if (typeof service_name !== "string" || service_name.trim() === "") {
    errors.push("service_name is required");
  }
  const start = parseDate(start_date);
  const end = parseDate(end_date);
  if (!start) errors.push("start_date must be a valid date (YYYY-MM-DD)");
  if (!end) errors.push("end_date must be a valid date (YYYY-MM-DD)");
  if (start && end && end < start) errors.push("end_date must be on or after start_date");
  if (!Number.isInteger(reminder_days) || reminder_days < 0 || reminder_days > 90) {
    errors.push("reminder_days must be an integer between 0 and 90");
  }
  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/reminders.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Confirm the whole suite still passes**

Run: `node --test`
Expected: existing lib/validate tests + these all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add lib/reminders.mjs lib/reminders.test.mjs
git commit -m "feat: add shared reminder/subscription logic with tests"
```

---

## Task 3: Supabase browser client

**Files:**
- Create: `js/supabase-client.js`

- [ ] **Step 1: Create the client module**

```js
// js/supabase-client.js — single shared Supabase browser client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://ofitleegdvhbwqebtepk.supabase.co";
// Publishable key is safe in the browser; RLS protects the data.
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D4MoU3UvGChSoQPWPJNDeg_dcq-38ii";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
```

- [ ] **Step 2: Commit**

```bash
git add js/supabase-client.js
git commit -m "feat: add supabase browser client"
```

---

## Task 4: Auth UI (`js/auth.js`) + tracker page shell

**Files:**
- Create: `js/auth.js`
- Create: `tracker.html`

- [ ] **Step 1: Create `js/auth.js`**

```js
// js/auth.js — magic-link sign in/out and session-state wiring.
import { supabase } from "./supabase-client.js";

// Wires the auth form and reports session changes via callbacks.
export function initAuth({ onSignedIn, onSignedOut }) {
  const form = document.querySelector("#signin-form");
  const emailInput = document.querySelector("#signin-email");
  const msg = document.querySelector("#auth-msg");
  const signoutBtn = document.querySelector("#signout");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.value.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    msg.textContent = error
      ? `Error: ${error.message}`
      : "Check your email for a sign-in link.";
  });

  signoutBtn.addEventListener("click", () => supabase.auth.signOut());

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) onSignedIn(session.user);
    else onSignedOut();
  });
  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user) onSignedIn(data.session.user);
    else onSignedOut();
  });
}
```

- [ ] **Step 2: Create `tracker.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Subscriptions — SaaS Pricing List</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="site-header">
      <h1>My Subscriptions</h1>
      <p class="tagline"><a href="index.html">← Back to the catalog</a></p>
    </header>

    <!-- Signed-out view -->
    <section id="signed-out" class="controls" aria-label="Sign in" hidden>
      <form id="signin-form" class="controls" style="margin:0;padding:0">
        <input id="signin-email" type="email" required placeholder="you@example.com" autocomplete="email" />
        <button type="submit">Send me a sign-in link</button>
      </form>
      <p id="auth-msg" class="status"></p>
    </section>

    <!-- Signed-in view -->
    <section id="signed-in" hidden>
      <div class="controls">
        <span id="who" class="status"></span>
        <button id="signout">Sign out</button>
      </div>

      <form id="add-form" class="controls" aria-label="Add subscription">
        <input id="f-service" list="service-list" placeholder="Service" required />
        <datalist id="service-list"></datalist>
        <label>Start <input id="f-start" type="date" required /></label>
        <label>Renews <input id="f-end" type="date" required /></label>
        <label>Remind <input id="f-days" type="number" min="0" max="90" value="3" style="width:4rem" /> days before</label>
        <button type="submit">Add</button>
      </form>
      <p id="add-msg" class="status"></p>

      <table id="subs-table" class="pricing">
        <thead>
          <tr><th>Service</th><th>Start</th><th>Renews</th><th>Reminder</th><th>Days left</th><th></th></tr>
        </thead>
        <tbody id="subs-rows"></tbody>
      </table>
    </section>

    <script type="module" src="js/tracker-main.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add js/auth.js tracker.html
git commit -m "feat: add tracker page shell and magic-link auth"
```

---

## Task 5: Subscription CRUD + rendering (`js/subscriptions.js` + `js/tracker-main.js`)

**Files:**
- Create: `js/subscriptions.js`
- Create: `js/tracker-main.js`

- [ ] **Step 1: Create `js/subscriptions.js`**

```js
// js/subscriptions.js — subscription CRUD, catalog picker, and row rendering.
import { supabase } from "./supabase-client.js";
import { daysUntil, validateSubscriptionInput } from "../lib/reminders.mjs";

let CATALOG = [];

export async function loadCatalog() {
  try {
    const res = await fetch("data/services.json");
    CATALOG = (await res.json()).services;
  } catch {
    CATALOG = [];
  }
}

export function populateServicePicker(listEl) {
  listEl.innerHTML = "";
  for (const s of CATALOG) {
    const opt = document.createElement("option");
    opt.value = s.name;
    listEl.appendChild(opt);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function listSubscriptions() {
  const { data, error } = await supabase
    .from("subscriptions").select("*").order("end_date", { ascending: true });
  if (error) throw error;
  return data;
}

// Returns { errors: string[] }. Empty errors = inserted.
export async function addSubscription(input) {
  const errors = validateSubscriptionInput(input);
  if (errors.length) return { errors };
  const match = CATALOG.find((s) => s.name === input.service_name);
  const { error } = await supabase.from("subscriptions").insert({
    service_id: match ? match.id : null,
    service_name: input.service_name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    reminder_days: input.reminder_days,
  });
  return { errors: error ? [error.message] : [] };
}

export async function deleteSubscription(id) {
  const { error } = await supabase.from("subscriptions").delete().eq("id", id);
  if (error) throw error;
}

export function renderRows(tbody, rows) {
  const today = todayIso();
  tbody.innerHTML = "";
  for (const r of rows) {
    const d = daysUntil(r.end_date, today);
    const soon = d !== null && d >= 0 && d <= r.reminder_days;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.service_name}</td>
      <td>${r.start_date}</td>
      <td>${r.end_date}</td>
      <td>${r.reminder_days}d before</td>
      <td class="${soon ? "due" : ""}">${d === null ? "—" : d + " days"}</td>
      <td><button class="del" data-id="${r.id}">Delete</button></td>`;
    tbody.appendChild(tr);
  }
}
```

- [ ] **Step 2: Create `js/tracker-main.js` (wires auth + CRUD to the DOM)**

```js
// js/tracker-main.js — entry point for tracker.html.
import { initAuth } from "./auth.js";
import {
  loadCatalog, populateServicePicker, listSubscriptions,
  addSubscription, deleteSubscription, renderRows,
} from "./subscriptions.js";

const signedOut = document.querySelector("#signed-out");
const signedIn = document.querySelector("#signed-in");
const who = document.querySelector("#who");
const rows = document.querySelector("#subs-rows");
const addMsg = document.querySelector("#add-msg");

async function refresh() {
  try {
    renderRows(rows, await listSubscriptions());
  } catch (e) {
    addMsg.textContent = `Could not load subscriptions: ${e.message}`;
  }
}

function showSignedIn(user) {
  signedOut.hidden = true;
  signedIn.hidden = false;
  who.textContent = `Signed in as ${user.email}`;
  refresh();
}
function showSignedOut() {
  signedIn.hidden = true;
  signedOut.hidden = false;
}

async function main() {
  await loadCatalog();
  populateServicePicker(document.querySelector("#service-list"));

  document.querySelector("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    addMsg.textContent = "";
    const { errors } = await addSubscription({
      service_name: document.querySelector("#f-service").value,
      start_date: document.querySelector("#f-start").value,
      end_date: document.querySelector("#f-end").value,
      reminder_days: Number(document.querySelector("#f-days").value),
    });
    if (errors.length) { addMsg.textContent = errors.join("; "); return; }
    e.target.reset();
    document.querySelector("#f-days").value = "3";
    refresh();
  });

  rows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button.del");
    if (!btn) return;
    await deleteSubscription(btn.dataset.id);
    refresh();
  });

  initAuth({ onSignedIn: showSignedIn, onSignedOut: showSignedOut });
}

main();
```

- [ ] **Step 3: Add the `.due` style**

Append to `style.css`:

```css
.due { color: #ff6b6b; font-weight: 600; }
#add-form label { color: var(--muted); font-size: .9rem; }
```

- [ ] **Step 4: Manual verification (local)**

Prereq: Supabase Auth → URL Configuration includes `http://localhost:3000`.
Run: `npx vercel dev` (serves static + functions on :3000), or `python3 -m http.server 3000` for the static-only parts.
In the browse skill, open `http://localhost:3000/tracker.html` and verify:
- signed-out view shows the email form,
- submitting a valid email shows "Check your email…",
- after clicking the emailed link you return signed in (who shows your email),
- the service field autocompletes from the catalog,
- adding a subscription with start>end shows a validation message and does NOT insert,
- a valid add inserts a row; "Days left" turns red when within the reminder window,
- Delete removes the row.
Fix any issues before committing.

- [ ] **Step 5: Commit**

```bash
git add js/subscriptions.js js/tracker-main.js style.css
git commit -m "feat: add subscription CRUD UI"
```

---

## Task 6: Frontend wiring + Vercel config + remove Pages workflow

**Files:**
- Modify: `index.html` (add nav link)
- Create: `vercel.json`
- Delete: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add a tracker link to the catalog header**

In `index.html`, change the tagline paragraph to include a link:

```html
      <p class="tagline">Monthly &amp; annual prices for popular services, in USD. · <a href="tracker.html">My subscriptions →</a></p>
```

- [ ] **Step 2: Create `vercel.json` (static config; cron added in Phase B)**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true
}
```

- [ ] **Step 3: Remove the GitHub Pages workflow**

```bash
git rm .github/workflows/deploy.yml
```

- [ ] **Step 4: Verify static still serves**

Run: `python3 -m http.server 3000` and open `http://localhost:3000` in the browse skill;
confirm the catalog still renders and the "My subscriptions →" link goes to `tracker.html`.

- [ ] **Step 5: Commit**

```bash
git add index.html vercel.json
git commit -m "feat: link tracker from catalog; add vercel config; drop Pages workflow"
```

---

# Phase B — Renewal reminder emails

## Task 7: Reminder serverless function (`api/send-reminders.ts`)

**Files:**
- Modify: `package.json` (add deps)
- Create: `api/send-reminders.ts`

The reminder *selection* logic (`dueReminders`) is already unit-tested in Task 2; this
task is the IO wrapper around it. Verify locally with `vercel dev`.

- [ ] **Step 1: Add dependencies**

Run: `npm install @supabase/supabase-js resend`
This adds both to `package.json` `dependencies` and updates `package-lock.json`.

- [ ] **Step 2: Create `api/send-reminders.ts`**

```ts
// api/send-reminders.ts — daily Vercel Cron target. Emails users before a renewal.
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { dueReminders } from "../lib/reminders.mjs";

export default async function handler(req: any, res: any) {
  // Only the Vercel Cron scheduler (which sends this header) may trigger sends.
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string
  );
  const resend = new Resend(process.env.RESEND_API_KEY as string);
  const from = process.env.REMINDER_FROM || "reminders@example.com";
  const today = new Date().toISOString().slice(0, 10);

  // Narrow in SQL (not yet reminded, not past), then filter precisely in JS.
  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("*")
    .is("reminded_at", null)
    .gte("end_date", today);
  if (error) return res.status(500).json({ error: error.message });

  const due = dueReminders(rows ?? [], today);
  let sent = 0;
  for (const r of due) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(r.user_id);
      const email = u?.user?.email;
      if (!email) continue;
      await resend.emails.send({
        from,
        to: email,
        subject: `Heads up: ${r.service_name} renews on ${r.end_date}`,
        text:
          `Your ${r.service_name} subscription renews on ${r.end_date}.\n` +
          `If you don't want to be charged again, cancel before then.`,
      });
      await supabase
        .from("subscriptions")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", r.id);
      sent++;
    } catch (e) {
      console.error(`reminder failed for ${r.id}:`, e);
    }
  }
  return res.status(200).json({ checked: rows?.length ?? 0, due: due.length, sent });
}
```

- [ ] **Step 3: Confirm tests + types still fine**

Run: `node --test`
Expected: all tests pass (this task added no new unit tests; logic was covered in Task 2).

- [ ] **Step 4: Commit**

```bash
git add api/send-reminders.ts package.json package-lock.json
git commit -m "feat: add daily renewal-reminder function"
```

---

## Task 8: Cron schedule + endpoint protection

**Files:**
- Modify: `vercel.json` (add cron)

- [ ] **Step 1: Add the daily cron to `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "crons": [
    { "path": "/api/send-reminders", "schedule": "0 9 * * *" }
  ]
}
```

(Daily at 09:00 UTC — within the Hobby plan's one-run-per-day limit. Vercel Cron
automatically sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in
the project's env vars, which the function checks.)

- [ ] **Step 2: Local verification of the function**

Set a local env file `/.env.local` (gitignored) with `CRON_SECRET`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `REMINDER_FROM`. Insert a test subscription whose
`end_date` is today and `reminder_days` ≥ 0.
Run: `npx vercel dev`
Then: `curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/send-reminders`
Expected JSON: `{"checked":N,"due":1,"sent":1}` and the test email arrives (use a Resend
test/verified recipient). A request without the header returns HTTP 401.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: schedule daily reminder cron"
```

---

## Task 9: Deploy + README

**Files:**
- Modify: `README.md`
- Confirm: `.gitignore` ignores `.env.local` and `.vercel`

- [ ] **Step 1: Ensure local-secret files are ignored**

Append to `.gitignore` if missing:

```
.env*.local
.vercel
```

- [ ] **Step 2: Update `README.md`**

Add a "Subscription tracker" section:

```markdown
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
```

- [ ] **Step 3: Deploy (manual)**

Import the GitHub repo into Vercel, set the env vars above, and deploy. Confirm:
the catalog loads on the Vercel domain, `tracker.html` sign-in works end to end, and
the cron appears under the project's Cron Jobs tab.

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: document subscription tracker setup"
```

---

## Self-Review

**Spec coverage:**
- Vercel host + Supabase auth/DB + Resend → Tasks 1,3,4,7,9 ✓
- `subscriptions` table + RLS → Task 1 ✓
- Magic-link auth → Task 4 ✓
- Tracker UI (table, add form, catalog service picker, days-until) → Tasks 4,5 ✓
- Lead-time reminder logic + `reminded_at` idempotency → Tasks 2 (logic), 7 (IO) ✓
- Daily Vercel Cron + endpoint protection → Task 8 ✓
- Shared `lib/reminders.mjs` (`isReminderDue`, `daysUntil`, `dueReminders`, `validateSubscriptionInput`) → Task 2 ✓
- Env vars (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `REMINDER_FROM`) → Tasks 7,8,9 ✓
- Remove Pages workflow / Vercel auto-deploy → Task 6 ✓
- Build order Phase A then B → tasks grouped accordingly ✓
- Out-of-scope items (recurring auto-roll, provider cancellation, analytics) → not implemented ✓

**Placeholder scan:** No TBD/TODO. Browser/auth tasks (3,4,5) and the function (7,8) can't
be meaningfully unit-tested without a live Supabase, so they use explicit manual
verification steps via `vercel dev` + the browse skill; the pure logic they depend on is
fully unit-tested in Task 2. `reminders@example.com` is an intentional fallback default
overridden by `REMINDER_FROM`, not a placeholder.

**Type consistency:** Field names (`service_id`, `service_name`, `start_date`, `end_date`,
`reminder_days`, `reminded_at`, `user_id`) are identical across the SQL, `subscriptions.js`,
`reminders.mjs`, and `send-reminders.ts`. Function names (`parseDate`, `daysUntil`,
`isReminderDue`, `dueReminders`, `validateSubscriptionInput`, `initAuth`, `loadCatalog`,
`populateServicePicker`, `listSubscriptions`, `addSubscription`, `deleteSubscription`,
`renderRows`) are consistent between definition and callers. The publishable key and project
URL match the spec.
