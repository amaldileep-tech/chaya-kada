-- Chaya Kada V3.1 — fixes: column reference "room_id" is ambiguous
-- Safe to run on the existing V3 database. It only replaces the join function.

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
  from public.ck_rooms as r
  where r.code_hash = crypt(trim(coalesce(p_code,'')), r.code_hash)
  limit 1;

  if v_room_id is null then
    raise exception 'INVALID_OFFICE_CODE';
  end if;

  update public.ck_memberships as m
     set user_id = v_uid,
         display_name = v_name
   where m.room_id = v_room_id
     and m.device_id = p_device_id;

  if not found then
    insert into public.ck_memberships (user_id, room_id, display_name, device_id)
    values (v_uid, v_room_id, v_name, p_device_id);
  end if;

  return query select v_room_id, v_room_name;
end;
$$;

revoke all on function public.ck_join_room(text,text,text) from public;
grant execute on function public.ck_join_room(text,text,text) to authenticated;
