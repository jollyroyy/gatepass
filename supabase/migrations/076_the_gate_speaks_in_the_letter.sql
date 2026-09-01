-- ============================================================================
-- 076 — the letter can say what the GATE did
--
-- Client, 2026-09-01: "I want to send it to multiple email IDs about the
-- lifecycle notification or status changes of that same gate pass."
--
-- Until now the mail knew only about the APPROVAL LADDER. A pass could be
-- cleared out of the gate, or stopped at the barrier and closed for ever (070),
-- and nobody was written to at all — the requester found out by opening the
-- app, and the offices whose signatures the gate had just contradicted found out
-- not at all. Worse, `Verify.tsx` has always flashed "the raising department has
-- been notified" after a flag, which was true only of the in-app bell.
--
-- Two new letters need three facts this payload did not carry:
--
--   `flag_reason`       the guard's written justification (035 made it
--                       compulsory, 070 made it final). It is the ONLY thing
--                       that tells a requester what to fix before raising the
--                       new pass they now have to raise, so the mail quotes it
--                       verbatim and never summarises it.
--   `verified_by_name`  who at the gate decided, and
--   `verified_at`       when. A letter that says "security did not clear this"
--                       and cannot say who or when sends its reader hunting.
--
-- ═══ THIS IS 072's FUNCTION WITH THREE KEYS ADDED, AND NOTHING ELSE ═══
--
-- ⚠ READ THIS BEFORE EDITING. `approval_notice_payload` has been redefined five
-- times (047, 051, 054, 055, 068, 072) and each redefinition carries load-
-- bearing work that is INVISIBLE from the shape of the JSON:
--
--   * 051/072: `approver_email` is a THREE-STEP FALLBACK — live delegate, else
--     the office's current holder, else the person the pass was routed to at
--     raise. Writing to the raise-time snapshot alone asks a person the database
--     would refuse, while whoever must actually sign is never written to. 051's
--     own sentence: "the ladder silently stops, and the only symptom is an inbox
--     that stays empty."
--   * 055: the `emergency` key. Its PRESENCE is what tells the sender to write
--     the release letter instead of the ladder one — the caller never says which
--     letter it wants, which is the whole reason a browser cannot make this
--     system claim an approval that did not happen.
--
-- Rebuilding this function from 047's body silently undoes both. It was done
-- once while writing this migration and `tests/security/` caught it — 051, 068
-- and 072 each pin their own clause. Copy the CURRENT body, add to it, and let
-- those specs check the result.
--
-- ═══ WHY A LATERAL OVER `verifications` AND NOT A COLUMN ═══
--
-- `gate_passes` records the OUTCOME (`status`, `flag_reason`); `verifications`
-- records the ACT, and it is the only place the actor and the moment exist. 001
-- indexes it on `(gate_pass_id, created_at desc)`, which is exactly this lookup,
-- so the newest row is an index hit and not a scan.
--
-- ORDER BY created_at DESC LIMIT 1 — the LAST word the gate had. A pass can
-- carry several rows (an RGP's returns each write one, and
-- `hod_void_expired_pass` writes one too), and the letter is about the decision
-- just taken.
--
-- ═══ WHAT THIS MIGRATION DOES NOT DO ═══
--
-- No table, no column, no policy, no grant. The function keeps its signature, so
-- 047's `revoke … from public` / `grant execute … to service_role` still stands
-- and is not restated: no signed-in role gains anything, because this payload
-- carries the office holders' addresses. The gate's own facts are already
-- readable by anyone who can read the pass, through `v_gate_passes`.
--
-- The Edge Function reads the three new keys DEFENSIVELY, so a function deployed
-- against a database that has not yet run this migration still sends its ladder
-- mail — a missing key is a missing FACT, never a failed send.
-- ============================================================================

create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select (
    select jsonb_build_object(
      'pass', (
        select jsonb_build_object(
                 'id',                   p.id,
                 'pass_number',          p.pass_number,
                 'type',                 p.type,
                 'status',               p.status,
                 'visitor_name',         p.visitor_name,
                 'purpose',              p.purpose,
                 'vendor_name',          gatepass.company_name_of(p.visitor_company),
                 'department_name',      d.name,
                 'raised_by',            p.raised_by,
                 'raised_by_name',       rb.full_name,
                 -- THE RAISER IS ON EVERY LETTER ABOUT THEIR OWN PASS since
                 -- 2026-09-01, so this address is load-bearing on all of them
                 -- and no longer only on the `fully_approved` receipt.
                 'raised_by_email',      rb.email,
                 'item_count',           coalesce(it.item_count, 0),
                 'total_value',          coalesce(it.total_value, 0),
                 'expected_return_date', p.expected_return_date,
                 'created_at',           p.created_at,
                 -- ─── 076: what the gate did ───────────────────────────────
                 -- The guard's written reason for stopping it. Null on every
                 -- pass the gate has not flagged; 001's check constraint is
                 -- what guarantees it is non-empty when `status = 'flagged'`.
                 'flag_reason',          p.flag_reason,
                 -- Who decided at the gate, and when. Null on every pass still
                 -- on the ladder, which the letter renders as an absent fact
                 -- rather than as "by null on null".
                 'verified_by_name',     vf.security_name,
                 'verified_at',          vf.created_at
               )
          from gatepass.gate_passes p
          left join public.departments d on d.id = p.department_id
          left join public.profiles   rb on rb.id = p.raised_by
          left join lateral (
                 select count(*) as item_count, sum(i.approx_value) as total_value
                   from gatepass.gate_pass_items i
                  where i.gate_pass_id = p.id
               ) it on true
          -- THE GATE'S LAST WORD. 001 indexes `(gate_pass_id, created_at desc)`,
          -- so this is an index hit. LEFT, and LEFT again into VMS's profiles:
          -- a narrowed VMS policy must degrade this to a letter with no name in
          -- it, never to no letter.
          left join lateral (
                 select v.created_at, sp.full_name as security_name
                   from gatepass.verifications v
                   left join public.profiles sp on sp.id = v.security_user_id
                  where v.gate_pass_id = p.id
                  order by v.created_at desc
                  limit 1
               ) vf on true
         where p.id = p_pass_id
      ),
      'approvals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'role_key',       a.role_key,
                 'level_no',       a.level_no,
                 'status',         a.status,
                 -- 051/072's three-step fallback. Do not simplify: see the
                 -- header. Live delegate → current holder → raise-time snapshot.
                 'approver_id',    coalesce(dg.delegate_id, r.user_id, a.routed_to),
                 'approver_name',  coalesce(dp.full_name, cur.full_name, ap.full_name),
                 'approver_email', coalesce(dp.email, cur.email, ap.email),
                 'delegated',      (dg.delegate_id is not null),
                 'holder_name',    cur.full_name,
                 'decided_at',     a.decided_at,
                 'reason',         a.reason
               ) order by a.level_no)
          from gatepass.pass_approvals a
          left join gatepass.approval_roles r on r.role_key = a.role_key
          left join public.profiles       cur on cur.id = r.user_id
          left join public.profiles        ap on ap.id  = a.routed_to
          left join lateral (
                 select dd.delegate_id
                   from gatepass.approval_delegations dd
                  where dd.role_key = a.role_key
                    and gatepass.delegation_is_live(dd.revoked_at, dd.starts_at, dd.ends_at)
                  order by dd.starts_at desc
                  limit 1
               ) dg on true
          left join public.profiles        dp on dp.id = dg.delegate_id
         where a.gate_pass_id = p_pass_id
      ), '[]'::jsonb)
    )
  )
  || jsonb_build_object(
       'emergency', (
         select jsonb_build_object(
                  'released_at',   e.released_at,
                  'released_name', rp.full_name,
                  'reason',        e.reason,
                  'reviewed_at',   e.reviewed_at
                )
           from gatepass.emergency_releases e
           left join public.profiles rp on rp.id = e.released_by
          where e.gate_pass_id = p_pass_id
       )
     );
$fn$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One notification''s worth of facts, addresses included (047/051/072), plus the emergency release that cleared this pass if there was one (055), plus the gate''s own decision and the guard who took it (076). Each level is addressed to whoever may SIGN it today — the live delegate, else the office''s current holder, else the holder snapshotted at raise. The presence of the `emergency` key is what tells the sender which letter to write — the caller never says. service_role ONLY.';

notify pgrst, 'reload schema';
