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
