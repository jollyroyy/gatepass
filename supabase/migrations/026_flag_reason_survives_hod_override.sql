-- 026 — the HOD override of a flagged pass could never succeed
--
-- `gatepass.hod_review_flagged_pass` moves a pass from 'flagged' to
-- 'hod_reviewed' but does not touch `flag_reason`. Migration 012 added
--
--     gate_passes_flag_reason_only_when_flagged
--       check (flag_reason is null or status = 'flagged')
--
-- so that UPDATE always aborted with
--
--     new row for relation "gate_passes" violates check constraint
--     "gate_passes_flag_reason_only_when_flagged"
--
-- i.e. the override has been 100% broken since 012 — not intermittently, but
-- for every pass. `flagged_needs_reason` (from 001) guarantees a flagged pass
-- HAS a reason, so there was no escape path: the reason was always present and
-- the new status was never 'flagged'.
--
-- WHY NOT JUST NULL OUT flag_reason IN THE RPC
--
-- Because that destroys the audit trail. The reason a guard rejected material
-- is the single most valuable record on a disputed pass; an override is
-- precisely the moment it must survive. Nulling it would also erase the text
-- the HOD screens display, so the record of *what was overridden* would vanish
-- the instant someone overrode it.
--
-- WHICH STATUSES MAY LEGITIMATELY CARRY A REASON
--
-- `flag_pass` is the ONLY writer of `flag_reason`, and it sets
-- status = 'flagged' in the same UPDATE. So a reason can only ever originate
-- on a flagged pass, and the question is just which states that pass may
-- travel to afterwards:
--
--     pending/held --flag_pass--> flagged
--     flagged      --hod_review_flagged_pass--> hod_reviewed
--     hod_reviewed --match_pass--> matched
--
-- `match_pass` explicitly admits 'hod_reviewed' ("Only a pending, held, or
-- HOD-reviewed pass can be verified"), so a *matched* pass legitimately keeps
-- the reason it was once flagged for. All three states are therefore allowed.
--
-- The original intent is fully preserved: 'pending', 'held' and 'cancelled'
-- still cannot carry a reason, so a pending pass can never hold an accusation
-- nobody acted on — which is exactly what 012 was written to prevent.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_flag_reason_only_when_flagged,
  add  constraint gate_passes_flag_reason_only_when_flagged
    check (flag_reason is null
        or status in ('flagged', 'hod_reviewed', 'matched'));
