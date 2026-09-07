-- ============================================================
-- CHAYA KADA V3 SECURE SCHEMA
-- Run once in Supabase SQL Editor BEFORE deploying V3.
--
-- Security model:
--   * Normal visitors sign in with Supabase Anonymous Auth.
--   * Office code is verified SERVER-SIDE against a bcrypt hash.
--   * Successful users receive membership for one room UUID.
--   * RLS allows data only for rooms the authenticated user joined.
--   * Admin delete access requires an allow-listed Supabase Auth user.
--   * The shared office code is NOT stored in frontend source code.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Secure room registry ----------
create table if not exists public.ck_rooms (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  display_name text not null default 'Chaya Kada',
  created_at timestamptz not null default now()
);

create table if not exists public.ck_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.ck_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 28),
  device_id text not null,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id),
  unique (room_id, device_id)
);

create table if not exists public.ck_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  created_by_user_id uuid not null,
  created_by_name text not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  started_at timestamptz not null default now(),
  total_amount numeric(12,2),
  payer_name text,
  closed_at timestamptz
);

create table if not exists public.ck_session_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  session_id uuid not null references public.ck_sessions(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table if not exists public.ck_payments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  session_id uuid not null references public.ck_sessions(id) on delete cascade,
  from_name text not null,
  to_name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.ck_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  sender_user_id uuid not null,
  sender_name text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);


create table if not exists public.ck_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.ck_rooms(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ck_memberships_room_idx on public.ck_memberships(room_id, joined_at);
create index if not exists ck_sessions_room_idx on public.ck_sessions(room_id, started_at desc);
create index if not exists ck_session_members_room_idx on public.ck_session_members(room_id, joined_at);
create index if not exists ck_payments_room_idx on public.ck_payments(room_id, created_at);
create index if not exists ck_messages_room_idx on public.ck_messages(room_id, created_at);
create index if not exists ck_push_room_idx on public.ck_push_subscriptions(room_id, user_id);

-- ---------- Security helper functions ----------
create or replace function public.ck_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ck_admins a
    where a.user_id = auth.uid()
  );
$$;

create or replace function public.ck_has_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ck_memberships m
    where m.user_id = auth.uid()
      and m.room_id = p_room_id
  );
$$;

-- Shared code verification happens only here, server-side.
create or replace function public.ck_join_room(
  p_code text,
  p_name text,
  p_device_id text
)
returns table(room_id uuid, room_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room_id uuid;
  v_room_name text;
  v_uid uuid;
  v_name text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_name := left(trim(coalesce(p_name,'')), 28);
  if char_length(v_name) < 1 then
    raise exception 'INVALID_NAME';
  end if;
  if char_length(trim(coalesce(p_device_id,''))) < 8 then
    raise exception 'INVALID_DEVICE';
  end if;

  select r.id, r.display_name
    into v_room_id, v_room_name
  from public.ck_rooms r
  where r.code_hash = crypt(trim(coalesce(p_code,'')), r.code_hash)
  limit 1;

  if v_room_id is null then
    raise exception 'INVALID_OFFICE_CODE';
  end if;

  -- Rejoining from the same browser/device reclaims the same member slot,
  -- including after an admin login temporarily replaces the anonymous session.
  insert into public.ck_memberships (user_id, room_id, display_name, device_id)
  values (v_uid, v_room_id, v_name, p_device_id)
  on conflict (room_id, device_id)
  do update set
    user_id = excluded.user_id,
    display_name = excluded.display_name;

  return query select v_room_id, v_room_name;
end;
$$;

revoke all on function public.ck_is_admin() from public;
revoke all on function public.ck_has_room(uuid) from public;
revoke all on function public.ck_join_room(text,text,text) from public;
grant execute on function public.ck_is_admin() to authenticated;
grant execute on function public.ck_has_room(uuid) to authenticated;
grant execute on function public.ck_join_room(text,text,text) to authenticated;


create or replace function public.ck_save_push_subscription(
  p_room_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.ck_has_room(p_room_id) then
    raise exception 'ROOM_ACCESS_REQUIRED';
  end if;
  if char_length(coalesce(p_endpoint,'')) < 20 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;

  insert into public.ck_push_subscriptions (user_id, room_id, endpoint, p256dh, auth_key)
  values (auth.uid(), p_room_id, p_endpoint, p_p256dh, p_auth_key)
  on conflict (endpoint)
  do update set
    user_id = excluded.user_id,
    room_id = excluded.room_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    updated_at = now();
end;
$$;

revoke all on function public.ck_save_push_subscription(uuid,text,text,text) from public;
grant execute on function public.ck_save_push_subscription(uuid,text,text,text) to authenticated;

-- ---------- RLS ----------
alter table public.ck_rooms enable row level security;
alter table public.ck_admins enable row level security;
alter table public.ck_memberships enable row level security;
alter table public.ck_sessions enable row level security;
alter table public.ck_session_members enable row level security;
alter table public.ck_payments enable row level security;
alter table public.ck_messages enable row level security;
alter table public.ck_push_subscriptions enable row level security;

-- Keep room hashes and admin allow-list completely out of the browser API.
revoke all on public.ck_rooms from anon, authenticated;
revoke all on public.ck_admins from anon, authenticated;

-- Remove policies if this script is re-run.
drop policy if exists "ck memberships read room" on public.ck_memberships;
drop policy if exists "ck memberships update self" on public.ck_memberships;
drop policy if exists "ck memberships admin delete" on public.ck_memberships;
drop policy if exists "ck sessions read room" on public.ck_sessions;
drop policy if exists "ck sessions insert room" on public.ck_sessions;
drop policy if exists "ck sessions update room" on public.ck_sessions;
drop policy if exists "ck sessions admin delete" on public.ck_sessions;
drop policy if exists "ck session members read room" on public.ck_session_members;
drop policy if exists "ck session members insert self" on public.ck_session_members;
drop policy if exists "ck session members admin delete" on public.ck_session_members;
drop policy if exists "ck payments read room" on public.ck_payments;
drop policy if exists "ck payments insert room" on public.ck_payments;
drop policy if exists "ck payments update room" on public.ck_payments;
drop policy if exists "ck payments admin delete" on public.ck_payments;
drop policy if exists "ck messages read room" on public.ck_messages;
drop policy if exists "ck messages insert room" on public.ck_messages;
drop policy if exists "ck messages delete own or admin" on public.ck_messages;
drop policy if exists "ck push read own or admin" on public.ck_push_subscriptions;
drop policy if exists "ck push delete own or admin" on public.ck_push_subscriptions;

create policy "ck memberships read room"
on public.ck_memberships for select to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck memberships update self"
on public.ck_memberships for update to authenticated
using (user_id = auth.uid() and public.ck_has_room(room_id))
with check (user_id = auth.uid() and public.ck_has_room(room_id));

create policy "ck memberships admin delete"
on public.ck_memberships for delete to authenticated
using (public.ck_is_admin());

create policy "ck sessions read room"
on public.ck_sessions for select to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck sessions insert room"
on public.ck_sessions for insert to authenticated
with check (public.ck_has_room(room_id) and created_by_user_id = auth.uid());

create policy "ck sessions update room"
on public.ck_sessions for update to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin())
with check (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck sessions admin delete"
on public.ck_sessions for delete to authenticated
using (public.ck_is_admin());

create policy "ck session members read room"
on public.ck_session_members for select to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck session members insert self"
on public.ck_session_members for insert to authenticated
with check (public.ck_has_room(room_id) and user_id = auth.uid());

create policy "ck session members admin delete"
on public.ck_session_members for delete to authenticated
using (public.ck_is_admin());

create policy "ck payments read room"
on public.ck_payments for select to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck payments insert room"
on public.ck_payments for insert to authenticated
with check (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck payments update room"
on public.ck_payments for update to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin())
with check (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck payments admin delete"
on public.ck_payments for delete to authenticated
using (public.ck_is_admin());

create policy "ck messages read room"
on public.ck_messages for select to authenticated
using (public.ck_has_room(room_id) or public.ck_is_admin());

create policy "ck messages insert room"
on public.ck_messages for insert to authenticated
with check (
  public.ck_has_room(room_id)
  and sender_user_id = auth.uid()
  and char_length(trim(body)) between 1 and 500
);

create policy "ck messages delete own or admin"
on public.ck_messages for delete to authenticated
using (sender_user_id = auth.uid() or public.ck_is_admin());


create policy "ck push read own or admin"
on public.ck_push_subscriptions for select to authenticated
using (user_id = auth.uid() or public.ck_is_admin());

create policy "ck push delete own or admin"
on public.ck_push_subscriptions for delete to authenticated
using (user_id = auth.uid() or public.ck_is_admin());

-- Table privileges: unsigned anon role gets nothing. Signed-in anonymous users use authenticated role.
revoke all on public.ck_memberships, public.ck_sessions, public.ck_session_members, public.ck_payments, public.ck_messages, public.ck_push_subscriptions from anon;
revoke all on public.ck_memberships, public.ck_sessions, public.ck_session_members, public.ck_payments, public.ck_messages, public.ck_push_subscriptions from authenticated;

grant select, update, delete on public.ck_memberships to authenticated;
grant select, insert, update, delete on public.ck_sessions to authenticated;
grant select, insert, delete on public.ck_session_members to authenticated;
grant select, insert, update, delete on public.ck_payments to authenticated;
grant select, insert, delete on public.ck_messages to authenticated;
grant select, delete on public.ck_push_subscriptions to authenticated;

-- ---------- Realtime ----------
DO $$ BEGIN
  alter publication supabase_realtime add table public.ck_memberships;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.ck_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.ck_session_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.ck_payments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  alter publication supabase_realtime add table public.ck_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- Lock down legacy V2 tables if they exist ----------
-- V3 does not use these tables. This prevents the old public anon policies from remaining an exposure.
DO $$ BEGIN
  if to_regclass('public.chaya_users') is not null then
    execute 'revoke all on public.chaya_users from anon, authenticated';
  end if;
  if to_regclass('public.tea_sessions') is not null then
    execute 'revoke all on public.tea_sessions from anon, authenticated';
  end if;
  if to_regclass('public.session_members') is not null then
    execute 'revoke all on public.session_members from anon, authenticated';
  end if;
  if to_regclass('public.payments') is not null then
    execute 'revoke all on public.payments from anon, authenticated';
  end if;
END $$;

-- Done. Next:
-- 1) Enable Anonymous Sign-Ins in Supabase Authentication.
-- 2) Run PRIVATE-ROOM-SETUP-TEMPLATE.sql manually with your actual office code.
-- 3) Create an Auth admin user and run ADMIN-SETUP-TEMPLATE.sql with that email.
