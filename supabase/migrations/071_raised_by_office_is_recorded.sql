-- ============================================================================
-- 071 — A PASS RECORDS THE OFFICE THAT RAISED IT
--
-- 069 let the sitting COO and the CEO raise a pass for ANY department. It did
-- not give any reader a way to KNOW that had happened. `gate_passes` records
-- `raised_by` and the view resolves it to a name, so a pass the COO raised for
-- Housekeeping reads, on every timeline in the app, as a name beside the word
-- "Housekeeping" — indistinguishable from that department's own HOD raising it.
-- The printed slip was the plainest case: its first box is headed "Issuing HOD"
-- and a person signs paper under that heading.
--
-- IT MUST BE A SNAPSHOT, NOT A LOOKUP. `gatepass.approval_roles` holds only the
-- CURRENT holder of each office (CLAUDE.md's own landmine: who held an office
-- on a past date cannot be reconstructed). Deriving "the COO raised this" by
-- comparing `raised_by` against today's designations would silently relabel
-- every pass the pair ever raised the day either seat changes hands — and would
-- start crediting a NEW COO with material their predecessor moved. So the
-- office is written onto the pass at the moment it is raised, exactly as
-- `pass_approvals.routed_to` snapshots who each rung was routed to (046).
--
-- NULL IS THE ORDINARY CASE and means an HOD raised it for their own
-- department. Every pass that existed before this migration is null and reads
-- exactly as it always has — there is nothing to back-fill, and back-filling
-- from today's `approval_roles` is the very thing the paragraph above refuses.
--
-- THE PAIR IS STILL DEFINED ONCE. `holds_fallback_office()` (067) answered
-- yes/no; it is re-expressed below in terms of a new `my_fallback_office()`
-- that answers WHICH, so the ('coo','ceo') list and the active-user check exist
-- in one place and every caller — the emergency release, 069's raising guard,
-- the two select policies — keeps its current meaning to the letter.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Which of the two offices the caller sits in
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER for the reason 067's predicate is: `approval_roles` is not
-- readable by an ordinary caller, and this answers about `auth.uid()` alone, so
-- it can tell nobody anything about anybody else. One seat per person (049), so
-- `limit 1` is a formality rather than a choice between rows.
create or replace function gatepass.my_fallback_office()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role_key
    from gatepass.approval_roles r
   where r.role_key in ('coo', 'ceo')
     and r.user_id = auth.uid()
     and gatepass.is_user_active(auth.uid())
   limit 1;
$fn$;

comment on function gatepass.my_fallback_office() is
  'The fallback office the caller sits in - coo, ceo, or null. Deputies and delegates are excluded exactly as they are from holds_fallback_office(). See migration 071.';

revoke all on function gatepass.my_fallback_office() from public;
grant execute on function gatepass.my_fallback_office() to authenticated;

-- 067's predicate, unchanged in meaning, restated over the function above so
-- the pair and the active check are written down once. `create or replace`
-- keeps every policy and every caller bound to it.
create or replace function gatepass.holds_fallback_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select gatepass.my_fallback_office() is not null;
$fn$;

comment on function gatepass.holds_fallback_office() is
  'True for the sitting COO or CEO. Deputies and delegates are deliberately excluded: emergency release is the last door and belongs to the officer, not to their cover. Since 071 it is my_fallback_office() is not null - one definition of the pair. See migrations 067 and 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The column
-- ═══════════════════════════════════════════════════════════════════════════
alter table gatepass.gate_passes
  add column if not exists raised_by_office text;

alter table gatepass.gate_passes
  drop constraint if exists gate_passes_raised_by_office_known;

-- The same two-office list as the predicate, and no free text: a fifth value
-- here would print a heading no client-side map has words for. It is a CHECK
-- rather than an enum because there is no existing type holding exactly this
-- pair, and a new enum label cannot be USED in the transaction that adds it
-- (CLAUDE.md) — which is precisely the transaction APPLY_ALL.sql is.
alter table gatepass.gate_passes
  add constraint gate_passes_raised_by_office_known
  check (raised_by_office is null or raised_by_office in ('coo', 'ceo'));

comment on column gatepass.gate_passes.raised_by_office is
  'The fallback office the raiser sat in when this pass was raised (069), snapshotted because approval_roles keeps only the current holder. Null means an HOD raised it for a department they head. See migration 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Raising stamps it
-- ═══════════════════════════════════════════════════════════════════════════
-- 069's function verbatim from the item loop down. The only changes are at the
-- top: the office is read instead of the yes/no, and it is written into the
-- insert. NOTHING about the ladder moves — a COO-raised pass is still
-- snapshotted by the 063 trigger, still owes the Security Head and Finance in
-- order, and the COO still signs their own level-3 rung.
create or replace function gatepass.raise_pass(
  p_type                 gatepass.pass_type,
  p_direction            gatepass.pass_direction,
  p_department_id        uuid,
  p_visitor_name         text,
  p_visitor_company      text,
  p_vehicle_number       text,
  p_purpose              text default null,
  p_expected_return_date date default null,
  p_items                jsonb default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass           gatepass.gate_passes;
  v_item           jsonb;
  v_line           int := 0;
  v_office         text;
  v_any_department boolean;
begin
  -- Read ONCE: it decides both guards AND what is stamped on the row.
  v_office         := gatepass.my_fallback_office();
  v_any_department := v_office is not null;

  if gatepass.app_role() <> 'hod' and not v_any_department then
    raise exception 'Only an HOD, the COO or the CEO can raise a gate pass.';
  end if;

  if p_department_id is null then
    raise exception 'A gate pass must name a department.';
  end if;

  if v_any_department then
    -- ANY department, but a REAL one. The `gate_passes.department_id` foreign
    -- key would refuse an invented uuid anyway; this refuses it in a sentence a
    -- person can read instead of as a constraint violation.
    if not exists (select 1 from public.departments d where d.id = p_department_id) then
      raise exception 'That department does not exist.';
    end if;
  elsif p_department_id not in (select gatepass.my_department_ids()) then
    raise exception 'You can only raise a pass for a department you head.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A gate pass needs at least one material line.';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A gate pass cannot carry more than 50 material lines.';
  end if;

  insert into gatepass.gate_passes
    (type, direction, department_id, raised_by, raised_by_office, visitor_name,
     visitor_company, vehicle_number, purpose, expected_return_date)
  values
    (p_type, p_direction, p_department_id, auth.uid(), v_office, p_visitor_name,
     p_visitor_company, p_vehicle_number, p_purpose, p_expected_return_date)
  returning * into v_pass;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    insert into gatepass.gate_pass_items
      (gate_pass_id, line_no, name, description, purpose, quantity, unit,
       serial_no, approx_value, expected_return_date, department_id,
       make_model, invoice_no, remarks)
    values (
      v_pass.id,
      v_line,
      v_item ->> 'name',
      v_item ->> 'description',
      -- THE LINE'S REASON IS THE PASS'S REASON when the caller sends none (045).
      coalesce(
        nullif(trim(coalesce(v_item ->> 'purpose', '')), ''),
        nullif(trim(coalesce(p_purpose, '')), ''),
        'Material movement'
      ),
      (v_item ->> 'quantity')::numeric,
      coalesce(nullif(trim(coalesce(v_item ->> 'unit', '')), ''), 'nos'),
      nullif(trim(coalesce(v_item ->> 'serial_no', '')), ''),
      nullif(v_item ->> 'approx_value', '')::numeric,
      nullif(v_item ->> 'expected_return_date', '')::date,
      p_department_id,
      nullif(trim(coalesce(v_item ->> 'make_model', '')), ''),
      nullif(trim(coalesce(v_item ->> 'invoice_no', '')), ''),
      nullif(trim(coalesce(v_item ->> 'remarks', '')), '')
    );
  end loop;

  return v_pass;
end;
$$;

comment on function gatepass.raise_pass(
  gatepass.pass_type, gatepass.pass_direction, uuid, text, text, text, text, date, jsonb
) is
  'Raises a gate pass. An HOD may raise only for a department they head; the sitting COO or CEO (my_fallback_office(), 071) may raise for any department and has that office stamped onto the row. See migrations 069 and 071.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The view carries it
-- ═══════════════════════════════════════════════════════════════════════════
-- TRAP 2 (CLAUDE.md): `create or replace view` cannot absorb a new base-table
-- column, so the view is DROPPED and rebuilt with its grant re-applied in the
-- same transaction, and `security_invoker = true` is restated — without it the
-- view runs as its owner and every HOD reads every department. The body is
-- 057's, edited mechanically rather than retyped: ONE column added.
--
-- Every list, card, drill, report, CSV and notification query in this app reads
-- `v_gate_passes` with `select('*')`, so this one line is what carries the
-- office to all four timelines without a second query anywhere.
drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
    p.raised_by_office,
    p.visitor_name,
    p.visitor_company,
    p.vehicle_number,
    p.purpose,
    p.expected_return_date,
    p.return_status,
    p.actual_return_date,
    p.verified_by,
    p.verified_at,
    p.flag_reason,
    p.created_at,
    p.updated_at,
    p.qr_token,
    p.expires_at,
    p.direction,
    p.image_url,
    p.category,
    ( SELECT max(f.created_at) AS max
           FROM gatepass.verifications f
          WHERE f.gate_pass_id = p.id AND f.action = 'flagged'::gatepass.verify_action) AS flagged_at,
    ( SELECT max(r.created_at) AS max
           FROM gatepass.verifications r
          WHERE r.gate_pass_id = p.id AND r.action = 'hod_reviewed'::gatepass.verify_action) AS hod_reviewed_at,
    p.return_status = 'awaiting_return'::gatepass.return_status AND p.expected_return_date IS NOT NULL AND p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date AS is_overdue,
    p.status = 'pending'::gatepass.pass_status AND p.expires_at < now() AS is_expired,
        CASE
            WHEN p.expected_return_date IS NULL OR (p.return_status::text <> ALL (ARRAY['awaiting_return'::text, 'partially_returned'::text])) THEN 'not_applicable'::text
            WHEN p.expected_return_date < (now() AT TIME ZONE gatepass.site_tz())::date THEN 'overdue'::text
            WHEN p.expected_return_date = (now() AT TIME ZONE gatepass.site_tz())::date THEN 'due_today'::text
            WHEN p.expected_return_date = ((now() AT TIME ZONE gatepass.site_tz())::date + 1) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS due_state,
    gatepass.pass_awaits_approval(p.id) AS awaits_approval,
    COALESCE(it.item_count, 0::bigint) AS item_count,
    COALESCE(it.total_quantity, 0::numeric) AS total_quantity,
    COALESCE(it.returned_quantity, 0::numeric) AS returned_quantity,
    it.material_summary,
    COALESCE(it.total_value, 0::numeric) AS total_value,
    d.name AS department_name,
    d.code AS department_code,
    rb.full_name AS raised_by_name,
    vb.full_name AS verified_by_name
   FROM gatepass.gate_passes p
     LEFT JOIN LATERAL ( SELECT count(*) AS item_count,
            sum(i.quantity) AS total_quantity,
            sum(i.returned_qty) AS returned_quantity,
            string_agg(i.name, ', '::text ORDER BY i.line_no) AS material_summary,
            sum(i.approx_value) AS total_value
           FROM gatepass.gate_pass_items i
          WHERE i.gate_pass_id = p.id) it ON true
     LEFT JOIN public.departments d ON d.id = p.department_id
     LEFT JOIN gatepass.profile_names rb ON rb.id = p.raised_by
     LEFT JOIN gatepass.profile_names vb ON vb.id = p.verified_by;

grant select on gatepass.v_gate_passes to authenticated;

notify pgrst, 'reload schema';
