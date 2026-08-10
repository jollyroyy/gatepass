-- ============================================================================
-- 038 - v_gate_passes carries the pass's declared value
--
-- The pass cards were asked to highlight the value of the material alongside
-- vendor, who raised it, and the expected return date. Three of those four were
-- already on the view; value was not. Only gate_pass_items.approx_value existed,
-- per line, so any card that had not already loaded its item rows could not show
-- a figure at all -- and every pass-level card (guard drill, HOD drill, My
-- Passes, the gate queue) is exactly that case.
--
-- Summed as a plain SUM of approx_value, matching 016's `overdue_value`, which
-- is defined the same way. The two MUST agree: a pass reading one figure in the
-- overdue KPI and another on its own card would make both untrustworthy. So
-- approx_value is a LINE total, not a unit price.
--
-- Computed inside the EXISTING lateral, so this adds a column without adding a
-- second scan of gate_pass_items.
--
-- COALESCE to 0 at the view boundary so no consumer has to special-case null.
-- Note the cost: "nothing declared" and "declared as zero" become
-- indistinguishable. Acceptable only because approx_value is explicitly an
-- APPROXIMATE, optional figure and never an accounting record.
--
-- TRAP 2 (CLAUDE.md): `create or replace view` cannot absorb a new column - a
-- view's column list is fixed at creation. The view must be DROPPED and rebuilt,
-- and the select grant re-applied in the SAME transaction, or every client loses
-- read access. `security_invoker = true` is restated deliberately: without it the
-- view runs as its owner and bypasses RLS entirely, so every HOD would read
-- every department's passes.
--
-- The body below is pg_get_viewdef() of the LIVE view, edited mechanically
-- rather than retyped, so it cannot drift from what is actually deployed.
-- ============================================================================

drop view if exists gatepass.v_gate_passes;

create view gatepass.v_gate_passes with (security_invoker = true) as
 SELECT p.id,
    p.pass_number,
    p.type,
    p.status,
    p.department_id,
    p.raised_by,
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

comment on view gatepass.v_gate_passes is
  'Pass rows with rollups. is_overdue / is_expired / due_state / total_value are '
  'defined HERE and exactly once - never recompute them in TypeScript.';

notify pgrst, 'reload schema';
