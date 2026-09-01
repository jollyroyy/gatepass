-- ============================================================================
-- 075 — the printed slip carries the signature of everybody who signed it
--
-- Client, 2026-09-01: "in the print pass you put a signature column under each
-- of them — each of the HOD, and all those approvals, like finance approval and
-- security approval. Give one option for them to upload their signature in one
-- of the left-side panels. Whatever they have uploaded there, the same
-- signature will be shown on the print pass page after they approve it.
-- Suppose I'm the security head and I have approved one of the passes — once I
-- approve it, whatever I uploaded, that signature should show up in the print
-- pass. Don't show the signature until and unless I approve."
--
-- ═══ THE WHOLE RULE IS IN THE LAST SENTENCE ═══
--
-- A signature is a MARK OF ASSENT, and printing one on a box nobody has signed
-- would be a forgery this system performed by itself. So the image never
-- travels with the person; it travels with the DECISION. `get_pass_signatures`
-- below returns a signature for exactly the slots where this database holds a
-- recorded act by that person on THIS pass:
--
--   raised     the pass exists, and they raised it        (gate_passes.raised_by)
--   an office  they APPROVED it — not rejected, not routed (pass_approvals)
--   gate       they cleared it outward                     (status = 'matched')
--   receiver   they took every line back in                (return_status = 'returned')
--
-- A pending rung, a rejected one, a rung closed as `not_required` by the other
-- office on level 3 (063), a pass still at the barrier, a partially returned
-- one: all return NO ROW, and the box prints as it does today. A rejection is
-- deliberately excluded even though it is a real decision — the client's
-- sentence is "until and unless I approve", and a signature under a refusal
-- reads on paper as consent to the movement.
--
-- ═══ WHERE THE IMAGE LIVES ═══
--
-- In the `avatars` storage bucket, at `<uid>/signature`, beside the profile
-- photo it sits next to on the same screen. That bucket belongs to VMS
-- (its migration 053) and is PUBLIC, which the client was asked about
-- explicitly and chose: a signature is readable by anyone holding its URL, the
-- same exposure a profile photo already has. No storage DDL is written here and
-- none may be — the bucket and its policies are VMS's, and its RLS already
-- keys writes on the first path segment being the caller's own uid, which is
-- exactly the rule this feature needs.
--
-- WHAT LIVES HERE IS THE POINTER, and it lives in `gatepass` rather than as a
-- column on `public.profiles`: that table is VMS's and this schema may not add
-- to it (the two-schema rule). `set_my_avatar` (025) writes VMS's own
-- pre-existing `avatar_url` column, which is a different thing — writing a
-- value into a column VMS defined is allowed, defining one is not.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. One signature per person
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Keyed by user, not by office: an office CHANGES HANDS, and a signature does
-- not. Keying this on `approval_roles` would mean the Finance HOD's mark
-- following the seat to whoever holds it next, which is the one thing a
-- signature must never do. It is also why every raiser and every guard can have
-- one — the raise and gate boxes are signed by people who hold no office at all.
create table if not exists gatepass.user_signatures (
  user_id       uuid primary key references public.profiles(id),
  signature_url text not null,
  updated_at    timestamptz not null default now()
);

comment on table gatepass.user_signatures is
  'Where each person''s uploaded signature image lives (075) — a URL into the '
  'shared avatars bucket at <uid>/signature. Keyed by USER, never by office: an '
  'office changes hands and a signature does not. Printed only against a '
  'decision that person actually made; see get_pass_signatures().';

alter table gatepass.user_signatures enable row level security;

-- YOUR OWN ROW, AND NOTHING ELSE. This policy exists so the profile screen can
-- show you the signature you uploaded; it is deliberately NOT a directory.
-- Every OTHER read in this feature goes through get_pass_signatures(), which is
-- SECURITY DEFINER and hands back only the marks belonging to one pass the
-- caller may already read in full. Without that split, any signed-in account
-- could enumerate every signature in the mall.
drop policy if exists user_signatures_select_own on gatepass.user_signatures;
create policy user_signatures_select_own on gatepass.user_signatures
  for select to authenticated
  using (user_id = auth.uid());

-- A NEW TABLE INHERITS NO GRANT IN THIS SCHEMA — 002/009 grant table by table
-- and there are no default privileges — so SELECT is given explicitly. It is
-- narrowed to nothing by the policy above; the grant is what lets the policy
-- get a turn at all, and without it the profile card reads 42501.
grant select on gatepass.user_signatures to authenticated;

-- No INSERT / UPDATE / DELETE grant and no policy for them either: writes go
-- through set_my_signature() below, the same shape `set_my_avatar` (025) uses,
-- so there is exactly one statement in this database that can change a
-- signature. The revoke is belt to that braces, and is what migration 009 will
-- need to restate if anybody re-toggles Exposed schemas and re-runs
-- `grant all on all tables in schema gatepass`.
revoke insert, update, delete on gatepass.user_signatures from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Setting your own
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Null or blank REMOVES it, so one function covers upload, replace and remove —
-- and a removal is a real need: a signature uploaded by mistake is a mark
-- attributed to a person on paper, and they must be able to take it down
-- without an admin. Passes already printed are unaffected; passes printed
-- afterwards show the box without an image, exactly as before they uploaded.
create or replace function gatepass.set_my_signature(p_signature_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := nullif(trim(coalesce(p_signature_url, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to set a signature.';
  end if;

  if v_url is null then
    delete from gatepass.user_signatures where user_id = auth.uid();
    return;
  end if;

  insert into gatepass.user_signatures (user_id, signature_url, updated_at)
  values (auth.uid(), v_url, now())
  on conflict (user_id)
  do update set signature_url = excluded.signature_url, updated_at = now();
end;
$$;

comment on function gatepass.set_my_signature(text) is
  'Stores, replaces or (on null/blank) removes the caller''s own signature URL '
  '(075). Scoped to auth.uid() — there is no way to set anybody else''s.';

revoke all on function gatepass.set_my_signature(text) from public;
grant execute on function gatepass.set_my_signature(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The signatures ONE pass has actually earned
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `slot` names the box on the printed slip, in the vocabulary the client's own
-- ladder already uses: 'raised', an `approval_roles.role_key`, 'gate', or
-- 'receiver'. The print page maps a box to a slot; nothing here knows about
-- pixels.
--
-- THE GUARD IS `can_see_pass`, the same one `get_pass_approvals` (068) uses. A
-- caller who may not read the pass may not read who signed it, and asking is
-- refused in the same sentence rather than answered with an empty set — an
-- empty set would let somebody probe which pass ids exist.
create or replace function gatepass.get_pass_signatures(p_pass_id uuid)
returns table (slot text, signature_url text)
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
    -- THE RAISER. Raising IS their act — the issuing HOD (or, since 069, the
    -- COO or CEO who raised for a department) has nothing further to sign, and
    -- the pass existing is the record of it.
    select 'raised'::text, s.signature_url
      from gatepass.gate_passes g
      join gatepass.user_signatures s on s.user_id = g.raised_by
     where g.id = p_pass_id

    union all

    -- AN OFFICE THAT APPROVED IT. `status = 'approved'` is the whole of the
    -- client's "not until I approve": a pending rung has no `decided_by`, a
    -- rejected one is excluded by the status test, and a level-3 rung closed as
    -- 'not_required' because the other office signed (063) has no decider
    -- either — nobody signed it, so nothing prints in it.
    --
    -- `decided_by` is the person who really pressed it, which on a delegated
    -- rung is the DELEGATE and not the office holder (072). That is correct and
    -- deliberate: the delegate signed it, so the delegate's mark belongs in the
    -- box, beside the name `get_pass_approvals` already prints there.
    select a.role_key, s.signature_url
      from gatepass.pass_approvals a
      join gatepass.user_signatures s on s.user_id = a.decided_by
     where a.gate_pass_id = p_pass_id
       and a.status = 'approved'

    union all

    -- THE GATE, once it cleared the material OUTWARD. `status = 'matched'`
    -- only: a flagged pass was refused, and 070 makes that terminal, so there
    -- is no clearance to sign for.
    select 'gate'::text, s.signature_url
      from gatepass.gate_passes g
      join gatepass.user_signatures s on s.user_id = g.verified_by
     where g.id = p_pass_id
       and g.status = 'matched'

    union all

    -- THE RECEIVER, once EVERY line is back. The same trigger the paper's tick
    -- already uses (`returnReceipt`): `return_status = 'returned'`, which
    -- `apply_item_returns` sets only when no line is still owing. The guard is
    -- the one who recorded the LAST return — `order by created_at desc limit 1`
    -- over that pass's `returned` verifications, which is the movement that
    -- brought the final line in.
    select 'receiver'::text, s.signature_url
      from gatepass.gate_passes g
      join lateral (
        select v.security_user_id
          from gatepass.verifications v
         where v.gate_pass_id = g.id
           and v.action = 'returned'
         order by v.created_at desc
         limit 1
      ) last_return on true
      join gatepass.user_signatures s on s.user_id = last_return.security_user_id
     where g.id = p_pass_id
       and g.type = 'RGP'
       and g.return_status = 'returned';
end;
$$;

comment on function gatepass.get_pass_signatures(uuid) is
  'The signature image for each box on ONE pass''s printed slip (075), returned '
  'ONLY where this database holds a recorded act by that person on that pass: '
  'raised it, approved a rung, cleared it out, or took every line back. A '
  'pending, rejected or not_required rung returns no row, so the paper can '
  'never show assent nobody gave. Guarded by can_see_pass().';

revoke all on function gatepass.get_pass_signatures(uuid) from public;
grant execute on function gatepass.get_pass_signatures(uuid) to authenticated;

notify pgrst, 'reload schema';
