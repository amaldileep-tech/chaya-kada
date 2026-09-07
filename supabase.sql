-- CHAYA KADA - Supabase schema
-- Run this once in: Supabase > SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.chaya_users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 28),
  device_id text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tea_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by text not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  started_at timestamptz not null default now(),
  total_amount numeric(12,2),
  payer_name text,
  closed_at timestamptz
);

create table if not exists public.session_members (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tea_sessions(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  unique(session_id, name)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tea_sessions(id) on delete cascade,
  from_name text not null,
  to_name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Simple office-group setup: public anon access.
-- The shared OFFICE_CODE in the frontend is only a convenience gate, not strong security.
alter table public.chaya_users enable row level security;
alter table public.tea_sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.payments enable row level security;

DO $$ BEGIN
  create policy "office users all" on public.chaya_users for all to anon using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "office sessions all" on public.tea_sessions for all to anon using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "office members all" on public.session_members for all to anon using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  create policy "office payments all" on public.payments for all to anon using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enable realtime (safe to ignore duplicate-membership errors if re-running manually).
DO $$ BEGIN
  alter publication supabase_realtime add table public.chaya_users;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.tea_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.session_members;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.payments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
