-- ============================================================================
-- 039 - taking a vendor OFF the blacklist needs a justification and the CEO
--
-- Until now `remove_blacklist_entry(uuid)` (016) let any admin delete a
-- blacklist row outright: one click, no reason recorded, no second pair of
-- eyes. Blacklisting is the one control that can stop a vendor at the gate,
-- so the ability to quietly undo it is the ability to quietly disable the
-- control. Business rule (client, 2026-08-13): an admin may only REQUEST
-- whitelisting, must state why, and the entry stays enforced until the CEO
-- approves.
--
-- `remove_blacklist_entry` is DROPPED, not left beside the new flow. Leaving
-- it would make the whole approval chain optional -- the browser could call
-- the old RPC directly and the CEO would never see the request. Its only
-- caller (BlacklistTab's Remove button) is replaced in the same change.
--
-- WHO IS THE CEO. There is no `ceo` role to check: `public.user_role` is
-- VMS-owned (guard / hod / admin / super_admin / staff) and this app must
-- never alter `public` (the two-schema rule). So the CEO is a DESIGNATED
-- ACCOUNT, held in `gatepass.ceo_approver` -- exactly one row, enforced by a
-- boolean primary key that can only ever be true.
--
-- Two guards on that designation, both load-bearing:
--   * Only a super_admin may set it. If an admin could nominate the CEO they
--     would nominate themselves, approve their own request, and the control
--     is back to one click by one person.
--   * The designee must be an admin or super_admin. The approval screens live
--     under /admin, which ROLE_ROUTES opens to admins only, so designating a
--     guard or an HOD would create a CEO who cannot reach the queue.
--
-- WHY THE REQUEST OUTLIVES THE ENTRY. Approval DELETES the blacklist row, so
-- `blacklist_id` is nullable with ON DELETE SET NULL and the request keeps its
-- own snapshot of what was unblocked (`list_type` / `list_value` / the
-- original `reason`). ON DELETE CASCADE would erase the audit trail at the
-- exact moment it becomes the only record that the vendor was ever blocked,
-- and why they were let back in.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The designated CEO
-- ═══════════════════════════════════════════════════════════════════════════
-- `only_row` is a boolean PK constrained to true: at most one row can exist,
-- so "who is the CEO" has exactly one answer and no ordering or `limit 1`
-- anywhere has to decide it.
create table if not exists gatepass.ceo_approver (
  only_row       boolean primary key default true,
  user_id        uuid not null references public.profiles(id),
  designated_by  uuid not null references public.profiles(id),
  designated_at  timestamptz not null default now(),

  constraint ceo_approver_single_row check (only_row)
);

alter table gatepass.ceo_approver enable row level security;

-- Admins (and therefore the CEO, who is one) may read who the approver is.
-- Nobody holds INSERT/UPDATE/DELETE -- the RPC below is the only writer.
drop policy if exists ceo_approver_select_admin on gatepass.ceo_approver;
create policy ceo_approver_select_admin
  on gatepass.ceo_approver for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.ceo_approver to authenticated;

-- True only for the one designated account. Used by the approve/reject RPCs.
create or replace function gatepass.is_ceo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.ceo_approver c where c.user_id = auth.uid()
  );
$$;

grant execute on function gatepass.is_ceo() to authenticated;

create or replace function gatepass.set_ceo_approver(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if gatepass.app_role() <> 'super_admin' then
    raise exception 'Only a super admin can designate the CEO approver.';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_user_id;
  if v_role is null then
    raise exception 'That user does not exist.';
  end if;
  if v_role not in ('admin', 'super_admin') then
    raise exception 'The CEO approver must be an admin account — the approval queue lives in the admin panel.';
  end if;

  insert into gatepass.ceo_approver (only_row, user_id, designated_by, designated_at)
  values (true, p_user_id, auth.uid(), now())
  on conflict (only_row) do update
    set user_id = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- Who the CEO is, by name. Returns no rows when nobody is designated yet --
-- which the admin screen must say out loud, because in that state no
-- whitelist request can ever be approved.
create or replace function gatepass.get_ceo_approver()
returns table (user_id uuid, full_name text, designated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, n.full_name, c.designated_at
  from gatepass.ceo_approver c
  left join gatepass.profile_names n on n.id = c.user_id
  where gatepass.is_admin();
$$;

grant execute on function gatepass.set_ceo_approver(uuid) to authenticated;
grant execute on function gatepass.get_ceo_approver()    to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Whitelist requests
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists gatepass.whitelist_requests (
  id             uuid primary key default gen_random_uuid(),
  blacklist_id   uuid references gatepass.blacklist(id) on delete set null,

  -- Snapshot of what was blocked, so an approved request still says what it
  -- unblocked after the blacklist row is gone.
  list_type      text not null,
  list_value     text not null,
  blocked_reason text not null,

  justification  text not null,
  requested_by   uuid not null references public.profiles(id),
  requested_at   timestamptz not null default now(),

  status         text not null default 'pending',
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decision_note  text,

  constraint whitelist_requests_status_valid
    check (status in ('pending', 'approved', 'rejected')),
  -- 10 characters is not a quality bar; it is a floor that stops "ok" and "."
  -- from satisfying a mandatory field.
  constraint whitelist_requests_justification_substantive
    check (length(trim(justification)) >= 10),
  -- A pending request has no decision; a decided one has both who and when.
  constraint whitelist_requests_decision_consistent
    check (
      (status = 'pending'  and decided_by is null and decided_at is null)
      or (status <> 'pending' and decided_by is not null and decided_at is not null)
    ),
  constraint whitelist_requests_rejection_has_note
    check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) > 0)
);

-- One open request per blacklist entry. Partial, so a vendor rejected once can
-- be asked about again later with a better justification.
create unique index if not exists whitelist_requests_one_pending_per_entry
  on gatepass.whitelist_requests (blacklist_id)
  where status = 'pending';

create index if not exists whitelist_requests_status_idx
  on gatepass.whitelist_requests (status, requested_at desc);

alter table gatepass.whitelist_requests enable row level security;

drop policy if exists whitelist_requests_select_admin on gatepass.whitelist_requests;
create policy whitelist_requests_select_admin
  on gatepass.whitelist_requests for select to authenticated
  using (gatepass.is_admin());

grant select on gatepass.whitelist_requests to authenticated;

-- ─── Request (admin) ────────────────────────────────────────────────────────
create or replace function gatepass.request_vendor_whitelist(
  p_blacklist_id  uuid,
  p_justification text
)
returns gatepass.whitelist_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry   gatepass.blacklist;
  v_request gatepass.whitelist_requests;
begin
  if not gatepass.is_admin() then
    raise exception 'Only admins can request whitelisting.';
  end if;

  if length(trim(coalesce(p_justification, ''))) < 10 then
    raise exception 'A justification is required — say why this vendor should be whitelisted.';
  end if;

  select * into v_entry from gatepass.blacklist b where b.id = p_blacklist_id;
  if not found then
    raise exception 'Blacklist entry not found.';
  end if;

  if exists (
    select 1 from gatepass.whitelist_requests r
    where r.blacklist_id = p_blacklist_id and r.status = 'pending'
  ) then
    raise exception 'A whitelist request for this entry is already awaiting CEO approval.';
  end if;

  insert into gatepass.whitelist_requests (
    blacklist_id, list_type, list_value, blocked_reason,
    justification, requested_by
  )
  values (
    v_entry.id, v_entry.list_type, v_entry.list_value, v_entry.reason,
    trim(p_justification), auth.uid()
  )
  returning * into v_request;

  return v_request;
end;
$$;

-- ─── Read (admin + CEO) ─────────────────────────────────────────────────────
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
  where gatepass.is_admin()
    and (p_status is null or r.status = p_status)
  order by r.requested_at desc;
$$;

-- ─── Approve (CEO only) ─────────────────────────────────────────────────────
-- Approval is what actually deletes the blacklist row. Doing it here rather
-- than leaving the admin to delete it afterwards is the whole point: there is
-- no code path that removes an entry without a recorded approval.
create or replace function gatepass.approve_whitelist_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request gatepass.whitelist_requests;
begin
  if not gatepass.is_ceo() then
    raise exception 'Only the designated CEO can approve a whitelist request.';
  end if;

  select * into v_request from gatepass.whitelist_requests r where r.id = p_id;
  if not found then
    raise exception 'Whitelist request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  -- Order matters only for readability: the delete NULLs blacklist_id via
  -- ON DELETE SET NULL, and the snapshot columns keep the record complete.
  update gatepass.whitelist_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  delete from gatepass.blacklist where id = v_request.blacklist_id;
end;
$$;

-- ─── Reject (CEO only) ──────────────────────────────────────────────────────
-- The note is mandatory: a rejection with no reason tells the admin nothing
-- about whether to re-submit.
create or replace function gatepass.reject_whitelist_request(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not gatepass.is_ceo() then
    raise exception 'Only the designated CEO can decide a whitelist request.';
  end if;

  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'A reason is required to reject a whitelist request.';
  end if;

  select r.status into v_status from gatepass.whitelist_requests r where r.id = p_id;
  if v_status is null then
    raise exception 'Whitelist request not found.';
  end if;
  if v_status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  update gatepass.whitelist_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note)
   where id = p_id;
end;
$$;

grant execute on function gatepass.request_vendor_whitelist(uuid, text)   to authenticated;
grant execute on function gatepass.list_whitelist_requests(text)          to authenticated;
grant execute on function gatepass.approve_whitelist_request(uuid)        to authenticated;
grant execute on function gatepass.reject_whitelist_request(uuid, text)   to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The one-click removal is gone
-- ═══════════════════════════════════════════════════════════════════════════
-- Dropped rather than revoked: an EXECUTE-able SECURITY DEFINER function that
-- no screen calls is attack surface nobody reviews (CLAUDE.md).
drop function if exists gatepass.remove_blacklist_entry(uuid);

notify pgrst, 'reload schema';
