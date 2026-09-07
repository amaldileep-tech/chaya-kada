-- PRIVATE SETUP TEMPLATE
-- DO NOT put your real office code in GitHub.
-- Copy this into Supabase SQL Editor, replace YOUR_OFFICE_CODE locally, Run, then discard the edited text.

insert into public.ck_rooms (code_hash, display_name)
values (
  crypt('YOUR_OFFICE_CODE', gen_salt('bf')),
  'Office Chaya Kada'
)
returning id, display_name, created_at;
