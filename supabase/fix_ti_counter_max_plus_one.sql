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
