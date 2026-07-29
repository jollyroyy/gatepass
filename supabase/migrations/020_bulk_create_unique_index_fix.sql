-- ============================================================================
-- 020 — Fix unique index to allow bulk create with identical items
--
-- The old index was scoped per-department: (department_id,
-- normalize_material(description)) WHERE is_open. This blocked
-- bulk_create_passes because all N passes in a batch create items with the
-- same material name in the same department, and every pass after the first
-- hit a duplicate-key violation.
--
-- Fix: include gate_pass_id in the index, making it per-pass. Within a single
-- pass you still cannot have two lines with the same material, but bulk
-- creates work because each pass has a different gate_pass_id.
-- ============================================================================

drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

create unique index if not exists gate_pass_items_one_open_per_material_idx
  on gatepass.gate_pass_items (gate_pass_id, department_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_material_idx is
  'One OPEN line per material per pass (not per department) — widened to '
  'include gate_pass_id so bulk_create_passes with identical items works.';
