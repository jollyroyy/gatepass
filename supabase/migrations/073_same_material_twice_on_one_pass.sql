-- ============================================================================
-- 073 — The same material may appear on a pass more than once
--
-- Client, 2026-09-01: "make sure same material type can be typed in the items
-- multiple times".
--
-- ── WHAT WAS IN FORCE ───────────────────────────────────────────────────────
-- A partial unique index over `normalize_material(description)`, alive in one
-- shape or another since 008 and last rewritten by 037:
--
--     gate_pass_items_one_open_per_material_idx
--       on gatepass.gate_pass_items (gate_pass_id, normalize_material(description))
--       where is_open
--
-- 037 narrowed it from per-DEPARTMENT to per-PASS, which fixed "an IT HOD could
-- not raise an RGP", and kept the per-pass half on the reasoning that two lines
-- naming one material are a double-typed line.
--
-- ── WHY THAT REASONING DOES NOT HOLD ────────────────────────────────────────
-- A material description is a NOUN, and the columns that tell two lines apart
-- are the OTHER ones. Two lines reading "Laptop" on one pass are routinely two
-- different laptops: different Serial / Asset Tag, different Make / Model /
-- Size, different Order No., different Approx. Value, and — on an RGP — a
-- different expected return date. Collapsing them into one line of quantity 2,
-- which is what the index forced, THROWS ALL OF THAT AWAY: the gate then has
-- one line it cannot check serial by serial, and `apply_item_returns` can only
-- record "1 of 2 back" without being able to say which one.
--
-- The index also caught nothing else. A genuine double-typed line is a typing
-- mistake the HOD can see and delete; a unique index is not what finds it, and
-- the price of the check was refusing a legitimate pass at submit with a 23505
-- the requester could do nothing about but merge two real items.
--
-- ── WHAT THIS MIGRATION DOES ────────────────────────────────────────────────
-- Drops the index — both live spellings, by their real names (037's lesson:
-- `drop index if exists` on a name that is not the one in pg_indexes is a
-- silent no-op, so a wrong name here would leave the rule enforced for ever).
--
-- `gatepass.normalize_material(text)` goes with it. It has no other caller —
-- 013 moved the last gate_passes-level index off it and dropped that one, so
-- once this index is gone the function is unreachable schema that every
-- authenticated role still holds EXECUTE on.
--
-- WHAT STAYS: `gate_pass_items.department_id` and `is_open`. 013 introduced
-- both to make this index expressible, but they long since grew other callers —
-- `department_id` is read by the `gate_pass_items_select` policy, and `is_open`
-- is the per-line "still an outstanding obligation" that `apply_item_returns`
-- and the returns boards run on. Neither is dead.
--
-- WHAT IS UNCHANGED: `gate_pass_items_line_unique (gate_pass_id, line_no)`
-- still holds, so lines are still distinct rows with a stable number the guard
-- can read off the slip over radio — which is the ordering "line 2 of 3" the
-- duplicate descriptions now rely on.
-- ============================================================================

-- The per-PASS spelling 037 created, and the per-DEPARTMENT one that predates
-- it (an environment that never ran 037 still carries the wider rule).
drop index if exists gatepass.gate_pass_items_one_open_per_material_idx;
drop index if exists gatepass.gate_pass_items_one_open_per_department_material_idx;

-- No index is built on it any more, and nothing else calls it.
drop function if exists gatepass.normalize_material(text);

notify pgrst, 'reload schema';
