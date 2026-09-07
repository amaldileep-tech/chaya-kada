-- 1) First create the admin user in Supabase Authentication > Users.
-- 2) Replace YOUR_ADMIN_EMAIL@example.com below and Run this only in Supabase SQL Editor.
-- Do not put your real admin email/password in the website source.

insert into public.ck_admins (user_id)
select id from auth.users
where lower(email) = lower('YOUR_ADMIN_EMAIL@example.com')
on conflict (user_id) do nothing;

-- Verify:
select u.email, a.created_at
from public.ck_admins a
join auth.users u on u.id = a.user_id;
