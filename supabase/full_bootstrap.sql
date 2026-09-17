-- =============================================================================
-- CT-TI  —  FULL SINGLE-FILE BOOTSTRAP
-- =============================================================================
-- Paste and run this ENTIRE file once in the Supabase SQL Editor of a NEW,
-- EMPTY project. It creates every table, function, policy and trigger the app
-- needs, in dependency order. It is idempotent (safe to re-run): every object
-- uses "create ... if not exists" or "create or replace", and the consolidating
-- migrations at the bottom always win (they are the final definition).
--
-- It does NOT insert production data. To seed the master item list from the old
-- project, run supabase/import_data.sql afterwards (optional).
--
-- After running this file:
--   1. Create your first user in  Authentication > Users  (or via the app login).
--   2. Edit and run supabase/bootstrap_first_admin.sql to make that user admin.
-- =============================================================================



-- ############################################################################
-- ###  SOURCE: schema.sql
-- ############################################################################

-- CT Technical Instruction Supabase schema
-- Run this file in the Supabase SQL Editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.ct_items (
  id uuid primary key default gen_random_uuid(),
  item_no text not null unique,
  ti_format text not null default 'standard' check (ti_format in ('standard', 'non_standard')),
  ct_type text,
  cust_part_code text,
  ratio text,
  rated_voltage text,
  stc text,
  insulation_level text,
  frequency text,
  ref_std text,
  core1 jsonb not null default '{}'::jsonb,
  core2 jsonb not null default '{}'::jsonb,
  core3 jsonb not null default '{}'::jsonb,
  ct_final_dim text,
  ga_drg text,
  ins_class text,
  ref_ti text,
  pri_turns text,
  pri_copper text,
  former text,
  pri_length text,
  pri_weight text,
  sec_terminal text,
  total_weight text,
  default_customer text,
  drawing_url text,
  drawing_file_name text,
  drawing_content_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ct_items
  add column if not exists drawing_url text,
  add column if not exists drawing_file_name text,
  add column if not exists drawing_content_type text;

create table if not exists public.ct_ti_records (
  id uuid primary key default gen_random_uuid(),
  ti_no text not null unique,
  ti_date date,
  item_no text references public.ct_items(item_no) on update cascade on delete set null,
  wo_number text,
  customer_name text,
  cus_order_no text,
  cus_order_date date,
  quantity text,
  ct_type text,
  cust_part_code text,
  po_item_no text,
  serial_number text,
  ratio text,
  rated_voltage text,
  stc text,
  insulation_level text,
  frequency text,
  ref_std text,
  core1 jsonb not null default '{}'::jsonb,
  core2 jsonb not null default '{}'::jsonb,
  core3 jsonb not null default '{}'::jsonb,
  ct_final_dim text,
  ga_drg text,
  ins_class text,
  ref_ti text,
  pri_turns text,
  pri_copper text,
  former text,
  pri_length text,
  pri_weight text,
  sec_terminal text,
  total_weight text,
  created_by text,
  checked_by text,
  approved_by text,
  remarks text,
  rev_no text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ct_ti_counter (
  id boolean primary key default true,
  current_value integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint ct_ti_counter_singleton check (id)
);

insert into public.ct_ti_counter (id, current_value)
values (true, 0)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  initials text not null,
  role text not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id boolean primary key default true,
  default_approver_user_id uuid references public.profiles(id) on update cascade on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.ct_ti_records
  add column if not exists approval_status text not null default 'pending_check',
  add column if not exists created_by_user_id uuid references public.profiles(id) on update cascade on delete set null,
  add column if not exists checked_by_user_id uuid references public.profiles(id) on update cascade on delete set null,
  add column if not exists approved_by_user_id uuid references public.profiles(id) on update cascade on delete set null,
  add column if not exists checked_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_items jsonb not null default '[]'::jsonb;

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

drop trigger if exists normalize_profiles_before_write on public.profiles;
create trigger normalize_profiles_before_write
before insert or update on public.profiles
for each row execute function public.normalize_profile_before_write();

alter table public.ct_ti_records
  drop constraint if exists ct_ti_records_approval_status_check;

alter table public.ct_ti_records
  add constraint ct_ti_records_approval_status_check
  check (approval_status in ('pending_check', 'checked', 'rejected'));

update public.ct_ti_records
set approval_status = case
  when approval_status = 'rejected' then 'rejected'
  when coalesce(nullif(trim(checked_by), ''), nullif(trim(approved_by), '')) is not null then 'checked'
  else 'pending_check'
end,
checked_at = case
  when coalesce(nullif(trim(checked_by), ''), nullif(trim(approved_by), '')) is not null then coalesce(checked_at, updated_at, created_at, now())
  else checked_at
end,
approved_at = case
  when coalesce(nullif(trim(checked_by), ''), nullif(trim(approved_by), '')) is not null then coalesce(approved_at, updated_at, created_at, now())
  else approved_at
end
where approval_status is null
   or approval_status not in ('pending_check', 'checked', 'rejected')
   or (
      approval_status = 'pending_check'
      and coalesce(nullif(trim(checked_by), ''), nullif(trim(approved_by), '')) is not null
   );

create index if not exists ct_ti_records_item_no_idx on public.ct_ti_records (item_no);
create index if not exists ct_ti_records_customer_name_idx on public.ct_ti_records (customer_name);
create index if not exists ct_ti_records_wo_number_idx on public.ct_ti_records (wo_number);
create index if not exists ct_ti_records_ct_type_idx on public.ct_ti_records (ct_type);
create index if not exists ct_ti_records_approval_status_idx on public.ct_ti_records (approval_status);
create index if not exists ct_items_ct_type_idx on public.ct_items (ct_type);
create index if not exists ct_items_ti_format_idx on public.ct_items (ti_format);
create index if not exists profiles_role_idx on public.profiles (role);

create or replace function public.initials_from_name(full_name text)
returns text
language plpgsql
immutable
as $$
declare
  part text;
  result text := '';
begin
  for part in
    select value from regexp_split_to_table(coalesce(trim(full_name), ''), '\s+') as value
  loop
    if part <> '' then
      result := result || upper(left(part, 1)) || '.';
    end if;
  end loop;

  return coalesce(nullif(result, ''), 'U.');
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_ct_items_updated_at on public.ct_items;
create trigger touch_ct_items_updated_at
before update on public.ct_items
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ct_ti_records_updated_at on public.ct_ti_records;
create trigger touch_ct_ti_records_updated_at
before update on public.ct_ti_records
for each row execute function public.touch_updated_at();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_app_settings_updated_at on public.app_settings;
create trigger touch_app_settings_updated_at
before update on public.app_settings
for each row execute function public.touch_updated_at();

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
  set email = excluded.email,
      full_name = excluded.full_name,
      initials = excluded.initials;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.format_ti_no(seq integer, at_date date default current_date)
returns text
language plpgsql
stable
as $$
declare
  yy integer;
  fy_start integer;
  fy_end integer;
begin
  yy := extract(year from at_date)::integer % 100;
  if extract(month from at_date)::integer >= 4 then
    fy_start := yy;
  else
    fy_start := yy - 1;
  end if;
  fy_end := fy_start + 1;
  return 'LTCT-' || lpad(fy_start::text, 2, '0') || '-' || lpad(fy_end::text, 2, '0') || '-' || lpad(seq::text, 4, '0');
end;
$$;

create or replace function public.sync_ti_counter_from_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  max_suffix integer;
begin
  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into max_suffix
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  update public.ct_ti_counter
  set current_value = max_suffix,
      updated_at = now()
  where id = true;

  return max_suffix;
end;
$$;

create or replace function public.preview_ti_number()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  counter_value integer;
  record_max integer;
begin
  if not public.is_active_user() then
    raise exception 'Active login required';
  end if;

  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  return public.format_ti_no(greatest(coalesce(counter_value, 0), record_max) + 1);
end;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  record_max integer;
  next_value integer;
  next_ti_no text;
  preferred_suffix integer;
begin
  if public.current_user_role() <> 'user' then
    raise exception 'Create permission required';
  end if;

  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  if preferred_ti_no is not null and preferred_ti_no <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), record_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), record_max) + 1;
  next_ti_no := public.format_ti_no(next_value);

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return next_ti_no;
end;
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

create or replace function public.reopen_ti_record(p_ti_no text)
returns public.ct_ti_records
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_record public.ct_ti_records;
begin
  if not public.is_admin() then
    raise exception 'Admin role required';
  end if;

  update public.ct_ti_records
  set approval_status = 'pending_check',
      checked_by = null,
      checked_by_user_id = null,
      checked_at = null,
      approved_by = null,
      approved_by_user_id = null,
      approved_at = null,
      rejection_items = '[]'::jsonb
  where ti_no = p_ti_no
  returning *
  into updated_record;

  if updated_record.id is null then
    raise exception 'TI record not found: %', p_ti_no;
  end if;

  return updated_record;
end;
$$;

create or replace function public.update_ti_record(p_ti_no text, p_data jsonb)
returns public.ct_ti_records
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_record public.ct_ti_records;
  payload public.ct_ti_records;
  next_ti_no text;
  updated_record public.ct_ti_records;
begin
  if public.current_user_role() <> 'user' then
    raise exception 'User role required';
  end if;

  select *
  into existing_record
  from public.ct_ti_records
  where ti_no = p_ti_no
  for update;

  if existing_record.id is null then
    raise exception 'TI record not found: %', p_ti_no;
  end if;

  if existing_record.approval_status not in ('pending_check', 'rejected') then
    raise exception 'Only pending or rejected TI records can be edited';
  end if;

  payload := jsonb_populate_record(null::public.ct_ti_records, coalesce(p_data, '{}'::jsonb));
  next_ti_no := coalesce(nullif(payload.ti_no, ''), p_ti_no);

  if next_ti_no <> p_ti_no and exists (
    select 1 from public.ct_ti_records where ti_no = next_ti_no
  ) then
    raise exception 'TI number already exists: %', next_ti_no;
  end if;

  update public.ct_ti_records
  set ti_no = next_ti_no,
      ti_date = payload.ti_date,
      item_no = payload.item_no,
      wo_number = payload.wo_number,
      customer_name = payload.customer_name,
      cus_order_no = payload.cus_order_no,
      cus_order_date = payload.cus_order_date,
      quantity = payload.quantity,
      ct_type = payload.ct_type,
      cust_part_code = payload.cust_part_code,
      po_item_no = payload.po_item_no,
      serial_number = payload.serial_number,
      ratio = payload.ratio,
      rated_voltage = payload.rated_voltage,
      stc = payload.stc,
      insulation_level = payload.insulation_level,
      frequency = payload.frequency,
      ref_std = payload.ref_std,
      core1 = coalesce(payload.core1, '{}'::jsonb),
      core2 = coalesce(payload.core2, '{}'::jsonb),
      core3 = coalesce(payload.core3, '{}'::jsonb),
      ct_final_dim = payload.ct_final_dim,
      ga_drg = payload.ga_drg,
      ins_class = payload.ins_class,
      ref_ti = payload.ref_ti,
      pri_turns = payload.pri_turns,
      pri_copper = payload.pri_copper,
      former = payload.former,
      pri_length = payload.pri_length,
      pri_weight = payload.pri_weight,
      sec_terminal = payload.sec_terminal,
      total_weight = payload.total_weight,
      created_by = coalesce(nullif(payload.created_by, ''), existing_record.created_by),
      created_by_user_id = coalesce(payload.created_by_user_id, existing_record.created_by_user_id),
      checked_by = null,
      checked_by_user_id = null,
      checked_at = null,
      approved_by = null,
      approved_by_user_id = null,
      approved_at = null,
      approval_status = 'pending_check',
      rejection_items = '[]'::jsonb,
      remarks = payload.remarks,
      rev_no = payload.rev_no,
      note = payload.note
  where id = existing_record.id
  returning *
  into updated_record;

  if next_ti_no <> p_ti_no then
    perform public.sync_ti_counter_from_records();
  end if;

  return updated_record;
end;
$$;

alter table public.ct_items enable row level security;
alter table public.ct_ti_records enable row level security;
alter table public.ct_ti_counter enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "Allow app read items" on public.ct_items;
drop policy if exists "Allow app write items" on public.ct_items;
drop policy if exists "Allow active users read items" on public.ct_items;
drop policy if exists "Allow creators write items" on public.ct_items;
drop policy if exists "Allow app read ti records" on public.ct_ti_records;
drop policy if exists "Allow app write ti records" on public.ct_ti_records;
drop policy if exists "Allow role based read ti records" on public.ct_ti_records;
drop policy if exists "Allow creators insert pending ti records" on public.ct_ti_records;
drop policy if exists "Allow edit pending ti records" on public.ct_ti_records;
drop policy if exists "Allow admin delete ti records" on public.ct_ti_records;
drop policy if exists "Allow app read ti counter" on public.ct_ti_counter;
drop policy if exists "Allow active users read ti counter" on public.ct_ti_counter;
drop policy if exists "Allow app read profiles" on public.profiles;
drop policy if exists "Allow active users read profiles" on public.profiles;
drop policy if exists "Allow admin write profiles" on public.profiles;
drop policy if exists "Allow app read settings" on public.app_settings;
drop policy if exists "Allow active users read settings" on public.app_settings;
drop policy if exists "Allow admin write settings" on public.app_settings;

create policy "Allow active users read items"
on public.ct_items for select
to authenticated
using (public.is_active_user());

create policy "Allow creators write items"
on public.ct_items for all
to authenticated
using (public.current_user_role() = 'user')
with check (public.current_user_role() = 'user');

create policy "Allow role based read ti records"
on public.ct_ti_records for select
to authenticated
using (public.is_active_user());

create policy "Allow creators insert pending ti records"
on public.ct_ti_records for insert
to authenticated
with check (
  public.current_user_role() = 'user'
  and approval_status = 'pending_check'
);

create policy "Allow edit pending ti records"
on public.ct_ti_records for update
to authenticated
using (
  public.current_user_role() = 'user'
  and approval_status in ('pending_check', 'rejected')
)
with check (
  public.current_user_role() = 'user'
  and approval_status in ('pending_check', 'rejected')
);

create policy "Allow admin delete ti records"
on public.ct_ti_records for delete
to authenticated
using (public.is_admin());

create policy "Allow active users read ti counter"
on public.ct_ti_counter for select
to authenticated
using (public.is_active_user());

create policy "Allow active users read profiles"
on public.profiles for select
to authenticated
using (public.is_active_user());

create policy "Allow admin write profiles"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Allow active users read settings"
on public.app_settings for select
to authenticated
using (public.is_active_user());

create policy "Allow admin write settings"
on public.app_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.ct_items from anon;
revoke all on public.ct_ti_records from anon;
revoke all on public.ct_ti_counter from anon;
revoke all on public.profiles from anon;
revoke all on public.app_settings from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.ct_items to authenticated;
grant select, insert, update, delete on public.ct_ti_records to authenticated;
grant select on public.ct_ti_counter to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant execute on function public.initials_from_name(text) to authenticated;
grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.preview_ti_number() to authenticated;
grant execute on function public.allocate_ti_number(text) to authenticated;
grant execute on function public.sync_ti_counter_from_records() to authenticated;
grant execute on function public.check_ti_record(text) to authenticated;
grant execute on function public.reject_ti_record(text, jsonb) to authenticated;
grant execute on function public.reopen_ti_record(text) to authenticated;
grant execute on function public.update_ti_record(text, jsonb) to authenticated;


-- ############################################################################
-- ###  SOURCE: Work_order_schema.sql
-- ############################################################################

-- Work Order module schema.
-- Run this after the main CT TI schema has been applied.

create table if not exists public.ct_work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order text not null,
  customer text,
  po_no text,
  po_date date,
  po_line_no text,
  item_code text,
  our_item_code text,
  specification text,
  qty text,
  sr_no text,
  ti_no text,
  traceability_sr_no text,
  created_by text,
  created_by_user_id uuid references public.profiles(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ct_work_orders_work_order_idx on public.ct_work_orders (work_order);
create index if not exists ct_work_orders_customer_idx on public.ct_work_orders (customer);
create index if not exists ct_work_orders_po_no_idx on public.ct_work_orders (po_no);
create index if not exists ct_work_orders_item_code_idx on public.ct_work_orders (item_code);
create index if not exists ct_work_orders_ti_no_idx on public.ct_work_orders (ti_no);

drop trigger if exists touch_ct_work_orders_updated_at on public.ct_work_orders;
create trigger touch_ct_work_orders_updated_at
before update on public.ct_work_orders
for each row execute function public.touch_updated_at();

alter table public.ct_work_orders enable row level security;

drop policy if exists "Allow active users read work orders" on public.ct_work_orders;
drop policy if exists "Allow non-viewer users write work orders" on public.ct_work_orders;
drop policy if exists "Allow creators write work orders" on public.ct_work_orders;

create policy "Allow active users read work orders"
on public.ct_work_orders for select
to authenticated
using (public.is_active_user());

create policy "Allow creators write work orders"
on public.ct_work_orders for all
to authenticated
using (public.current_user_role() = 'user')
with check (public.current_user_role() = 'user');

revoke all on public.ct_work_orders from anon;
grant select, insert, update, delete on public.ct_work_orders to authenticated;

alter table public.ct_items
add column if not exists ti_format text;

update public.ct_items
set ti_format = 'standard'
where ti_format is null
   or ti_format not in ('standard', 'non_standard');

alter table public.ct_items
alter column ti_format set default 'standard';

alter table public.ct_items
alter column ti_format set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ct_items_ti_format_check'
      and conrelid = 'public.ct_items'::regclass
  ) then
    alter table public.ct_items
    add constraint ct_items_ti_format_check
    check (ti_format in ('standard', 'non_standard'));
  end if;
end;
$$;

create index if not exists ct_items_ti_format_idx on public.ct_items (ti_format);

create or replace function public.sync_ti_counter_from_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ti_record_max integer;
  work_order_max integer;
  max_suffix integer;
begin
  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  max_suffix := greatest(ti_record_max, work_order_max);

  update public.ct_ti_counter
  set current_value = max_suffix,
      updated_at = now()
  where id = true;

  return max_suffix;
end;
$$;

create or replace function public.preview_ti_number()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  return public.format_ti_no(greatest(coalesce(counter_value, 0), ti_record_max, work_order_max) + 1);
end;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

create or replace function public.preview_work_order_ti_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.preview_ti_number();
$$;

create or replace function public.allocate_work_order_ti_number(
  preferred_ti_no text default null,
  current_work_order_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if exists (
      select 1
      from public.ct_work_orders
      where ti_no = preferred_ti_no
        and (current_work_order_id is null or id <> current_work_order_id)
    ) then
      raise exception 'TI number already exists in work orders: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

grant execute on function public.preview_ti_number() to authenticated;
grant execute on function public.allocate_ti_number(text) to authenticated;
grant execute on function public.sync_ti_counter_from_records() to authenticated;
grant execute on function public.preview_work_order_ti_number() to authenticated;
grant execute on function public.allocate_work_order_ti_number(text, uuid) to authenticated;

select public.sync_ti_counter_from_records();
select public.preview_work_order_ti_number();


-- ############################################################################
-- ###  SOURCE: item_drawing_links_patch.sql
-- ############################################################################

-- Add Cloudflare drawing link fields to existing CT item master tables.
-- Run this once in the Supabase SQL Editor for an already-created project.

alter table public.ct_items
  add column if not exists drawing_url text,
  add column if not exists drawing_file_name text,
  add column if not exists drawing_content_type text;


-- ############################################################################
-- ###  SOURCE: production_ready_ti_work_order_patch.sql
-- ############################################################################

-- Production patch for TI + Work Order sync.
-- Run this on an existing database after the base schema and Work Order schema are already present.

drop policy if exists "Allow non-viewer users write work orders" on public.ct_work_orders;
drop policy if exists "Allow creators write work orders" on public.ct_work_orders;

create policy "Allow creators write work orders"
on public.ct_work_orders for all
to authenticated
using (public.current_user_role() = 'user')
with check (public.current_user_role() = 'user');

alter table public.ct_items
add column if not exists ti_format text;

update public.ct_items
set ti_format = 'standard'
where ti_format is null
   or ti_format not in ('standard', 'non_standard');

alter table public.ct_items
alter column ti_format set default 'standard';

alter table public.ct_items
alter column ti_format set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ct_items_ti_format_check'
      and conrelid = 'public.ct_items'::regclass
  ) then
    alter table public.ct_items
    add constraint ct_items_ti_format_check
    check (ti_format in ('standard', 'non_standard'));
  end if;
end;
$$;

create index if not exists ct_items_ti_format_idx on public.ct_items (ti_format);

create or replace function public.sync_ti_counter_from_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ti_record_max integer;
  work_order_max integer;
  max_suffix integer;
begin
  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  max_suffix := greatest(ti_record_max, work_order_max);

  update public.ct_ti_counter
  set current_value = max_suffix,
      updated_at = now()
  where id = true;

  return max_suffix;
end;
$$;

create or replace function public.preview_ti_number()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  return public.format_ti_no(greatest(coalesce(counter_value, 0), ti_record_max, work_order_max) + 1);
end;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

create or replace function public.preview_work_order_ti_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.preview_ti_number();
$$;

create or replace function public.allocate_work_order_ti_number(
  preferred_ti_no text default null,
  current_work_order_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if exists (
      select 1
      from public.ct_work_orders
      where ti_no = preferred_ti_no
        and (current_work_order_id is null or id <> current_work_order_id)
    ) then
      raise exception 'TI number already exists in work orders: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

grant execute on function public.preview_ti_number() to authenticated;
grant execute on function public.allocate_ti_number(text) to authenticated;
grant execute on function public.sync_ti_counter_from_records() to authenticated;
grant execute on function public.preview_work_order_ti_number() to authenticated;
grant execute on function public.allocate_work_order_ti_number(text, uuid) to authenticated;

select public.sync_ti_counter_from_records();
select public.preview_work_order_ti_number();


-- ############################################################################
-- ###  SOURCE: fix_role_permissions_root_cause.sql
-- ############################################################################

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


-- ############################################################################
-- ###  SOURCE: fix_ti_counter_max_plus_one.sql
-- ############################################################################

-- Counter fix upgraded for TI + Work Order sync.
-- Safe to rerun on an existing database.

create or replace function public.sync_ti_counter_from_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ti_record_max integer;
  work_order_max integer;
  max_suffix integer;
begin
  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  max_suffix := greatest(ti_record_max, work_order_max);

  update public.ct_ti_counter
  set current_value = max_suffix,
      updated_at = now()
  where id = true;

  return max_suffix;
end;
$$;

create or replace function public.preview_ti_number()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  return public.format_ti_no(greatest(coalesce(counter_value, 0), ti_record_max, work_order_max) + 1);
end;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

create or replace function public.preview_work_order_ti_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.preview_ti_number();
$$;

create or replace function public.allocate_work_order_ti_number(
  preferred_ti_no text default null,
  current_work_order_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  select current_value
  into counter_value
  from public.ct_ti_counter
  where id = true
  for update;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like left(public.format_ti_no(0), 11) || '%'
    and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if exists (
      select 1
      from public.ct_work_orders
      where ti_no = preferred_ti_no
        and (current_work_order_id is null or id <> current_work_order_id)
    ) then
      raise exception 'TI number already exists in work orders: %', preferred_ti_no;
    end if;

    if preferred_ti_no like left(public.format_ti_no(0), 11) || '%'
       and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value,
      updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

grant execute on function public.preview_ti_number() to authenticated;
grant execute on function public.allocate_ti_number(text) to authenticated;
grant execute on function public.sync_ti_counter_from_records() to authenticated;
grant execute on function public.preview_work_order_ti_number() to authenticated;
grant execute on function public.allocate_work_order_ti_number(text, uuid) to authenticated;

select public.sync_ti_counter_from_records();
select public.preview_work_order_ti_number();


-- ############################################################################
-- ###  SOURCE: label_print_lock_patch.sql
-- ############################################################################

-- Label print-lock + print-job queue  (consolidating migration — safe to re-run).
--
-- Quota model — record the ACTUAL printed count (BarTender edition blocks headless
-- command-line printing, so the shop runs manual mode):
--   * Clicking Print calls begin_print(): it fixes the starting serial at the current
--     printed offset and queues a 'print' job (one open session per TI at a time).
--     No quantity is trusted from the app.
--   * The agent opens the label in BarTender; the operator sets the quantity and prints.
--     The agent reads how many labels actually reached the Windows spooler (its own job
--     only) and PATCHes label_count = actual, status = 'done'.
--   * The BEFORE-UPDATE trigger ct_apply_print_job commits that ACTUAL count on 'done'
--     (labels_issued += actual, lock if full, record the batch); 'error'/zero records
--     nothing. Only an admin can unlock a fully-printed TI.
--   * labels_reserved is retained as a column but unused (always 0).
--
-- Run in the Supabase SQL editor after schema.sql.

-- ---------------------------------------------------------------------------
-- 1. Per-TI quota + lock state
-- ---------------------------------------------------------------------------
alter table public.ct_ti_records
  add column if not exists label_qty integer,
  add column if not exists labels_issued integer not null default 0,
  add column if not exists labels_reserved integer not null default 0,
  add column if not exists labels_locked boolean not null default false,
  add column if not exists labels_locked_by uuid references public.profiles(id) on update cascade on delete set null,
  add column if not exists labels_locked_at timestamptz;

-- Remove a column an earlier draft of this migration may have added (no longer used).
alter table public.ct_ti_records drop column if exists label_next_serial;

-- ---------------------------------------------------------------------------
-- 2. Permanent serial register (only confirmed/printed batches land here)
-- ---------------------------------------------------------------------------
create table if not exists public.ct_ti_label_batches (
  id uuid primary key default gen_random_uuid(),
  ti_no text not null,
  count integer not null,
  offset_start integer not null,
  offset_end integer not null,
  serial_start text,
  serial_end text,
  issued_by uuid references public.profiles(id) on update cascade on delete set null,
  issued_by_initials text,
  issued_at timestamptz not null default now()
);
create index if not exists ct_ti_label_batches_ti_no_idx on public.ct_ti_label_batches (ti_no);
create index if not exists ct_ti_label_batches_serial_start_idx on public.ct_ti_label_batches (serial_start);

-- ---------------------------------------------------------------------------
-- 3. Print-job queue consumed by the local BarTender agent
-- ---------------------------------------------------------------------------
create table if not exists public.ct_print_jobs (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('save', 'print', 'edit')),
  ti_no text,
  item_code text not null,
  serial_start text,
  label_count integer,
  btw_base64 text,
  status text not null default 'pending' check (status in ('pending', 'opened', 'saved', 'done', 'error')),
  error text,
  created_by uuid references public.profiles(id) on update cascade on delete set null,
  created_by_initials text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ct_print_jobs
  add column if not exists serial_end text,
  add column if not exists committed boolean not null default false;
-- allow the 'edit' action on an already-created table (create-if-not-exists won't alter it)
alter table public.ct_print_jobs drop constraint if exists ct_print_jobs_action_check;
alter table public.ct_print_jobs add constraint ct_print_jobs_action_check check (action in ('save', 'print', 'edit'));

create index if not exists ct_print_jobs_status_idx on public.ct_print_jobs (status);
create index if not exists ct_print_jobs_created_at_idx on public.ct_print_jobs (created_at);

drop trigger if exists touch_ct_print_jobs_updated_at on public.ct_print_jobs;
create trigger touch_ct_print_jobs_updated_at
before update on public.ct_print_jobs
for each row execute function public.touch_updated_at();

-- Dedicated flag identifying the local print-agent login.
alter table public.profiles
  add column if not exists is_print_agent boolean not null default false;

-- Strict identity by auth.uid() only (consistent with 2026_production_hardening.sql).
create or replace function public.is_print_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and is_print_agent = true
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Serial helpers (mirror the webapp buildLabelSerials / getLabelSerialSeed)
-- ---------------------------------------------------------------------------
create or replace function public.ct_label_serial_at(seed text, at_offset integer)
returns text
language plpgsql
immutable
as $$
declare
  parts text[]; prefix text; num text; width integer;
begin
  if seed is null or btrim(seed) = '' then return ''; end if;
  parts := regexp_match(seed, '^(.*?)([0-9]+)\s*$');
  if parts is null then return seed; end if;
  prefix := parts[1]; num := parts[2]; width := length(num);
  return prefix || lpad((num::bigint + at_offset)::text, width, '0');
end;
$$;

create or replace function public.ct_label_serial_seed(p_ti_no text, p_serial_number text)
returns text
language plpgsql
immutable
as $$
declare
  seed text; range_match text[];
begin
  seed := btrim(coalesce(p_serial_number, ''));
  range_match := regexp_match(seed, '^(.+?)\s+(?:TO|TILL|THRU|THROUGH)\s+.+$', 'i');
  if range_match is not null then seed := btrim(range_match[1]); end if;
  if seed = '' then seed := btrim(coalesce(p_ti_no, '')); end if;
  return seed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. begin_print — open a print session (fix start serial + queue job; no count yet)
-- ---------------------------------------------------------------------------
drop function if exists public.issue_ti_labels(text, integer);

-- begin_print opens a print SESSION: it fixes the starting serial (at the current
-- printed offset) and queues the job. It does NOT trust a typed quantity — the agent
-- reports back the ACTUAL number of labels the printer produced, which the trigger
-- below commits. One open session per TI at a time keeps serial ranges from overlapping.
drop function if exists public.reserve_ti_labels(text, text, integer);

create or replace function public.begin_print(p_ti_no text, p_item_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  rec public.ct_ti_records;
  qty integer;
  remaining integer;
  seed text;
  serial_start text;
  job_id uuid;
begin
  select * into me from public.current_profile();
  if me.id is null or me.is_active is not true or lower(me.role) <> 'user' then
    raise exception 'User role required to print labels';
  end if;
  if p_item_code is null or btrim(p_item_code) = '' then
    raise exception 'Item code is required';
  end if;

  select * into rec from public.ct_ti_records where ti_no = p_ti_no for update;
  if rec.id is null then raise exception 'TI record not found: %', p_ti_no; end if;
  if rec.approval_status <> 'checked' then raise exception 'TI must be checked before printing labels'; end if;
  if rec.labels_locked then raise exception 'Labels are locked for this TI. An admin must unlock.'; end if;

  qty := coalesce(rec.label_qty, nullif((regexp_match(coalesce(rec.quantity, ''), '[0-9]+'))[1], '')::integer);
  if qty is null or qty < 1 then raise exception 'Set a valid TI quantity before printing labels'; end if;

  remaining := qty - rec.labels_issued;
  if remaining <= 0 then raise exception 'All % label(s) for this TI have already been printed', qty; end if;

  if exists (select 1 from public.ct_print_jobs
             where ti_no = p_ti_no and action = 'print' and status in ('pending', 'opened')) then
    raise exception 'A print for this TI is already in progress. Finish or close it first.';
  end if;

  seed := public.ct_label_serial_seed(rec.ti_no, rec.serial_number);
  serial_start := public.ct_label_serial_at(seed, rec.labels_issued);

  update public.ct_ti_records set label_qty = qty where id = rec.id;

  insert into public.ct_print_jobs
    (action, ti_no, item_code, serial_start, label_count, status, created_by, created_by_initials)
  values
    ('print', rec.ti_no, p_item_code, serial_start, null, 'pending', me.id, me.initials)
  returning id into job_id;

  return jsonb_build_object(
    'job_id', job_id,
    'serial_start', serial_start,
    'labels_issued', rec.labels_issued,
    'label_qty', qty,
    'remaining', remaining
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Commit trigger — records the ACTUAL printed count the agent reports
-- ---------------------------------------------------------------------------
-- The agent sets label_count to the number of labels the Windows spooler actually
-- produced, then status 'done'. This trigger commits exactly that many (never a
-- number typed in the app). 'error'/'done'-with-zero records nothing.
create or replace function public.ct_apply_print_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.ct_ti_records;
  seed text;
  actual integer;
  new_issued integer;
begin
  -- Reclaim storage: the base64 template is only needed until the agent has written
  -- the label file to the print PC. Drop it once the job reaches a successful terminal
  -- state (any action) so save/edit blobs (~50 KB each) don't accumulate in the DB.
  if new.btw_base64 is not null and new.status in ('saved', 'done') then
    new.btw_base64 := null;
  end if;

  if new.action <> 'print' or new.ti_no is null then return new; end if;
  if coalesce(old.committed, false) or coalesce(new.committed, false) then return new; end if;

  if new.status = 'done' and coalesce(new.label_count, 0) > 0 then
    select * into rec from public.ct_ti_records where ti_no = new.ti_no for update;
    if rec.id is not null then
      actual := new.label_count;
      new_issued := rec.labels_issued + actual;
      seed := public.ct_label_serial_seed(rec.ti_no, rec.serial_number);
      update public.ct_ti_records
      set labels_issued = new_issued,
          labels_locked = (rec.label_qty is not null and new_issued >= rec.label_qty),
          labels_locked_by = case when (rec.label_qty is not null and new_issued >= rec.label_qty) then new.created_by else rec.labels_locked_by end,
          labels_locked_at = case when (rec.label_qty is not null and new_issued >= rec.label_qty) then now() else rec.labels_locked_at end
      where id = rec.id;

      insert into public.ct_ti_label_batches
        (ti_no, count, offset_start, offset_end, serial_start, serial_end, issued_by, issued_by_initials)
      values
        (new.ti_no, actual, rec.labels_issued, new_issued - 1,
         public.ct_label_serial_at(seed, rec.labels_issued),
         public.ct_label_serial_at(seed, new_issued - 1),
         new.created_by, new.created_by_initials);
    end if;
    new.committed := true;

  elsif new.status in ('done', 'error') then
    -- session ended with nothing printed; record nothing
    new.committed := true;
  end if;

  return new;
end;
$$;

drop trigger if exists ct_print_jobs_apply on public.ct_print_jobs;
create trigger ct_print_jobs_apply
before update on public.ct_print_jobs
for each row execute function public.ct_apply_print_job();

-- One-time reclaim: null out template blobs already consumed by the agent.
update public.ct_print_jobs set btw_base64 = null
where btw_base64 is not null and status in ('saved', 'done');

-- ---------------------------------------------------------------------------
-- 7. unlock_ti_labels — admin clears the lock and resets for a FULL REDO.
-- ---------------------------------------------------------------------------
-- Business rule: unlocking labels means "start this TI's labels over from the
-- beginning." The printed count is reset to 0, so the next print restarts the
-- SAME serial numbers from the original seed (labels_issued drives the serial
-- offset). Use this when the printed batch is being reprinted from scratch.
--
-- The ct_ti_label_batches rows from the earlier run are KEPT as history (an audit
-- trail that a first run happened); only the live counter on the TI resets.
create or replace function public.unlock_ti_labels(p_ti_no text, p_new_qty integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.ct_ti_records;
begin
  if not public.is_admin() then raise exception 'Admin role required to unlock labels'; end if;

  select * into rec from public.ct_ti_records where ti_no = p_ti_no for update;
  if rec.id is null then raise exception 'TI record not found: %', p_ti_no; end if;
  if p_new_qty is not null and p_new_qty < 1 then
    raise exception 'New quantity must be at least 1';
  end if;

  update public.ct_ti_records
  set label_qty = coalesce(p_new_qty, label_qty),
      labels_issued = 0,       -- full redo: reset printed count; serials restart from the seed
      labels_reserved = 0,
      labels_locked = false,
      labels_locked_by = null,
      labels_locked_at = null
  where id = rec.id
  returning * into rec;

  return jsonb_build_object('labels_issued', rec.labels_issued, 'label_qty', rec.label_qty, 'locked', rec.labels_locked);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7b. cancel_print — operator (or admin) releases an OPEN print session
-- ---------------------------------------------------------------------------
-- Shop-floor case: an operator clicks Print, the label opens in BarTender, they
-- close it WITHOUT printing, then want to print again. begin_print's in-progress
-- guard blocks the second print until that abandoned session ends. This lets the
-- operator who opened it (or an admin) end their own live 'pending'/'opened'
-- print job for this TI right away, so they can re-print without waiting for the
-- agent's no-print timeout. It records nothing: committed = true means the apply
-- trigger never advances labels_issued (the operator simply reprints).
create or replace function public.cancel_print(p_ti_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  n integer;
begin
  select * into me from public.current_profile();
  if me.id is null or me.is_active is not true then
    raise exception 'Sign in to cancel a print';
  end if;

  update public.ct_print_jobs
  set status = 'error',
      committed = true,
      error = 'Print session cancelled by ' || coalesce(me.initials, 'operator') || '.'
  where ti_no = p_ti_no
    and action = 'print'
    and status in ('pending', 'opened')
    and (created_by = me.id or public.is_admin());

  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS + grants
-- ---------------------------------------------------------------------------
alter table public.ct_ti_label_batches enable row level security;
alter table public.ct_print_jobs enable row level security;

-- SELECT stays locked down: these tables hold BarTender template blobs and the
-- serial register. Ordinary users never read them directly — the webapp uses the
-- saved_label_exists() definer RPC. (Matches 2026_production_hardening.sql so the
-- guard holds regardless of migration order.)
drop policy if exists "Allow active users read label batches" on public.ct_ti_label_batches;
drop policy if exists "Allow agent read label batches" on public.ct_ti_label_batches;
drop policy if exists "Allow active users read print jobs" on public.ct_print_jobs;
drop policy if exists "Allow owner or agent read print jobs" on public.ct_print_jobs;
drop policy if exists "Allow users insert print jobs" on public.ct_print_jobs;
drop policy if exists "Allow agent update print jobs" on public.ct_print_jobs;

create policy "Allow agent read label batches"
on public.ct_ti_label_batches for select to authenticated
using (public.is_print_agent() or public.is_admin());

create policy "Allow owner or agent read print jobs"
on public.ct_print_jobs for select to authenticated
using (created_by = auth.uid() or public.is_print_agent() or public.is_admin());

-- 'save' jobs are inserted directly by the user; 'print' jobs are inserted by
-- begin_print (security definer). Both require the user role.
create policy "Allow users insert print jobs"
on public.ct_print_jobs for insert to authenticated with check (public.current_user_role() = 'user');

create policy "Allow agent update print jobs"
on public.ct_print_jobs for update to authenticated
using (public.is_print_agent() or public.is_admin())
with check (public.is_print_agent() or public.is_admin());

-- Existence check for the webapp without granting SELECT on ct_print_jobs.
create or replace function public.saved_label_exists(p_item_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ct_print_jobs
    where action = 'save' and item_code = p_item_code and status in ('saved', 'done')
  )
$$;

revoke all on public.ct_ti_label_batches from anon;
revoke all on public.ct_print_jobs from anon;
grant select, insert on public.ct_ti_label_batches to authenticated;
grant select, insert, update on public.ct_print_jobs to authenticated;

grant execute on function public.is_print_agent() to authenticated;
grant execute on function public.saved_label_exists(text) to authenticated;
grant execute on function public.ct_label_serial_at(text, integer) to authenticated;
grant execute on function public.ct_label_serial_seed(text, text) to authenticated;
grant execute on function public.begin_print(text, text) to authenticated;
grant execute on function public.cancel_print(text) to authenticated;
grant execute on function public.unlock_ti_labels(text, integer) to authenticated;


-- ############################################################################
-- ###  SOURCE: 2026_edit_label_action.sql
-- ############################################################################

-- ---------------------------------------------------------------------------
-- Add the 'edit' print-job action.
--
-- 'edit' tells the local BarTender agent to OPEN the already-saved template for
-- item_code in place (C:\CTLabels\<itemCode>\<itemCode>.btw) so the operator can
-- correct it and press Ctrl+S. Unlike 'save', it ships no template blob and never
-- overwrites the saved file, so an accidental click can't clobber a corrected
-- template with the rough server copy.
--
-- 'edit' jobs use the existing 'opened' status and are ignored by the quota
-- trigger (ct_apply_print_job only acts on 'print'), so no other change is needed.
-- Idempotent; safe to re-run.
-- ---------------------------------------------------------------------------
alter table public.ct_print_jobs
  drop constraint if exists ct_print_jobs_action_check;
alter table public.ct_print_jobs
  add constraint ct_print_jobs_action_check check (action in ('save', 'print', 'edit'));


-- ############################################################################
-- ###  SOURCE: 2026_unlock_requests.sql
-- ############################################################################

-- =============================================================================
-- CT-TI unlock-request queue — consolidating migration
-- =============================================================================
-- Apply this LAST, after schema.sql, label_print_lock_patch.sql and
-- 2026_production_hardening.sql. It is idempotent and safe to re-run.
--
-- Purpose: when a TI is locked (checked) or its labels are locked, a non-admin
-- operator can RAISE A REQUEST instead of chasing an admin. Admins see the
-- pending queue (a badge + a list in the Admin Panel) and unlock straight from
-- it — no need to open each TI. Requests auto-resolve when the matching lock is
-- cleared, whether that happens from the queue or from the TI's own screen.
--
-- This migration NEVER redefines reopen_ti_record / unlock_ti_labels (so it
-- cannot erode their guards). Auto-resolve is done by an AFTER-UPDATE trigger on
-- ct_ti_records that watches the lock columns those RPCs already flip.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Request table
-- -----------------------------------------------------------------------------
create table if not exists public.ct_unlock_requests (
  id            uuid primary key default gen_random_uuid(),
  ti_no         text not null,
  request_type  text not null check (request_type in ('ti', 'label')),
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'resolved', 'cancelled')),
  requested_by  uuid references public.profiles(id) on update cascade on delete set null,
  requested_at  timestamptz not null default now(),
  resolved_by   uuid references public.profiles(id) on update cascade on delete set null,
  resolved_at   timestamptz
);

-- At most one OPEN request per (ti_no, type). Resolved/cancelled rows are kept
-- as history and do not block a fresh request later.
create unique index if not exists ct_unlock_requests_open_unique
  on public.ct_unlock_requests (ti_no, request_type)
  where status = 'pending';

create index if not exists ct_unlock_requests_pending_idx
  on public.ct_unlock_requests (status, requested_at desc);

-- -----------------------------------------------------------------------------
-- 2. request_unlock — any active user raises (or re-affirms) a request
-- -----------------------------------------------------------------------------
create or replace function public.request_unlock(
  p_ti_no text,
  p_type  text,
  p_reason text default null
)
returns public.ct_unlock_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.ct_unlock_requests;
begin
  if not public.is_active_user() then
    raise exception 'Only an active user can request an unlock.';
  end if;
  if p_type not in ('ti', 'label') then
    raise exception 'Invalid unlock request type: %', p_type;
  end if;

  insert into public.ct_unlock_requests (ti_no, request_type, reason, requested_by)
  values (p_ti_no, p_type, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (ti_no, request_type) where (status = 'pending')
  do update set
    -- keep the earliest requester/time; only refresh the reason if a new one is given
    reason = coalesce(nullif(btrim(coalesce(excluded.reason, '')), ''),
                      public.ct_unlock_requests.reason)
  returning * into result;

  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. resolve_unlock_request — admin closes a request (with or without unlocking)
-- -----------------------------------------------------------------------------
create or replace function public.resolve_unlock_request(p_id uuid)
returns public.ct_unlock_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.ct_unlock_requests;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can resolve an unlock request.';
  end if;

  update public.ct_unlock_requests
  set status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into result;

  return result;  -- null if it was already closed; the caller treats that as fine
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Auto-resolve trigger — clear pending requests when the lock is lifted,
--    regardless of HOW it was lifted (queue action or the TI's own screen).
-- -----------------------------------------------------------------------------
create or replace function public.ct_resolve_unlock_requests_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- TI unlock: approval_status left 'checked'
  if old.approval_status = 'checked' and new.approval_status is distinct from 'checked' then
    update public.ct_unlock_requests
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where ti_no = new.ti_no and request_type = 'ti' and status = 'pending';
  end if;

  -- Label unlock: labels_locked went true -> false
  if old.labels_locked = true and new.labels_locked = false then
    update public.ct_unlock_requests
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where ti_no = new.ti_no and request_type = 'label' and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists ct_resolve_unlock_requests on public.ct_ti_records;
create trigger ct_resolve_unlock_requests
  after update of approval_status, labels_locked on public.ct_ti_records
  for each row
  execute function public.ct_resolve_unlock_requests_on_change();

-- -----------------------------------------------------------------------------
-- 5. Row-level security
-- -----------------------------------------------------------------------------
alter table public.ct_unlock_requests enable row level security;

drop policy if exists ct_unlock_requests_select on public.ct_unlock_requests;
create policy ct_unlock_requests_select on public.ct_unlock_requests
  for select to authenticated
  using (public.is_admin() or requested_by = auth.uid());

drop policy if exists ct_unlock_requests_insert on public.ct_unlock_requests;
create policy ct_unlock_requests_insert on public.ct_unlock_requests
  for insert to authenticated
  with check (public.is_active_user() and requested_by = auth.uid());

drop policy if exists ct_unlock_requests_update on public.ct_unlock_requests;
create policy ct_unlock_requests_update on public.ct_unlock_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
grant select, insert on public.ct_unlock_requests to authenticated;
grant update (status, resolved_by, resolved_at) on public.ct_unlock_requests to authenticated;
grant execute on function public.request_unlock(text, text, text) to authenticated;
grant execute on function public.resolve_unlock_request(uuid) to authenticated;

commit;


-- ############################################################################
-- ###  SOURCE: 2026_production_hardening.sql
-- ############################################################################

-- =============================================================================
-- CT-TI production hardening — consolidating migration
-- =============================================================================
-- Apply this LAST, after all existing schema/patch files. It is idempotent and
-- safe to re-run. Because the project's SQL was deployed incrementally and later
-- files silently dropped guards that earlier files had, this migration restores
-- every guard and always wins (it is the final `create or replace`).
--
-- Fixes:
--   A1  restore the role guard on allocate_ti_number / allocate_work_order_ti_number
--       and the active-user guard on preview_ti_number
--   A2  UNIQUE constraint on ct_work_orders.ti_no
--   A3  financial-year–aware TI counter (resets each FY; never lowers in-year)
--   A4  role/identity resolved STRICTLY by auth.uid() (no email fallback)
--   A5  scope over-broad SELECT policies (profiles, app_settings, print tables)
--   A6  block direct forgery of inspection/approval columns
--   B4  handle_new_auth_user no longer silently re-activates deactivated accounts
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A3 — financial-year–aware counter: remember which FY the stored value belongs to
-- -----------------------------------------------------------------------------
alter table public.ct_ti_counter add column if not exists fy_prefix text;

-- -----------------------------------------------------------------------------
-- A4 — reconcile profiles so every auth user has an id-matched profile.
-- This makes the strict auth.uid() lookups below safe: any legacy profile that
-- was keyed by a mismatched id (email-seeded/imported) gets an id-matched copy
-- that inherits its role. Only INSERTs missing rows; never updates or deletes.
-- -----------------------------------------------------------------------------
insert into public.profiles (id, email, full_name, initials, role, is_active)
select
  u.id,
  u.email,
  coalesce(legacy.full_name, nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1), 'User'),
  coalesce(
    legacy.initials,
    public.initials_from_name(coalesce(legacy.full_name, nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1), 'User'))
  ),
  coalesce(legacy.role, 'viewer'),
  coalesce(legacy.is_active, true)
from auth.users u
left join public.profiles p on p.id = u.id
left join lateral (
  select lp.*
  from public.profiles lp
  where lower(lp.email) = lower(u.email)
    and lp.id <> u.id
  order by (lower(lp.role) = 'admin') desc, lp.is_active desc, lp.updated_at desc nulls last
  limit 1
) legacy on true
where p.id is null
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- A4 — strict identity functions (resolve only by auth.uid())
-- -----------------------------------------------------------------------------
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid() limit 1
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
  where id = auth.uid() and is_active = true
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
    select 1 from public.profiles where id = auth.uid() and is_active = true
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

-- is_print_agent may not exist yet if the print-lock patch has not been applied.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_print_agent'
  ) then
    create or replace function public.is_print_agent()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
      select exists (
        select 1 from public.profiles
        where id = auth.uid() and is_active = true and is_print_agent = true
      )
    $fn$;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- B4 — new-auth-user trigger must NOT silently re-activate a deactivated account
-- -----------------------------------------------------------------------------
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
  set email = excluded.email,
      full_name = excluded.full_name,
      initials = excluded.initials;
  -- Intentionally does NOT touch is_active on conflict.

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- A3 — counter helpers, financial-year aware
-- -----------------------------------------------------------------------------
create or replace function public.sync_ti_counter_from_records()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_prefix text := left(public.format_ti_no(0), 11);
  stored_prefix text;
  old_value integer;
  ti_record_max integer;
  work_order_max integer;
  new_value integer;
begin
  select current_value, fy_prefix into old_value, stored_prefix
  from public.ct_ti_counter where id = true for update;

  if stored_prefix is distinct from current_prefix then
    old_value := 0;  -- new financial year: ignore last year's counter
  end if;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  -- greatest(...) so the counter can never be lowered within the same FY (no reuse)
  new_value := greatest(coalesce(old_value, 0), ti_record_max, work_order_max);

  update public.ct_ti_counter
  set current_value = new_value, fy_prefix = current_prefix, updated_at = now()
  where id = true;

  return new_value;
end;
$$;

create or replace function public.preview_ti_number()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_prefix text := left(public.format_ti_no(0), 11);
  stored_prefix text;
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
begin
  if not public.is_active_user() then
    raise exception 'Active account required';
  end if;

  select current_value, fy_prefix into counter_value, stored_prefix
  from public.ct_ti_counter where id = true;

  if stored_prefix is distinct from current_prefix then
    counter_value := 0;
  end if;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  return public.format_ti_no(greatest(coalesce(counter_value, 0), ti_record_max, work_order_max) + 1);
end;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_prefix text := left(public.format_ti_no(0), 11);
  stored_prefix text;
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  -- A1: only the 'user' role may allocate.
  if public.current_user_role() <> 'user' then
    raise exception 'Create permission required';
  end if;

  select current_value, fy_prefix into counter_value, stored_prefix
  from public.ct_ti_counter where id = true for update;

  if stored_prefix is distinct from current_prefix then
    counter_value := 0;  -- A3: new financial year, restart numbering
  end if;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if preferred_ti_no like current_prefix || '%' and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          fy_prefix = current_prefix,
          updated_at = now()
      where id = true;
    else
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max),
          fy_prefix = current_prefix,
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value, fy_prefix = current_prefix, updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

create or replace function public.allocate_work_order_ti_number(
  preferred_ti_no text default null,
  current_work_order_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_prefix text := left(public.format_ti_no(0), 11);
  stored_prefix text;
  counter_value integer;
  ti_record_max integer;
  work_order_max integer;
  source_max integer;
  next_value integer;
  preferred_suffix integer;
begin
  -- A1: only the 'user' role may allocate.
  if public.current_user_role() <> 'user' then
    raise exception 'Create permission required';
  end if;

  select current_value, fy_prefix into counter_value, stored_prefix
  from public.ct_ti_counter where id = true for update;

  if stored_prefix is distinct from current_prefix then
    counter_value := 0;  -- A3
  end if;

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into ti_record_max
  from public.ct_ti_records
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  select coalesce(max((regexp_match(ti_no, '([0-9]+)$'))[1]::integer), 0)
  into work_order_max
  from public.ct_work_orders
  where ti_no like current_prefix || '%' and ti_no ~ '[0-9]+$';

  source_max := greatest(ti_record_max, work_order_max);

  if preferred_ti_no is not null and btrim(preferred_ti_no) <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    if exists (
      select 1 from public.ct_work_orders
      where ti_no = preferred_ti_no
        and (current_work_order_id is null or id <> current_work_order_id)
    ) then
      raise exception 'TI number already exists in work orders: %', preferred_ti_no;
    end if;

    if preferred_ti_no like current_prefix || '%' and preferred_ti_no ~ '[0-9]+$' then
      preferred_suffix := (regexp_match(preferred_ti_no, '([0-9]+)$'))[1]::integer;
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max, preferred_suffix),
          fy_prefix = current_prefix,
          updated_at = now()
      where id = true;
    else
      update public.ct_ti_counter
      set current_value = greatest(coalesce(counter_value, 0), source_max),
          fy_prefix = current_prefix,
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  next_value := greatest(coalesce(counter_value, 0), source_max) + 1;

  update public.ct_ti_counter
  set current_value = next_value, fy_prefix = current_prefix, updated_at = now()
  where id = true;

  return public.format_ti_no(next_value);
end;
$$;

-- -----------------------------------------------------------------------------
-- A2 — enforce unique work-order TI numbers (partial: allow multiple NULLs).
-- If pre-existing duplicate ti_no rows exist, don't abort the whole migration —
-- warn so they can be reconciled and the index created afterward.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create unique index if not exists ct_work_orders_ti_no_key
      on public.ct_work_orders (ti_no)
      where ti_no is not null;
  exception when unique_violation then
    raise warning 'ct_work_orders has duplicate ti_no values; unique index NOT created. Resolve duplicates, then run: create unique index ct_work_orders_ti_no_key on public.ct_work_orders (ti_no) where ti_no is not null;';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- A6 — inspection/approval columns can change only through the review RPCs.
-- The RPCs run SECURITY DEFINER (current_user = function owner); a direct
-- PostgREST PATCH runs as the 'authenticated' role, which this trigger blocks.
-- -----------------------------------------------------------------------------
create or replace function public.guard_ti_review_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user = 'authenticated' and (
       new.approval_status is distinct from old.approval_status
    or new.checked_by is distinct from old.checked_by
    or new.checked_by_user_id is distinct from old.checked_by_user_id
    or new.checked_at is distinct from old.checked_at
    or new.approved_by is distinct from old.approved_by
    or new.approved_by_user_id is distinct from old.approved_by_user_id
    or new.approved_at is distinct from old.approved_at
  ) then
    raise exception 'Inspection/approval fields can only be changed through the review workflow (check / reject / reopen).';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_ti_review_columns on public.ct_ti_records;
create trigger guard_ti_review_columns
before update on public.ct_ti_records
for each row execute function public.guard_ti_review_columns();

-- -----------------------------------------------------------------------------
-- A5 — scope over-broad SELECT policies
-- -----------------------------------------------------------------------------
-- profiles: a user may read only their own row; admins read all.
drop policy if exists "Allow active users read profiles" on public.profiles;
drop policy if exists "Allow self or admin read profiles" on public.profiles;
create policy "Allow self or admin read profiles"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

-- app_settings: admin only (only the Admin panel reads it; RPCs use definer).
drop policy if exists "Allow active users read settings" on public.app_settings;
drop policy if exists "Allow admin read settings" on public.app_settings;
create policy "Allow admin read settings"
on public.app_settings for select
to authenticated
using (public.is_admin());

-- print tables: don't let ordinary users read other people's BarTender templates.
do $$
begin
  if to_regclass('public.ct_print_jobs') is not null then
    execute 'drop policy if exists "Allow active users read print jobs" on public.ct_print_jobs';
    execute 'drop policy if exists "Allow owner or agent read print jobs" on public.ct_print_jobs';
    execute $p$
      create policy "Allow owner or agent read print jobs"
      on public.ct_print_jobs for select
      to authenticated
      using (created_by = auth.uid() or public.is_print_agent() or public.is_admin())
    $p$;
  end if;

  if to_regclass('public.ct_ti_label_batches') is not null then
    execute 'drop policy if exists "Allow active users read label batches" on public.ct_ti_label_batches';
    execute 'drop policy if exists "Allow agent read label batches" on public.ct_ti_label_batches';
    execute $p$
      create policy "Allow agent read label batches"
      on public.ct_ti_label_batches for select
      to authenticated
      using (public.is_print_agent() or public.is_admin())
    $p$;
  end if;
end;
$$;

-- The webapp checks "does a saved label template exist for this item code?"
-- through this definer RPC instead of reading ct_print_jobs directly, so the
-- table's SELECT can stay locked down while the existence check still works.
do $$
begin
  if to_regclass('public.ct_print_jobs') is not null then
    execute $fn$
      create or replace function public.saved_label_exists(p_item_code text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select exists (
          select 1 from public.ct_print_jobs
          where action = 'save'
            and item_code = p_item_code
            and status in ('saved', 'done')
        )
      $body$;
    $fn$;
    execute 'grant execute on function public.saved_label_exists(text) to authenticated';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Re-grant execute (create or replace preserves grants, but be explicit)
-- -----------------------------------------------------------------------------
grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.preview_ti_number() to authenticated;
grant execute on function public.allocate_ti_number(text) to authenticated;
grant execute on function public.allocate_work_order_ti_number(text, uuid) to authenticated;
grant execute on function public.sync_ti_counter_from_records() to authenticated;

-- Stamp the counter's FY prefix for the current year without lowering it.
select public.sync_ti_counter_from_records();

commit;


-- ############################################################################
-- ###  SOURCE: 2026_storage_reclaim.sql
-- ############################################################################

-- =============================================================================
-- CT-TI storage reclamation — consolidating migration
-- =============================================================================
-- Apply this LAST, after every other schema/patch file. Idempotent; safe to
-- re-run. It reclaims and caps the only real space consumers in the database
-- without touching the TI/item/work-order data or the permanent serial register.
--
-- Background (see label_print_lock_patch.sql):
--   * ct_print_jobs is a TRANSIENT work queue for the BarTender agent, but its
--     rows were never deleted and it carries a ~50 KB base64 template per save/
--     edit job. High UPDATE churn (pending -> opened -> done + touch trigger)
--     plus permanent rows = the bulk of wasted space and table/index bloat.
--   * ct_ti_counter and app_settings are single-row tables updated very often
--     (the counter on every TI allocation), so they bloat without HOT updates.
--
-- What this migration does:
--   1. fillfactor tuning so future updates stay HOT and self-clean.
--   2. Extends the blob-reclaim to ALL terminal states (incl. 'error').
--   3. purge_print_jobs(retain_days) — caps the queue (default 90 days) while
--      keeping saved_label_exists() correct and the serial register intact.
--   4. One-time reclaim now, then auto-schedules nightly via pg_cron if present
--      (else an admin runs purge_print_jobs on demand).
--
-- NOT changed (deliberate): ct_ti_records column snapshots (point-in-time TI
-- integrity) and ct_ti_label_batches (permanent serial traceability).
--
-- VACUUM FULL is required ONCE to hand already-dead space back to the OS. It
-- cannot run inside a transaction, so it is listed at the very bottom as a
-- separate copy-paste step to run after this migration commits.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. fillfactor: leave room on each page so repeated UPDATEs are HOT (they
--    reuse the page and are reclaimed by autovacuum instead of bloating).
--    Only affects rows written/updated AFTER the one-time VACUUM FULL below.
-- -----------------------------------------------------------------------------
alter table public.ct_print_jobs set (fillfactor = 70);
alter table public.ct_ti_counter set (fillfactor = 50);
alter table public.app_settings  set (fillfactor = 50);

-- Make autovacuum act sooner on the churny queue table.
alter table public.ct_print_jobs set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50
);

-- -----------------------------------------------------------------------------
-- 2. Extend blob reclaim to every terminal state (adds 'error' to 'saved'/'done').
--    Faithful copy of ct_apply_print_job from label_print_lock_patch.sql with
--    only the null-out condition widened — all quota/commit guards preserved.
-- -----------------------------------------------------------------------------
create or replace function public.ct_apply_print_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.ct_ti_records;
  seed text;
  actual integer;
  new_issued integer;
begin
  -- Reclaim storage: the base64 template is only needed until the agent has
  -- written the label file to the print PC. Drop it once the job reaches ANY
  -- terminal state (success or error) so blobs (~50 KB each) never linger.
  if new.btw_base64 is not null and new.status in ('saved', 'done', 'error') then
    new.btw_base64 := null;
  end if;

  if new.action <> 'print' or new.ti_no is null then return new; end if;
  if coalesce(old.committed, false) or coalesce(new.committed, false) then return new; end if;

  if new.status = 'done' and coalesce(new.label_count, 0) > 0 then
    select * into rec from public.ct_ti_records where ti_no = new.ti_no for update;
    if rec.id is not null then
      actual := new.label_count;
      new_issued := rec.labels_issued + actual;
      seed := public.ct_label_serial_seed(rec.ti_no, rec.serial_number);
      update public.ct_ti_records
      set labels_issued = new_issued,
          labels_locked = (rec.label_qty is not null and new_issued >= rec.label_qty),
          labels_locked_by = case when (rec.label_qty is not null and new_issued >= rec.label_qty) then new.created_by else rec.labels_locked_by end,
          labels_locked_at = case when (rec.label_qty is not null and new_issued >= rec.label_qty) then now() else rec.labels_locked_at end
      where id = rec.id;

      insert into public.ct_ti_label_batches
        (ti_no, count, offset_start, offset_end, serial_start, serial_end, issued_by, issued_by_initials)
      values
        (new.ti_no, actual, rec.labels_issued, new_issued - 1,
         public.ct_label_serial_at(seed, rec.labels_issued),
         public.ct_label_serial_at(seed, new_issued - 1),
         new.created_by, new.created_by_initials);
    end if;
    new.committed := true;

  elsif new.status in ('done', 'error') then
    -- session ended with nothing printed; record nothing
    new.committed := true;
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged, re-created for completeness.
drop trigger if exists ct_print_jobs_apply on public.ct_print_jobs;
create trigger ct_print_jobs_apply
before update on public.ct_print_jobs
for each row execute function public.ct_apply_print_job();

-- -----------------------------------------------------------------------------
-- 3. purge_print_jobs — cap the transient queue without breaking existence
--    checks or the serial register.
--
--    Kept:   the NEWEST successful ('saved'/'done') save row per item_code
--            (that is what saved_label_exists() reads), and everything inside
--            the retention window.
--    Purged: superseded successful save rows, failed/stale save/edit/print
--            rows past the window, and committed print rows past the window.
--
--    ct_ti_label_batches is never touched here.
-- -----------------------------------------------------------------------------
create or replace function public.purge_print_jobs(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz;
  removed integer := 0;
  n integer;
begin
  -- Admins may run it manually; a scheduler (pg_cron / postgres) is not the
  -- 'authenticated' role, so it is allowed. Ordinary users are blocked.
  if current_user = 'authenticated' and not public.is_admin() then
    raise exception 'Admin role required to purge print jobs';
  end if;

  cutoff := now() - make_interval(days => greatest(retain_days, 1));

  -- (a) Dedupe successful saves: keep only the newest per item_code.
  with ranked as (
    select id,
           row_number() over (
             partition by item_code
             order by coalesce(updated_at, created_at) desc, id desc
           ) as rn
    from public.ct_print_jobs
    where action = 'save' and status in ('saved', 'done')
  )
  delete from public.ct_print_jobs pj
  using ranked
  where pj.id = ranked.id and ranked.rn > 1;
  get diagnostics n = row_count; removed := removed + n;

  -- (b) Old committed print sessions (already reflected in the serial register).
  delete from public.ct_print_jobs
  where action = 'print'
    and coalesce(committed, false) = true
    and coalesce(updated_at, created_at) < cutoff;
  get diagnostics n = row_count; removed := removed + n;

  -- (c) Stale/failed transient jobs of any action past the window.
  delete from public.ct_print_jobs
  where coalesce(updated_at, created_at) < cutoff
    and (
      status = 'error'
      or (action = 'edit')
      or (action = 'save' and status in ('pending', 'opened'))
    );
  get diagnostics n = row_count; removed := removed + n;

  -- (d) Belt-and-suspenders: drop any lingering blob on a terminal row.
  update public.ct_print_jobs
  set btw_base64 = null
  where btw_base64 is not null and status in ('saved', 'done', 'error');

  return removed;
end;
$$;

grant execute on function public.purge_print_jobs(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3b. purge_unlock_requests — the unlock queue keeps resolved/cancelled rows as
--     history; they are dead weight after a while. Delete closed requests past
--     the window; PENDING requests are always kept (they are live work).
-- -----------------------------------------------------------------------------
create or replace function public.purge_unlock_requests(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz;
  removed integer := 0;
begin
  if current_user = 'authenticated' and not public.is_admin() then
    raise exception 'Admin role required to purge unlock requests';
  end if;

  cutoff := now() - make_interval(days => greatest(retain_days, 1));

  delete from public.ct_unlock_requests
  where status in ('resolved', 'cancelled')
    and coalesce(resolved_at, requested_at) < cutoff;
  get diagnostics removed = row_count;

  return removed;
end;
$$;

grant execute on function public.purge_unlock_requests(integer) to authenticated;

-- Same low-churn tuning as the other tables (insert once, one update to resolve).
alter table public.ct_unlock_requests set (fillfactor = 80);

-- -----------------------------------------------------------------------------
-- 4. One-time reclaim now (null lingering blobs + first purge at 90 days).
-- -----------------------------------------------------------------------------
update public.ct_print_jobs set btw_base64 = null
where btw_base64 is not null and status in ('saved', 'done', 'error');

select public.purge_print_jobs(90);
select public.purge_unlock_requests(90);

commit;

-- -----------------------------------------------------------------------------
-- 5. Auto-schedule nightly cleanup IF pg_cron is installed. Runs outside the
--    main transaction because cron.schedule commits on its own. No-op when the
--    extension is absent — you then run purge_print_jobs(90) from the Admin/SQL
--    editor whenever you like (safe to run any time).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove a prior copy of this job if present, then (re)schedule it.
    if exists (select 1 from cron.job where jobname = 'ct_purge_print_jobs') then
      perform cron.unschedule('ct_purge_print_jobs');
    end if;
    -- 02:30 every day — cleans both the print queue and the unlock queue.
    perform cron.schedule('ct_purge_print_jobs', '30 2 * * *',
                          'select public.purge_print_jobs(90); select public.purge_unlock_requests(90);');
    raise notice 'Scheduled nightly ct_purge_print_jobs via pg_cron.';
  else
    raise notice 'pg_cron not installed — run select public.purge_print_jobs(90); and select public.purge_unlock_requests(90); manually or enable pg_cron.';
  end if;
end;
$$;

-- =============================================================================
-- 6. RUN ONCE, MANUALLY, AFTER THE ABOVE (cannot run inside a transaction).
--    This hands the already-dead space back to the OS and rewrites the tables
--    with their new fillfactor. Do it during a quiet moment; it briefly locks
--    each table. Copy these lines into the SQL editor on their own:
--
--    vacuum (full, analyze) public.ct_print_jobs;
--    vacuum (full, analyze) public.ct_ti_counter;
--    vacuum (full, analyze) public.app_settings;
--    vacuum (full, analyze) public.ct_ti_label_batches;
--    vacuum (full, analyze) public.ct_unlock_requests;
-- =============================================================================
