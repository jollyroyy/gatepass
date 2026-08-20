-- ============================================================================
-- 058 — every pass raised BEFORE the approval workflow went live is approved,
--       and it says so in words rather than naming somebody who never signed
--
-- The client, 2026-08-20: "I do see whatever passes were raised before today.
-- Make them all approved. Since the approval process is starting today,
-- starting today onwards show the exact approval, whether it's pending or not.
-- If something was raised yesterday, make it completely approved."
--
-- WHY THERE IS ANYTHING TO DO AT ALL. 046 grandfathered the 60 passes that
-- predated the ladder by the cleanest possible route — an office that was
-- vacant at the moment of the raise is never snapshotted, so those passes owe
-- nothing and reach the gate exactly as they always did. What 046 could not
-- foresee is the four offices being FILLED while passes were mid-flight: five
-- passes were raised into a ladder nobody was going to climb retroactively, and
-- they are now stuck short of the gate. This migration closes exactly those.
--
-- ⚠ IT DOES NOT INVENT AN APPROVER, and that is the whole design. The obvious
-- shortcut — set `status = 'approved', decided_by = <some admin>` — writes a
-- FABRICATED AUDIT TRAIL: the record would read "Approved by X" against four
-- offices X does not hold and never signed. That is precisely what 046 refused
-- when it declined to backfill the grandfathered passes, and what 055's
-- `emergency` flag exists to avoid. So instead:
--
--   * `pass_approvals.grandfathered` marks the rows this migration closed;
--   * `decided_by` stays NULL — nobody decided them;
--   * `decided_at` is stamped, because the rollout is a real moment;
--   * `reason` carries the sentence a reader is owed, and the ladder prints
--     "Approved on rollout" where a name would otherwise go.
--
-- The shape constraint is widened by exactly one arm to permit that, and by no
-- more: an `approved` row with a null decider is legal ONLY when grandfathered
-- is true. Every ordinary approval still needs an author and a moment.
--
-- THE CUTOFF IS THE DATE PRINTED ON THE PASS. `set_pass_number` (042) builds
-- `RGP-YYYYMMDD-NNNN` from the UTC date while every other date rule in this app
-- runs in `site_tz()`, so a pass raised at 00:31 IST carries YESTERDAY's date on
-- its own face. The client is reading those numbers off the screen, so the cut
-- is made in the same clock the number is: a pass whose number reads 20260819
-- or earlier is closed; a pass whose number reads 20260820 keeps its real,
-- live ladder. (That UTC/site split in 042 is a genuine inconsistency and is
-- flagged in CLAUDE.md — it is deliberately NOT fixed here, because renumbering
-- a pass is renumbering an audit anchor on printed paper.)
--
-- ONE-TIME AND SELF-LIMITING. Re-running it is harmless: no pass can ever again
-- be raised with a `created_at` before the cutoff, so the UPDATE can only ever
-- match rows it has already closed, and those are no longer `pending`.
-- ============================================================================

-- ─── The mark ───────────────────────────────────────────────────────────────

alter table gatepass.pass_approvals
  add column if not exists grandfathered boolean not null default false;

comment on column gatepass.pass_approvals.grandfathered is
  'True when this level was closed by the 058 rollout rather than by a person: '
  'the pass was raised before the approval workflow began, so no office ever '
  'saw it. decided_by is null on such a row — the ladder prints "Approved on '
  'rollout" instead of a name. Never set by any RPC; only 058 writes it.';

-- ─── The shape constraint, widened by exactly one arm ────────────────────────

alter table gatepass.pass_approvals
  drop constraint if exists pass_approvals_decision_shape;

alter table gatepass.pass_approvals
  add constraint pass_approvals_decision_shape
    check (
      (status = 'pending'  and decided_by is null and decided_at is null and reason is null)
      -- The rollout: approved, stamped, explained, and authored by nobody.
      or (status = 'approved' and grandfathered and decided_by is null and decided_at is not null)
      or (status = 'approved' and not grandfathered and decided_by is not null and decided_at is not null)
      or (status = 'rejected' and decided_by is not null and decided_at is not null
          and length(btrim(coalesce(reason, ''))) between 1 and 500)
    );

-- ─── The backfill ───────────────────────────────────────────────────────────

do $$
declare
  -- Local midnight UTC of the day the workflow went live — the same clock the
  -- pass number is built in. Everything raised strictly before this is closed.
  v_cutoff constant timestamptz := timestamptz '2026-08-20 00:00:00+00';
  v_closed integer;
begin
  update gatepass.pass_approvals a
     set status        = 'approved',
         grandfathered = true,
         decided_by    = null,
         decided_at    = now(),
         reason        = 'Approved on rollout — this pass was raised before the '
                      || 'approval workflow began, so no office was ever asked to sign it.'
   where a.status = 'pending'
     and exists (
           select 1
             from gatepass.gate_passes p
            where p.id = a.gate_pass_id
              and p.created_at < v_cutoff
         );

  get diagnostics v_closed = row_count;
  raise notice '058: closed % pending approval level(s) raised before %', v_closed, v_cutoff;
end;
$$;

-- ─── The ladder must be able to SAY it ──────────────────────────────────────
--
-- The return type gains a column, so the function is dropped and recreated —
-- `create or replace` cannot change a RETURNS TABLE signature. Otherwise this
-- is 054's body unchanged.

drop function if exists gatepass.get_pass_approvals(uuid);

create function gatepass.get_pass_approvals(p_pass_id uuid)
returns table (
  role_key          text,
  level_no          smallint,
  status            text,
  routed_name       text,
  decided_name      text,
  decided_at        timestamptz,
  reason            text,
  decided_as_deputy boolean,
  grandfathered     boolean
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
    select a.role_key,
           a.level_no,
           a.status,
           rp.full_name,
           dp.full_name,
           a.decided_at,
           a.reason,
           a.decided_as_deputy,
           a.grandfathered
      from gatepass.pass_approvals a
      left join public.profiles rp on rp.id = a.routed_to
      left join public.profiles dp on dp.id = a.decided_by
     where a.gate_pass_id = p_pass_id
     order by a.level_no;
end;
$$;

grant execute on function gatepass.get_pass_approvals(uuid) to authenticated;

notify pgrst, 'reload schema';
