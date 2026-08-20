-- ============================================================================
-- 053 - the CEO OFFICE decides whitelist requests, and can see them
--
-- Client, 2026-08-20: "when the CEO role is logged in, he should also be able
-- to see all the whitelist requests with the reason and should be able to
-- approve or reject."
--
-- TWO THINGS WERE IN THE WAY, and both are fixed here.
--
-- 1. `list_whitelist_requests` (039) filters on `gatepass.is_admin()`. The CEO
--    could DECIDE a request (`approve_whitelist_request` / `reject_...` check
--    `is_ceo()`) but could not LIST one unless they also happened to be an
--    admin — a queue nobody who may act on it can read. It now admits
--    `is_admin() or is_ceo()`.
--
-- 2. `is_ceo()` reads `gatepass.ceo_approver` (039) alone — a designation a
--    SUPER_ADMIN makes, restricted to admin accounts. The person the client
--    calls "the CEO" is the holder of the CEO office on the approval ladder
--    (`gatepass.approval_roles`, 043/046), who is a VMS `staff` account and
--    could never be named in `ceo_approver` at all. `is_ceo()` is therefore
--    widened to be true for EITHER designation.
--
-- ⚠ THIS DELIBERATELY REVERSES 043's SEPARATION, ON THE CLIENT'S INSTRUCTION.
--   043's header says naming somebody CEO on a gate pass must not silently hand
--   them the blacklist override 039 exists to protect, and that argument is
--   still true — the client has decided the two offices are one person and that
--   that person decides both. What this means in practice, stated plainly:
--   designating a CEO in Admin → Users → "Gate pass approval ladder" NOW ALSO
--   grants the power to take a vendor off the blacklist. If the two are ever
--   meant to be different people again, the fix is to narrow `is_ceo()` back to
--   `ceo_approver` and give the ladder CEO their own read-only view.
--
--   `sqlInvariants`'s rule that 043 never mentions `ceo_approver` still holds:
--   043 is unchanged, and this is a later, deliberate migration.
--
-- Both offices are single-holder by construction — `ceo_approver` has a
-- boolean primary key, `approval_roles` is keyed by `role_key` and 049 adds a
-- unique index on `user_id` — so "who is the CEO" still has at most two
-- answers, each of them one person, and no ordering decides anything.
-- ============================================================================

create or replace function gatepass.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.ceo_approver c where c.user_id = auth.uid()
  ) or exists (
    select 1 from gatepass.approval_roles r
     where r.role_key = 'ceo' and r.user_id = auth.uid()
  );
$$;

grant execute on function gatepass.is_ceo() to authenticated;

-- Unchanged from 039 except the one predicate: the CEO may read the queue they
-- are the only person able to clear. Still SECURITY DEFINER, still
-- `set search_path = ''`, still ordered newest request first.
create or replace function gatepass.list_whitelist_requests(p_status text default null)
returns table (
  id              uuid,
  blacklist_id    uuid,
  list_type       text,
  list_value      text,
  blocked_reason  text,
  justification   text,
  requested_by    uuid,
  requested_by_name text,
  requested_at    timestamptz,
  status          text,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.blacklist_id, r.list_type, r.list_value, r.blocked_reason,
    r.justification, r.requested_by, rn.full_name, r.requested_at,
    r.status, dn.full_name, r.decided_at, r.decision_note
  from gatepass.whitelist_requests r
  left join gatepass.profile_names rn on rn.id = r.requested_by
  left join gatepass.profile_names dn on dn.id = r.decided_by
  where (gatepass.is_admin() or gatepass.is_ceo())
    and (p_status is null or r.status = p_status)
  order by r.requested_at desc;
$$;

grant execute on function gatepass.list_whitelist_requests(text) to authenticated;

notify pgrst, 'reload schema';
