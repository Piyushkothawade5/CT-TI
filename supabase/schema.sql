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
