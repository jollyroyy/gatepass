-- ============================================================================
-- 050 — the mail log can actually be written
--
-- FOUND BY THE FIRST REAL SEND, not by review. `verify-047.mjs` raised a pass,
-- the Edge Function mailed the Security Head, RESEND ACCEPTED IT — and
-- `gatepass.email_log` was empty afterwards. 047 created the table, enabled
-- RLS, wrote the admin SELECT policy and granted `select` to `authenticated`,
-- and then relied on "the service role bypasses RLS" for the write. It does
-- bypass RLS. It does NOT conjure a table PRIVILEGE it was never granted:
-- a fresh schema inherits no Supabase grants (002/007/009 exist for exactly
-- this reason), so `service_role` held nothing at all on this table and the
-- insert failed with 42501 — swallowed by design, because the function must
-- never let a logging failure abort a delivery that already happened.
--
-- The cost of leaving it: every send is unlogged, which makes "the CEO says he
-- never got it" unanswerable — the one question the table exists to answer.
--
-- INSERT ONLY. No select, no update, no delete: the sender writes the log and
-- reads nothing back, an admin reads it through the policy 047 wrote, and a log
-- that its own writer can rewrite is not evidence of anything.
-- ============================================================================

grant insert on gatepass.email_log to service_role;

comment on table gatepass.email_log is
  'Every approval notification send attempt, successful or not. Written only by the notify-approval Edge Function under the service role (insert granted in 050); readable by admins. Retention is manual — trim it when it grows.';

notify pgrst, 'reload schema';
