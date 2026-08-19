-- ============================================================================
-- 043 - the gate pass approval ladder gets NAMES
--
-- The printed slip has carried five approval signatures since the beginning
-- (src/pages/Shared/signatureBlocks.ts):
--
--     Issuing HOD -> Security Head -> COO -> CEO -> Finance HOD
--
-- and then, at the gate: Security Verification -> Receiver.
--
-- On paper those are blank boxes somebody signs and stamps. On screen the
-- record showed none of it, so a reader could not tell WHO was supposed to have
-- signed. Client, 2026-08-19: the gate pass detail must show the ladder, level
-- by level, with the approver's name and department -- "just match the print
-- slip".
--
-- WHAT THIS IS NOT. It is not an approval WORKFLOW. Nothing here gates the
-- gate: `match_pass` is unchanged, no pass waits on a level, and no new queue
-- exists. The sign-off is still the wet signature on the printed A5 slip. This
-- migration answers exactly one question -- "who holds each of those four
-- offices right now" -- so the screen can print the name beside the level
-- instead of an empty box. Deciding otherwise later means a real
-- `pass_approvals` table keyed by pass; this table would then become its
-- default routing, not its record.
--
-- WHY NOT REUSE `gatepass.ceo_approver` (039). That row is a PERMISSION: whoever
-- holds it can approve a whitelist request and let a blacklisted vendor back
-- through the gate. This table is an ORG CHART -- a name printed on a record.
-- Folding the two together would mean that naming the CEO on a gate pass
-- silently hands them the blacklist override, which is precisely the control
-- 039 exists to protect. Two facts, two tables, on purpose.
--
-- WHY `role_key` IS TEXT WITH A CHECK, NOT AN ENUM. APPLY_ALL.sql is pasted as
-- ONE transaction and a new enum value cannot be USED in the transaction that
-- adds it -- naming a fresh label inside a `check (...)` aborts the whole
-- paste. A text column with a literal check has neither problem and mirrors
-- `whitelist_requests.status` (039), which is text for the same reason.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Who holds each office
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per office, at most. `role_key` is the primary key, so "who is the
-- COO" has exactly one answer and no ordering or `limit 1` anywhere has to
-- decide it -- the same shape `ceo_approver` gets from its single-row boolean.
--
-- ON DELETE RESTRICT on `user_id`: an office holder cannot be deleted out from
-- under the ladder, leaving passes printed with a name that resolves to
-- nothing. Vacate the office first (see `clear_approval_role` below).
create table if not exists gatepass.approval_roles (
  role_key       text primary key,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  designated_by  uuid not null references public.profiles(id),
  designated_at  timestamptz not null default now(),

  -- The four offices between the issuing HOD and the gate, in slip order. A
  -- fifth office is a migration, not a free-text row: every screen renders the
  -- ladder from a fixed Record and an unknown key would render nowhere.
  constraint approval_roles_key_known
    check (role_key in ('security_head', 'coo', 'ceo', 'finance_head'))
);

alter table gatepass.approval_roles enable row level security;

-- EVERY app user may read the ladder, and that is deliberate: the four names
-- are printed on the face of every gate pass that leaves the building, so a
-- guard holding the paper already has them. Restricting the screen to admins
-- would mean the guard reading the slip could not check it against the record.
-- Nobody holds INSERT/UPDATE/DELETE -- the two RPCs below are the only writers.
drop policy if exists approval_roles_select_all on gatepass.approval_roles;
create policy approval_roles_select_all
  on gatepass.approval_roles for select to authenticated
  using (true);

grant select on gatepass.approval_roles to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Reading the ladder, with names and departments
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER because it needs two columns `gatepass.profile_names`
-- deliberately does not carry -- the department -- and that view's own comment
-- forbids widening it ("Do NOT add columns here"). Same route
-- `get_ceo_approver` (039) takes for the same reason.
--
-- What it exposes is the display name and department of at most four
-- designated officers. That is strictly less than the printed slip already
-- shows to anyone holding it, and nothing about any other account.
--
-- LEFT JOINs on purpose, the rule the pass view follows: VMS can narrow its own
-- policies without notice, and an inner join would make an office vanish from
-- the ladder entirely. A left join degrades to a null name -- visibly wrong
-- beats invisibly missing.
create or replace function gatepass.get_approval_ladder()
returns table (
  role_key        text,
  user_id         uuid,
  full_name       text,
  department_name text,
  designated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.role_key,
         r.user_id,
         p.full_name,
         d.name as department_name,
         r.designated_at
    from gatepass.approval_roles r
    left join public.profiles    p on p.id = r.user_id
    left join public.departments d on d.id = p.department_id
   where gatepass.app_role() is not null
   order by case r.role_key
              when 'security_head' then 1
              when 'coo'           then 2
              when 'ceo'           then 3
              when 'finance_head'  then 4
            end;
$$;

grant execute on function gatepass.get_approval_ladder() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Designating and vacating an office
-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN, not super_admin. Unlike the CEO designation this grants no power: the
-- holder gains no route, no RPC and no ability to approve anything. It only
-- decides which name is printed beside a level, which is the same kind of fact
-- as a department's name -- and that is admin-editable already.
--
-- NO ROLE RESTRICTION on the designee. The Security Head is plausibly a `guard`
-- account, the COO and the Finance Head plausibly `staff` or `admin`. Requiring
-- a particular role here would make offices undesignatable for no gain, since
-- the designation opens nothing to sign in to.
create or replace function gatepass.set_approval_role(p_role_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can designate a gate pass approver.';
  end if;

  if p_role_key not in ('security_head', 'coo', 'ceo', 'finance_head') then
    raise exception 'Unknown approval level.';
  end if;

  select exists (select 1 from public.profiles p where p.id = p_user_id) into v_exists;
  if not v_exists then
    raise exception 'That user does not exist.';
  end if;

  insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at)
  values (p_role_key, p_user_id, auth.uid(), now())
  on conflict (role_key) do update
    set user_id       = excluded.user_id,
        designated_by = excluded.designated_by,
        designated_at = excluded.designated_at;
end;
$$;

-- Vacating is its own verb rather than `set_approval_role(key, null)`: a null
-- user id is far more likely to be a bug in a caller than an intention to empty
-- an office, and `user_id` is NOT NULL precisely so that bug cannot land.
create or replace function gatepass.clear_approval_role(p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not gatepass.is_admin() then
    raise exception 'Only an admin can change a gate pass approver.';
  end if;

  delete from gatepass.approval_roles r where r.role_key = p_role_key;
end;
$$;

grant execute on function gatepass.set_approval_role(text, uuid) to authenticated;
grant execute on function gatepass.clear_approval_role(text)     to authenticated;
