# Subscription Tracker (Login + Renewal Reminders) — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)

## Summary

Add a logged-in "subscription tracker" to the existing static SaaS pricing site.
Authenticated users record their own subscriptions (service, start date, renewal/end
date), and a scheduled job emails them a few days before each renewal so they can
cancel in time. The public catalog is unchanged.

This introduces a backend, which the current pure-static site does not have. We use
**Vercel** (hosting + serverless functions + cron) paired with **Supabase**
(GitHub OAuth + Postgres + row-level security) and **Resend** (email).

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Hosting / DX | Vercel (auto-deploys the repo; replaces the GitHub Pages workflow) |
| Auth | Supabase GitHub OAuth |
| Database | Supabase Postgres with row-level security |
| Reminder scheduler | Vercel Cron → serverless TypeScript function (daily) |
| Reminder model | Lead-time before `end_date` (e.g. 3 days), one reminder per subscription |
| Email provider | Resend |
| Users | Real multi-user (anyone can sign up; per-user data isolation via RLS) |
| Catalog frontend | Stays vanilla static (no framework rewrite) |

## Supabase project (this project)

- **Project ref:** `ofitleegdvhbwqebtepk`
- **API URL:** `https://ofitleegdvhbwqebtepk.supabase.co`
- **Publishable key (public, browser):** `sb_publishable_D4MoU3UvGChSoQPWPJNDeg_dcq-38ii`
- **Secret key (`sb_secret_…`):** used only by the server-side reminder function; stored
  as a Vercel env var, never committed.

## Architecture

```
Vercel                                          Supabase (managed)
├── index.html  (public catalog, unchanged)
├── tracker.html + js/  (supabase-js, publishable key) ──▶ Auth (GitHub OAuth)
│                                                      └─▶ Postgres: subscriptions + RLS
├── api/send-reminders.ts  (serverless TS) ──────────────▶ Postgres (via secret key)
└── vercel.json: cron daily ──▶ /api/send-reminders ─────▶ Resend (emails)
```

The browser talks directly to Supabase for auth and CRUD using the publishable key;
RLS guarantees a user only ever sees their own rows. The reminder function is the only
server-side component and the only place the Supabase secret key is used.

## Repository structure (added)

```
api/send-reminders.ts            # Vercel serverless function; daily cron target
vercel.json                      # cron schedule + static config
lib/reminders.mjs                # isReminderDue() + date validation; shared by API + UI
lib/reminders.test.mjs           # unit tests (node --test)
tracker.html                     # logged-in tracker page
js/supabase-client.js            # init supabase-js (URL + publishable key)
js/auth.js                       # GitHub OAuth sign in/out + session UI
js/subscriptions.js              # CRUD + render table/form; service picker from data/services.json
supabase/migrations/0001_subscriptions.sql   # table + RLS policies + index
```

The existing `.github/workflows/deploy.yml` (GitHub Pages) is **removed** — Vercel
auto-deploys on push to `main`. `.github/workflows/refresh.yml` (monthly price refresh)
stays; its commits trigger a Vercel redeploy.

## Data model (Postgres)

Table `public.subscriptions`:

| column | type | notes |
|--------|------|-------|
| `id` | uuid pk default `gen_random_uuid()` | |
| `user_id` | uuid not null default `auth.uid()` | FK → `auth.users(id)` on delete cascade |
| `service_id` | text null | catalog id (e.g. `netflix`) when picked from the list |
| `service_name` | text not null | required; free text if not in catalog |
| `start_date` | date not null | when the user subscribed |
| `end_date` | date not null | the renewal/charge date the reminder fires before |
| `reminder_days` | int not null default 3 | days before `end_date` to email; `check (reminder_days between 0 and 90)` |
| `reminded_at` | timestamptz null | set when emailed → prevents duplicate sends |
| `created_at` | timestamptz not null default `now()` | |

Index: `(reminded_at, end_date)` to make the daily "due" query cheap.

**Row-Level Security** (enabled on the table). Four policies, all keyed on
`auth.uid() = user_id`:
- `select`: `using (auth.uid() = user_id)`
- `insert`: `with check (auth.uid() = user_id)`
- `update`: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
- `delete`: `using (auth.uid() = user_id)`

The reminder function uses the **secret key**, which bypasses RLS, so it can read due
rows across all users.

## Auth flow (GitHub OAuth)

1. On `tracker.html`, signed-out users click "Sign in with GitHub"
   (`supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo } })`).
2. They authorize on GitHub → Supabase's `/auth/v1/callback` → back to `redirectTo` (the
   tracker page); supabase-js establishes a session (persisted in `localStorage`). No
   email is sent, so there is no email rate limit.
3. `supabase.auth.onAuthStateChange` drives UI: signed-out view vs. tracker view.
4. Sign-out calls `supabase.auth.signOut()`.

Setup required:
- A **GitHub OAuth App** (Homepage = the Vercel domain; Authorization callback URL =
  `https://<project-ref>.supabase.co/auth/v1/callback`) → Client ID + Secret.
- Supabase → Authentication → **Providers → GitHub**: enable, paste the Client ID + Secret.
- Supabase → Authentication → URL Configuration: **Site URL** + **Redirect URLs** include
  the Vercel domain and `http://localhost:3000` for dev.

## Tracker UI (`tracker.html` + `js/`)

- **Signed out:** a "Sign in with GitHub" button; redirects to GitHub to authorize.
- **Signed in:** a table of the user's subscriptions — service, start date, renewal
  date, "reminds N days before", and computed "days until renewal" (red when within the
  reminder window). An **Add** form with: service picker (a `<datalist>`/select sourced
  from `data/services.json`, which prefills `service_id` + `service_name` and can show
  the catalog price as a hint, e.g. "≈ $19.99/mo"), start date, end date, reminder days.
  Each row has a delete action. (Per-row editing is out of scope for v1 — delete and
  re-add instead.)
- Client-side validation before insert/update (see shared logic). Network/auth errors
  surface as inline messages.

## Reminder job

`api/send-reminders.ts` (Vercel serverless function, Node/TypeScript):

1. Reject the request unless it carries Vercel Cron's `Authorization: Bearer ${CRON_SECRET}`.
2. Using the Supabase secret key, select subscriptions where
   `reminded_at is null` and `today` is within the window
   `[end_date - reminder_days, end_date]` (computed via `isReminderDue`).
3. For each, look up the user's email (`auth.users`) and send a Resend email:
   "Your *{service_name}* renews on {end_date} — cancel by then if you don't want it."
4. On a successful send, set `reminded_at = now()` for that row.
5. Per-row `try/catch`: one failure is logged and skipped, never aborting the batch.
   `reminded_at` guarantees no double-sends across daily runs.

`vercel.json`:

```json
{ "crons": [ { "path": "/api/send-reminders", "schedule": "0 9 * * *" } ] }
```

(Daily at 09:00 UTC — within the Hobby plan's one-run-per-day cron limit.)

## Shared logic (`lib/reminders.mjs`)

Pure, dependency-free, unit-tested functions used by both the function and the UI:

- `isReminderDue({ endDate, reminderDays, today, remindedAt })` → boolean. True when
  `remindedAt` is null and `today` is in `[endDate - reminderDays, endDate]`.
- `daysUntil(endDate, today)` → integer (for the UI's "days until renewal").
- `validateSubscriptionInput({ service_name, start_date, end_date, reminder_days })`
  → array of error strings (non-empty name; valid ISO dates; `end_date >= start_date`;
  `reminder_days` an integer in 0–90). Used by the add/edit form.

## Environment variables (Vercel)

| Var | Used by | Secret? |
|-----|---------|---------|
| `SUPABASE_URL` | API function | no (also hard-coded as the public URL in `js/supabase-client.js`) |
| `SUPABASE_PUBLISHABLE_KEY` | frontend (or hard-coded, it is public) | no |
| `SUPABASE_SECRET_KEY` | API function only | **yes** |
| `RESEND_API_KEY` | API function only | **yes** |
| `CRON_SECRET` | API function (verifies cron caller) | **yes** |

## Testing

- **Unit (node --test):** `lib/reminders.mjs` — `isReminderDue` (boundary cases: exactly
  at window start, at end_date, already reminded, outside window), `daysUntil`, and
  `validateSubscriptionInput` (each failure mode). This is the logic most prone to bugs.
- **Integration (manual / Supabase local `supabase start`):** the GitHub OAuth round trip
  and RLS isolation — verify user A cannot read or modify user B's rows. Honest caveat:
  auth and RLS cannot be meaningfully unit-tested without a real Supabase instance.
- The reminder function is exercised by invoking it locally (`vercel dev`) with the cron
  secret, against test rows, with Resend in a test mode or a verified test recipient.

## Build order

- **Phase A — Auth + CRUD:** Supabase migration, `supabase-client.js`, GitHub OAuth
  sign-in/out, `tracker.html`, subscription create/list/edit/delete with RLS, the shared
  `lib/reminders.mjs` (so the UI can show "days until"). Independently shippable: a user
  can log in and manage subscriptions, just without emails yet.
- **Phase B — Reminders:** `api/send-reminders.ts`, `vercel.json` cron, Resend
  integration, `reminded_at` idempotency. Layered on Phase A.

## Manual prerequisites (user, one-time)

1. **Supabase** (done): project exists; apply `0001_subscriptions.sql` via the SQL
   Editor; set Auth redirect URLs to the Vercel domain + localhost.
2. **Resend**: create account, verify a sender (domain or onboarding address) → get
   `RESEND_API_KEY`.
3. **Vercel**: import the GitHub repo; set the env vars in the table above
   (`SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `CRON_SECRET` are secret).

## Out of scope (v1)

- Per-row editing of a subscription (delete + re-add instead).
- Recurring auto-roll of renewal dates (one reminder per subscription only).
- Editing/cancelling the actual subscription at the provider (we only remind).
- Price-change tracking, spend analytics, shared/household accounts.
- Multi-currency (display only mirrors the catalog's USD).
- Server-side rendering of the catalog (stays client-rendered).
