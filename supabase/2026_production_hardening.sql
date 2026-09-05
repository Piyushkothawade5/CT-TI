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
