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
