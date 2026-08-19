-- ============================================================================
-- 044 - what a guard can DO about an overdue pass
--
-- Client, 2026-08-19: the guard's Overdue screen is one count that opens into a
-- stack of overdue passes, and every card carries the same four actions --
-- process the return, contact the vendor, add a remark, export the slip.
--
-- Three of those four already had somewhere to go. `Process RGP Return` and
-- `Export Pass PDF` are routes (/pass/:id and /pass/:id/print), and both were
-- already reachable. The other two had NO backing at all:
--
--   Contact Vendor / Person   the vendor's phone lives in
--                             gatepass.vendor_profiles, which a guard cannot
--                             read: `vendor_profiles_select_scoped` (031) is
--                             admin-or-own-department-HOD, on purpose.
--   Add Guard Remark          nothing in the schema stored a follow-up note.
--                             A menu item that saves nothing is worse than no
--                             menu item, so the table is here rather than the
--                             button being drawn without it.
--
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A follow-up note against a pass
-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY, and that is the whole point of it: a remark is a record of what
-- was done about a late return -- "rang the site office, truck comes Monday" --
-- and a record that can be edited afterwards is not one. Nobody holds UPDATE or
-- DELETE, and there is no RPC that offers either.
--
-- `author` is NOT NULL and references the profile, so every line has a name
-- against it. ON DELETE RESTRICT for the same reason `approval_roles` (043)
-- uses it: a note whose author resolves to nothing is a note nobody wrote.
create table if not exists gatepass.pass_remarks (
  id           uuid primary key default gen_random_uuid(),
  gate_pass_id uuid not null references gatepass.gate_passes(id) on delete cascade,
  author       uuid not null references public.profiles(id) on delete restrict,
  body         text not null,
  created_at   timestamptz not null default now(),

  -- A blank remark is not a remark, and a screenful is a document. Both ends
  -- are checked here rather than only in the client, because the RPC below is
  -- callable without one.
  constraint pass_remarks_body_sane
    check (length(btrim(body)) between 1 and 1000)
);

create index if not exists pass_remarks_pass_idx
  on gatepass.pass_remarks (gate_pass_id, created_at desc);

alter table gatepass.pass_remarks enable row level security;

-- READABLE BY WHOEVER CAN READ THE PASS, and by exactly nobody else. The
-- subquery is not decoration: row security applies inside a policy expression
-- too, so `gate_passes_select` (002) decides this -- an HOD sees remarks on
-- their own department's passes, a guard and an admin see the site. Restating
-- that rule here in a second form is how the two drift apart.
drop policy if exists pass_remarks_select_with_pass on gatepass.pass_remarks;
create policy pass_remarks_select_with_pass
  on gatepass.pass_remarks for select to authenticated
  using (
    exists (
      select 1 from gatepass.gate_passes g where g.id = gate_pass_id
    )
  );

-- No insert/update/delete policy anywhere. `add_pass_remark` is the only writer.
grant select on gatepass.pass_remarks to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Writing one
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GATE AND THE OFFICE BOTH WRITE HERE. A guard records what happened at the
-- barrier; the raising HOD and an admin record the chase from their side, and a
-- pass a department cannot see is one this function refuses anyway (the
-- visibility check below re-uses `gate_passes` under the caller's own RLS by
-- selecting through a SECURITY INVOKER path -- see the note on v_visible).
--
-- SECURITY DEFINER is needed only for the INSERT, since no role holds INSERT on
-- the table. The visibility test that gates it must therefore be explicit, and
-- it is: `gatepass.can_see_pass` is the same predicate `gate_passes_select`
-- applies, called before anything is written.
create or replace function gatepass.can_see_pass(p_pass_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from gatepass.gate_passes g where g.id = p_pass_id);
$$;

grant execute on function gatepass.can_see_pass(uuid) to authenticated;

create or replace function gatepass.add_pass_remark(p_pass_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if gatepass.app_role() is null then
    raise exception 'You are not signed in to this app.';
  end if;

  -- Invoker-rights predicate, called from a definer body ON PURPOSE: it is what
  -- keeps this function from becoming a way to write a note onto any pass in
  -- the building by guessing an id.
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to remark on.';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'A remark cannot be empty.';
  end if;

  insert into gatepass.pass_remarks (gate_pass_id, author, body)
  values (p_pass_id, auth.uid(), left(btrim(p_body), 1000))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function gatepass.add_pass_remark(uuid, text) to authenticated;

-- Reading them back with a name against each. SECURITY DEFINER for the join to
-- `public.profiles` only -- the rows themselves are already gated by the
-- visibility check, and what it adds is a display name, which is what
-- `gatepass.profile_names` exists to expose.
create or replace function gatepass.list_pass_remarks(p_pass_id uuid)
returns table (
  id          uuid,
  body        text,
  author_name text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    select r.id, r.body, p.full_name, r.created_at
      from gatepass.pass_remarks r
      left join public.profiles p on p.id = r.author
     where r.gate_pass_id = p_pass_id
     order by r.created_at desc;
end;
$$;

grant execute on function gatepass.list_pass_remarks(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The one contact detail the gate needs
-- ═══════════════════════════════════════════════════════════════════════════
-- A guard chasing a late return has to be able to ring somebody, and the number
-- is in `vendor_profiles`, which they cannot read. Widening
-- `vendor_profiles_select_scoped` would hand the gate every vendor's record in
-- the building; this hands it ONE row -- contact person and phone -- for ONE
-- pass the caller can already see, matched on the company printed on that pass.
--
-- `visitor_company` is free text and carries a "Name | Address" convention in
-- places (parseCompanyInfo, client side), so the match is on the leading
-- segment, case-folded and trimmed. A miss returns no row and the menu says so;
-- it never invents a number.
create or replace function gatepass.pass_contact(p_pass_id uuid)
returns table (
  company        text,
  contact_person text,
  phone          text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not gatepass.can_see_pass(p_pass_id) then
    raise exception 'That gate pass does not exist, or is not yours to read.';
  end if;

  return query
    with pass as (
      select g.visitor_company, g.visitor_name, g.department_id
        from gatepass.gate_passes g
       where g.id = p_pass_id
    )
    select coalesce(v.company_name, btrim(split_part(pass.visitor_company, '|', 1))),
           coalesce(v.contact_person, pass.visitor_name),
           v.phone
      from pass
      left join gatepass.vendor_profiles v
        on lower(btrim(v.company_name))
         = lower(btrim(split_part(pass.visitor_company, '|', 1)));
end;
$$;

grant execute on function gatepass.pass_contact(uuid) to authenticated;
