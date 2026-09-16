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
