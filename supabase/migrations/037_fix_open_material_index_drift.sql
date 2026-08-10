-- ============================================================================
-- 037 — An IT HOD could not raise an RGP: "That record already exists."
--
-- Reported 2026-08-10. Raising a perfectly ordinary RGP failed with a 23505
-- unique violation, which src/lib/errors.ts renders as the generic
-- "That record already exists." — a message that tells the HOD nothing about
-- what was duplicated or what to do about it.
--
-- ── ROOT CAUSE: migration 020 silently did nothing ──────────────────────────
-- 020 set out to widen the open-material index from per-DEPARTMENT to per-PASS.
-- It opened with:
--
--     drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;
--
-- but the index actually on the database is named
--
--     gate_pass_items_one_open_per_department_material_idx
--
-- The names do not match, so `if exists` made the drop a silent no-op, the OLD
-- per-department index survived, and 020's replacement was never created (it is
-- absent from pg_indexes — confirmed live 2026-08-10).
--
-- So the rule in force has been: **one open line per material per DEPARTMENT**.
-- Every HOD in a department shares one namespace of material descriptions. The
-- second person to send out anything called "Laptop" is refused until the first
-- one comes back. With ~10 real passes and a shared IT department that became
-- unavoidable in normal use.
--
-- `if exists` is what hid this. It is there to make a migration re-runnable,
-- and it also means a typo'd or renamed object fails silently and forever.
-- **When dropping an index by name, verify the name against pg_indexes first.**
--
-- ── THE FIX: land what 020 intended ─────────────────────────────────────────
-- Per-PASS scope. Within one pass you still cannot list the same material
-- twice, which is the real integrity rule — it stops a double-typed line. But
-- two different passes may legitimately move the same KIND of thing, because a
-- material description is a noun ("Laptop"), not a serial number. Two teams
-- sending out two laptops is normal, and the database refusing it is wrong.
-- ============================================================================

-- Drop BOTH spellings by their real names. The department-scoped one is what is
-- actually live; the other is 020's intended name, dropped defensively in case
-- an environment somewhere did get it.
drop index if exists gatepass.gate_pass_items_one_open_per_department_material_idx;
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;

-- One OPEN line per material per PASS. `is_open` keeps the constraint scoped to
-- material still outside the gate: once a line is closed it stops participating,
-- so the same material can be sent out again next week.
create unique index gate_pass_items_one_open_per_material_idx
  on gatepass.gate_pass_items (gate_pass_id, gatepass.normalize_material(description))
  where is_open;

comment on index gatepass.gate_pass_items_one_open_per_material_idx is
  'One OPEN line per material per PASS. Deliberately NOT per department: a '
  'material description is a noun, not a serial, so two passes may move the '
  'same kind of item. Per-department scope blocked ordinary RGPs (037).';

-- department_id is deliberately NOT in the key any more. It was redundant even
-- when 020 wrote it — a pass belongs to exactly one department, so once
-- gate_pass_id is in the key, department_id can never further discriminate.
-- Leaving it in would imply a scope the index does not actually have.

notify pgrst, 'reload schema';
