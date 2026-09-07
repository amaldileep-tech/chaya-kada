-- CHAYA KADA V2 - shared realtime rooms by office code
-- Run this once in Supabase > SQL Editor.
-- Safe for a new project and also upgrades the V1 tables.

create extension if not exists pgcrypto;

create table if not exists public.chaya_users (
  id uuid primary key default gen_random_uuid(),
  office_code text not null default 'CHAYA2026',
  name text not null check (char_length(name) between 1 and 28),
  device_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tea_sessions (
  id uuid primary key default gen_random_uuid(),
  office_code text not null default 'CHAYA2026',
  created_by text not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  started_at timestamptz not null default now(),
  total_amount numeric(12,2),
  payer_name text,
  closed_at timestamptz
);

create table if not exists public.session_members (
  id uuid primary key default gen_random_uuid(),
  office_code text not null default 'CHAYA2026',
  session_id uuid not null references public.tea_sessions(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  unique(session_id, name)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  office_code text not null default 'CHAYA2026',
  session_id uuid not null references public.tea_sessions(id) on delete cascade,
  from_name text not null,
  to_name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Upgrade V1 tables if they already exist.
alter table public.chaya_users add column if not exists office_code text;
alter table public.tea_sessions add column if not exists office_code text;
alter table public.session_members add column if not exists office_code text;
alter table public.payments add column if not exists office_code text;

update public.chaya_users set office_code='CHAYA2026' where office_code is null;
update public.tea_sessions set office_code='CHAYA2026' where office_code is null;
update public.session_members set office_code='CHAYA2026' where office_code is null;
update public.payments set office_code='CHAYA2026' where office_code is null;

alter table public.chaya_users alter column office_code set default 'CHAYA2026';
alter table public.tea_sessions alter column office_code set default 'CHAYA2026';
alter table public.session_members alter column office_code set default 'CHAYA2026';
alter table public.payments alter column office_code set default 'CHAYA2026';

alter table public.chaya_users alter column office_code set not null;
alter table public.tea_sessions alter column office_code set not null;
alter table public.session_members alter column office_code set not null;
alter table public.payments alter column office_code set not null;

-- V1 had device_id globally unique. In V2 the same device id may exist in separate office rooms.
alter table public.chaya_users drop constraint if exists chaya_users_device_id_key;
create unique index if not exists chaya_users_room_device_uidx on public.chaya_users(office_code, device_id);
create index if not exists tea_sessions_room_idx on public.tea_sessions(office_code, started_at desc);
create index if not exists session_members_room_idx on public.session_members(office_code, joined_at);
create index if not exists payments_room_idx on public.payments(office_code, created_at);

-- Public anon access for this small trusted office site.
-- The office code is a room selector/friendly gate, not strong authentication.
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

-- Realtime for all shared data tables.
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
