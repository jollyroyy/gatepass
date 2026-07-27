-- ============================================================================
-- 009 — Restore the narrow grants that migration 002 intended
--
-- WHAT WENT WRONG
--
-- Adding `gatepass` to Project Settings → API → Exposed schemas in the Supabase
-- dashboard does more than flip a PostgREST setting. It also runs, once:
--
--     grant all on all tables in schema gatepass to anon, authenticated, service_role;
--
-- That silently overwrote the deliberately narrow grants in 002. Probed live on
-- 2026-07-27, BEFORE this migration, the real database held:
--
--     anon          | gate_passes | DELETE, INSERT, SELECT, UPDATE
--     authenticated | gate_passes | DELETE, INSERT, SELECT, UPDATE
--     service_role  | gate_passes | DELETE, INSERT, SELECT, UPDATE
--
-- against CLAUDE.md's documented invariant: "No client holds UPDATE on
-- gatepass.gate_passes (migration 002 grants only select, insert)."
--
-- WHY THE APP WAS NOT ACTUALLY BROKEN
--
-- RLS held the line on its own. gate_passes has RLS enabled with exactly two
-- policies — gate_passes_select and gate_passes_insert, both scoped to
-- `authenticated`. There is no UPDATE policy and no DELETE policy, so an UPDATE
-- was refused for want of a policy even while the GRANT existed. `anon` has no
-- policy at all, so it could not read or write a single row despite holding
-- every table privilege.
--
-- So this is not an incident. It is the loss of a layer of defence in depth,
-- which matters because the remaining layer is one mistake deep: the day anyone
-- adds a `for all` or `using (true)` policy for convenience, the grants are
-- already sitting there to make it catastrophic — and for `anon`, unauthenticated.
--
-- WHY THE STATIC TEST DID NOT CATCH IT
--
-- tests/security/sqlInvariants.test.ts greps the migration FILES for update/delete
-- grants. The files are clean; the database was not. A grep over source can never
-- see drift introduced through the dashboard. Live verification is the only thing
-- that can, which is what scripts/verify-rls.mjs is for.
--
-- THIS WILL COME BACK if someone re-toggles Exposed schemas. Re-run this file if
-- verify-rls.mjs reports the wide grants again. It is idempotent.
--
-- Nothing here touches `public` — VMS owns that schema (the two-schema rule).
-- ============================================================================

-- ─── anon: nothing, anywhere ────────────────────────────────────────────────
-- Every route in this app requires a session. anon exists only to reach GoTrue
-- for sign-in, which does not go through PostgREST and needs no table grant.
revoke all on all tables in schema gatepass from anon;
revoke all on all sequences in schema gatepass from anon;
revoke all on all functions in schema gatepass from anon;
revoke usage on schema gatepass from anon;

-- ─── authenticated: read, plus insert only where a policy expects it ────────
-- Start from zero rather than revoking named privileges one by one, so this
-- converges on the intended set no matter what state it is run against.
revoke all on all tables in schema gatepass from authenticated;

grant usage on schema gatepass to authenticated;

-- State transitions are RPC-only. INSERT is granted because raising a pass is a
-- plain insert guarded by gate_passes_insert; UPDATE and DELETE are deliberately
-- absent so that match_pass / flag_pass / mark_returned / cancel_pass remain the
-- only ways a row can ever change. Do not add them back.
grant select, insert on gatepass.gate_passes    to authenticated;

-- Append-only audit trail, written exclusively by the security definer RPCs.
grant select                on gatepass.verifications  to authenticated;

-- The admin UI assigns and unassigns HODs; both are policy-guarded.
grant select, insert, delete on gatepass.hod_departments to authenticated;

-- Read-only projections. RLS is enforced through them because both carry
-- with (security_invoker = true).
grant select on gatepass.v_gate_passes  to authenticated;
grant select on gatepass.v_verifications to authenticated;
grant select on gatepass.profile_names   to authenticated;

-- Failed-scan log: readable (the policy narrows it to security), never writable
-- from a client — only lookup_pass inserts here.
grant select on gatepass.scan_attempts to authenticated;

-- ─── service_role: the narrowest set that unblocks verify-rls.mjs ───────────
-- Deliberately NO privilege of any kind on gate_passes. The RPC-only state
-- machine has to hold even for the service key, otherwise a leaked key could
-- rewrite gate history directly and the audit trail would be worthless.
-- The cost is real and accepted: verify-rls.mjs cannot delete the pass it raises,
-- so it prints manual cleanup SQL instead. Do not "fix" that by granting here.
revoke all on all tables in schema gatepass from service_role;

grant usage on schema gatepass to service_role;
grant select, insert, delete on gatepass.hod_departments to service_role;
grant select on gatepass.verifications to service_role;
