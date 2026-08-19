-- ============================================================================
-- 051 — the approval letter goes to WHOEVER HOLDS THE OFFICE TODAY
--
-- FOUND BY MOVING AN OFFICE ON A LIVE LADDER (2026-08-19): the Security Head
-- was re-designated while a pass was still sitting at level 1. The queue moved
-- with the office — `pass_routed_to_me` and `approve_pass_level` (046) both
-- resolve authority through `my_approval_role()`, i.e. from `approval_roles` at
-- the moment of the press — but the MAIL did not: 047's payload joined
-- `pass_approvals.routed_to`, the holder SNAPSHOTTED when the pass was raised.
--
-- So the letter asked a person the database would have refused, while the
-- person who actually had to sign was never written to. That is the worst of
-- the two failure modes: the ladder silently stops, and the only symptom is an
-- inbox that stays empty.
--
-- 047's own comment argued the opposite ("a pass raised under the old COO is
-- still that COO's to sign"). It is superseded, and by 046 rather than by
-- taste: nothing in this schema lets the old COO sign anything. WHAT A PASS
-- OWES IS STILL FROZEN AT RAISE — the set of offices, the levels, the order —
-- and that is untouched here. Only WHO to write to follows the office.
--
-- `routed_to` is kept as the FALLBACK, not deleted: an office that has since
-- been vacated (`clear_approval_role`) has no current holder, and the person
-- the pass was routed to is a better address than none. It also stays the
-- historical record of who the pass was aimed at the day it was raised.
--
-- Nothing else in 047 changes: same name, same jsonb shape, same
-- service_role-only grant. The Edge Function needs no redeploy for this.
-- ============================================================================

create or replace function gatepass.approval_notice_payload(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pass', (
      select jsonb_build_object(
               'id',                   p.id,
               'pass_number',          p.pass_number,
               'type',                 p.type,
               'status',               p.status,
               'visitor_name',         p.visitor_name,
               'purpose',              p.purpose,
               -- The vendor's display name, unpacked from the `{"n","a","v"}`
               -- blob by the schema's own helper. Never `visitor_company` raw —
               -- an email printing a JSON object is how this stops being read.
               'vendor_name',          gatepass.company_name_of(p.visitor_company),
               'department_name',      d.name,
               'raised_by',            p.raised_by,
               'raised_by_name',       rb.full_name,
               'raised_by_email',      rb.email,
               'item_count',           coalesce(it.item_count, 0),
               'total_value',          coalesce(it.total_value, 0),
               'expected_return_date', p.expected_return_date,
               'created_at',           p.created_at
             )
        from gatepass.gate_passes p
        left join public.departments d on d.id = p.department_id
        left join public.profiles   rb on rb.id = p.raised_by
        left join lateral (
               select count(*) as item_count, sum(i.approx_value) as total_value
                 from gatepass.gate_pass_items i
                where i.gate_pass_id = p.id
             ) it on true
       where p.id = p_pass_id
    ),
    'approvals', coalesce((
      -- THE ADDRESS IS THE OFFICE'S CURRENT HOLDER, falling back to the person
      -- the pass was routed to when the office is vacant today. Every join into
      -- VMS's `public.*` is LEFT, the rule the pass view follows: a narrowed VMS
      -- policy must degrade this to an office with no address — which drops ONE
      -- message — rather than to a missing office, which would silently reroute
      -- the mail to the wrong person.
      select jsonb_agg(jsonb_build_object(
               'role_key',       a.role_key,
               'level_no',       a.level_no,
               'status',         a.status,
               'approver_id',    coalesce(r.user_id, a.routed_to),
               'approver_name',  coalesce(cur.full_name, ap.full_name),
               'approver_email', coalesce(cur.email, ap.email),
               'decided_at',     a.decided_at,
               'reason',         a.reason
             ) order by a.level_no)
        from gatepass.pass_approvals a
        left join gatepass.approval_roles r on r.role_key = a.role_key
        left join public.profiles       cur on cur.id = r.user_id
        left join public.profiles        ap on ap.id  = a.routed_to
       where a.gate_pass_id = p_pass_id
    ), '[]'::jsonb)
  );
$$;

comment on function gatepass.approval_notice_payload(uuid) is
  'One approval notification''s worth of facts, addresses included. Each level is addressed to whoever holds that office TODAY (051), falling back to the holder snapshotted at raise when the office is now vacant — the same authority approve_pass_level enforces. service_role ONLY; every signed-in reader uses get_approval_ladder() (043), which carries no address.';

notify pgrst, 'reload schema';
