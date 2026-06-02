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
