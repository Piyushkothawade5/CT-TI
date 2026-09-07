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

-- ---------------------------------------------------------------------------
-- 7. unlock_ti_labels — admin clears the lock (and any stuck reservations)
-- ---------------------------------------------------------------------------
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
  if p_new_qty is not null and p_new_qty < rec.labels_issued then
    raise exception 'New quantity (%) is below labels already printed (%)', p_new_qty, rec.labels_issued;
  end if;

  update public.ct_ti_records
  set label_qty = coalesce(p_new_qty, label_qty),
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
grant execute on function public.unlock_ti_labels(text, integer) to authenticated;
