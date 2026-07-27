-- ============================================================================
-- 017 — RGP-in has no expected return date
--
-- Migration 010 split type and direction, but the check constraint on
-- expected_return_date was never updated. It still says:
--
--   check ((type = 'RGP') = (expected_return_date is not null))
--
-- This forces every RGP (both out and in) to carry a return date, which makes
-- no sense for RGP-in: material arriving at the site has not been dispatched,
-- so there is nothing to "return."
--
-- The corrected constraint:
--
--   check ((type = 'RGP' and direction = 'out') = (expected_return_date is not null))
--
-- RGP-out   → expected_return_date required (material leaving, must come back)
-- RGP-in    → expected_return_date prohibited (material arriving, return is a
--             separate movement, not tracked on this pass)
-- NRGP-out  → expected_return_date prohibited
-- ============================================================================

-- Postgres auto-named the original constraint. Find and drop it.
alter table gatepass.gate_passes
  drop constraint if exists gate_passes_expected_return_date_check;

-- Add the corrected constraint that accounts for direction.
alter table gatepass.gate_passes
  add constraint gate_passes_return_date_required
  check ((type = 'RGP' and direction = 'out') = (expected_return_date is not null));

notify pgrst, 'reload schema';
