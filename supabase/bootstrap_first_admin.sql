-- Run this only once after creating the first user in Supabase Authentication.
-- Replace the email and name before running.

update public.profiles
set
  full_name = 'Admin User',
  initials = public.initials_from_name('Admin User'),
  role = 'admin',
  is_active = true
where email = 'admin@example.com';

update public.app_settings
set default_approver_user_id = (
  select id from public.profiles where email = 'admin@example.com' limit 1
)
where id = true;
