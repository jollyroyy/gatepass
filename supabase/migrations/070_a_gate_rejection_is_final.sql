-- ============================================================================
-- 070 — A REJECTION AT THE GATE IS FINAL. The pass is closed and a new one is
--       raised; there is no review, no override and no second round.
--
-- Client, 2026-08-31: "once a guard rejects a pass he has to mention the
-- justification as to why is he rejecting the pass and then the entire pass
-- will be cancelled and a new pass needs to be raised."
--
-- THE JUSTIFICATION WAS ALREADY MANDATORY — `flag_pass` (035) refuses a blank
-- `p_reason` and writes it to both `gate_passes.flag_reason` and a
-- `verifications` row. Nothing about that changes, and this migration
-- deliberately does not re-issue the function: it is already exactly what the
-- client asked for.
--
-- WHAT CHANGES IS WHAT HAPPENS NEXT. Since 015 a flagged pass went BACK to the
-- raising HOD, who either upheld the flag (→ `cancelled`) or overrode it
-- (→ `hod_reviewed`, with `expires_at` refreshed to the end of the day so the
-- same material could be walked back to the same barrier). That override is
-- what the client has now removed: the guard's refusal is the end of the pass.
-- So `hod_review_flagged_pass` is DROPPED — not left in place unused, because
-- an unused SECURITY DEFINER function is still EXECUTE-able over PostgREST by
-- every authenticated user, and this one can move a pass's status.
--
-- `flagged` IS NOW A TERMINAL STATUS, and that is the whole state-machine
-- change. It was already terminal at the barrier — `match_pass` admits only
-- `pending` and `hod_reviewed`, so no guard could ever clear a flagged pass —
-- and `hod_review_flagged_pass` was the single door out of it. With that door
-- gone, a flagged pass can never move again by any path: it is closed, exactly
-- as a cancelled one is, and the portal says so in those words. It keeps its
-- own label rather than being folded into `cancelled` on purpose — "security
-- stopped this at the gate, and here is what they wrote" is a different fact
-- from "the HOD voided it", and a record that cannot tell them apart cannot
-- answer why a pass died. Every report already grades the two together.
--
-- THE 7 PASSES SITTING IN `flagged` TODAY ARE NOT MIGRATED. They are closed by
-- this change where they stand, which is the client's rule applied to them —
-- and rewriting a status somebody was notified about would be inventing an
-- event nobody performed. Their raising HODs raise replacements, the same as
-- for a pass flagged tomorrow.
--
-- NOT TOUCHED, deliberately:
--   * `hod_reviewed` — 3 live passes still hold that status, cleared by an HOD
--     before today's rule. The gate must still be able to finish them, so
--     `match_pass` and `flag_pass` go on admitting it. Nothing can ENTER the
--     status any more; the enum label survives because Postgres cannot drop
--     one, and it is now a historical value only.
--   * `hod_void_expired_pass` (041) — an EXPIRED pass is a different door and
--     the client did not close it: nobody stopped that material, it simply
--     never travelled, and the raising HOD still voids it themselves.
-- ============================================================================

-- The one door out of `flagged`, removed. `revoke` first is redundant with the
-- drop and stated anyway: if a later migration ever recreates this function by
-- copy-paste, the intent above is what a reader finds in the history.
revoke all on function gatepass.hod_review_flagged_pass(uuid, text, text) from public;
drop function if exists gatepass.hod_review_flagged_pass(uuid, text, text);

comment on function gatepass.flag_pass(uuid, text, text, jsonb, jsonb) is
  'The guard refuses a pass at the barrier, in writing. The written reason is mandatory (035) and the refusal is FINAL (070): the pass is closed, nothing can move it again, and the raising department raises a replacement.';

notify pgrst, 'reload schema';
