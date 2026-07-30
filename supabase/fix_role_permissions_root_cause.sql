alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = lower(trim(role))
where role is not null
  and role <> lower(trim(role));

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('viewer', 'user', 'checker', 'admin'));

create or replace function public.normalize_profile_before_write()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(coalesce(new.email, '')));
  new.role := lower(trim(coalesce(new.role, 'viewer')));

  if new.role not in ('viewer', 'user', 'checker', 'admin') then
    raise exception 'Invalid profile role: %', new.role;
  end if;

  if nullif(trim(coalesce(new.full_name, '')), '') is not null then
    new.initials := coalesce(nullif(trim(new.initials), ''), public.initials_from_name(new.full_name));
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
begin
  profile_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), 'User');

  insert into public.profiles (id, email, full_name, initials, role, is_active)
  values (
    new.id,
    new.email,
    profile_name,
    public.initials_from_name(profile_name),
    'viewer',
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    initials = excluded.initials,
    is_active = true;

  return new;
end;
$$;

drop trigger if exists normalize_profiles_before_write on public.profiles;
create trigger normalize_profiles_before_write
before insert or update on public.profiles
for each row execute function public.normalize_profile_before_write();

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.profiles
  where id = auth.uid()
     or lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  order by
    case when id = auth.uid() then 0 else 1 end,
    is_active desc,
    updated_at desc nulls last,
    created_at desc nulls last
  limit 1
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(role)
  from public.profiles
  where (id = auth.uid()
     or lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
    and is_active = true
  order by
    case when id = auth.uid() then 0 else 1 end,
    updated_at desc nulls last,
    created_at desc nulls last
  limit 1
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where (id = auth.uid()
       or lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
      and is_active = true
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin'
$$;

create or replace function public.check_ti_record(p_ti_no text)
returns public.ct_ti_records
language plpgsql
security definer
set search_path = public
as $$
declare
  checker public.profiles;
  approver public.profiles;
  updated_record public.ct_ti_records;
begin
  select *
  into checker
  from public.current_profile();

  if checker.id is null or checker.is_active is not true or lower(checker.role) not in ('checker', 'admin') then
    raise exception 'Checker or admin role required';
  end if;

  select p.*
  into approver
  from public.app_settings s
  join public.profiles p on p.id = s.default_approver_user_id
  where s.id = true
    and p.is_active = true
    and lower(p.role) = 'admin';

  if approver.id is null then
    raise exception 'Default admin approver is not configured';
  end if;

  update public.ct_ti_records
  set approval_status = 'checked',
      checked_by = checker.initials,
      checked_by_user_id = checker.id,
      checked_at = now(),
      approved_by = approver.initials,
      approved_by_user_id = approver.id,
      approved_at = now(),
      rejection_items = '[]'::jsonb
  where ti_no = p_ti_no
    and approval_status = 'pending_check'
  returning *
  into updated_record;

  if updated_record.id is null then
    raise exception 'Pending TI record not found: %', p_ti_no;
  end if;

  return updated_record;
end;
$$;

drop function if exists public.reject_ti_record(text);

create or replace function public.reject_ti_record(p_ti_no text, p_rejection_items jsonb default '[]'::jsonb)
returns public.ct_ti_records
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer public.profiles;
  updated_record public.ct_ti_records;
begin
  select *
  into reviewer
  from public.current_profile();

  if reviewer.id is null or reviewer.is_active is not true or lower(reviewer.role) not in ('checker', 'admin') then
    raise exception 'Checker or admin role required';
  end if;

  update public.ct_ti_records
  set approval_status = 'rejected',
      checked_by = null,
      checked_by_user_id = null,
      checked_at = null,
      approved_by = null,
      approved_by_user_id = null,
      approved_at = null,
      rejection_items = coalesce(p_rejection_items, '[]'::jsonb)
  where ti_no = p_ti_no
    and approval_status = 'pending_check'
  returning *
  into updated_record;

  if updated_record.id is null then
    raise exception 'Pending TI record not found: %', p_ti_no;
  end if;

  return updated_record;
end;
$$;

grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.check_ti_record(text) to authenticated;
grant execute on function public.reject_ti_record(text, jsonb) to authenticated;
