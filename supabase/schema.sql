-- CT Technical Instruction Supabase schema
-- Run this file in the Supabase SQL Editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.ct_items (
  id uuid primary key default gen_random_uuid(),
  item_no text not null unique,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists ct_ti_records_item_no_idx on public.ct_ti_records (item_no);
create index if not exists ct_ti_records_customer_name_idx on public.ct_ti_records (customer_name);
create index if not exists ct_ti_records_wo_number_idx on public.ct_ti_records (wo_number);
create index if not exists ct_ti_records_ct_type_idx on public.ct_ti_records (ct_type);
create index if not exists ct_items_ct_type_idx on public.ct_items (ct_type);

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
language sql
stable
as $$
  select public.format_ti_no(current_value + 1)
  from public.ct_ti_counter
  where id = true;
$$;

create or replace function public.allocate_ti_number(preferred_ti_no text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value integer;
  next_ti_no text;
begin
  if preferred_ti_no is not null and preferred_ti_no <> '' then
    if exists (select 1 from public.ct_ti_records where ti_no = preferred_ti_no) then
      raise exception 'TI number already exists: %', preferred_ti_no;
    end if;

    select current_value + 1 into next_value
    from public.ct_ti_counter
    where id = true
    for update;

    next_ti_no := public.format_ti_no(next_value);

    if preferred_ti_no = next_ti_no then
      update public.ct_ti_counter
      set current_value = next_value,
          updated_at = now()
      where id = true;
    end if;

    return preferred_ti_no;
  end if;

  update public.ct_ti_counter
  set current_value = current_value + 1,
      updated_at = now()
  where id = true
  returning current_value into next_value;

  return public.format_ti_no(next_value);
end;
$$;

alter table public.ct_items enable row level security;
alter table public.ct_ti_records enable row level security;
alter table public.ct_ti_counter enable row level security;

drop policy if exists "Allow app read items" on public.ct_items;
create policy "Allow app read items"
on public.ct_items for select
to anon, authenticated
using (true);

drop policy if exists "Allow app write items" on public.ct_items;
create policy "Allow app write items"
on public.ct_items for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow app read ti records" on public.ct_ti_records;
create policy "Allow app read ti records"
on public.ct_ti_records for select
to anon, authenticated
using (true);

drop policy if exists "Allow app write ti records" on public.ct_ti_records;
create policy "Allow app write ti records"
on public.ct_ti_records for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow app read ti counter" on public.ct_ti_counter;
create policy "Allow app read ti counter"
on public.ct_ti_counter for select
to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.ct_items to anon, authenticated;
grant select, insert, update, delete on public.ct_ti_records to anon, authenticated;
grant select on public.ct_ti_counter to anon, authenticated;
grant execute on function public.preview_ti_number() to anon, authenticated;
grant execute on function public.allocate_ti_number(text) to anon, authenticated;
grant execute on function public.sync_ti_counter_from_records() to anon, authenticated;
