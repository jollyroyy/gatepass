// RENAMED TWICE ON 2026-08-21, and this is the second pass. Every assertion
// here that read "Out — Not Returned" briefly read "In Progress" and now
// reads "Partially Returned" — the one word the client settled on for the
// whole return leg ("replace the 'in progress' with 'partially returned'
// across all the reporting everywhere in all the views"). Both open stages
// therefore carry the SAME label and the same style; only the labels moved,
// and no stage, tone or precedence rule changed with them.
// The RGP return loop, as a derived display stage.
//
// The business problem this exists for: an RGP has to make TWO trips — out
// through the gate, then back in — and until 2026-08-11 every surface in the
// app rendered only `status`, which says "Matched" the moment the gate clears
// it OUTWARD. So a pass that is still physically outside the mall and a pass
// that came back and closed weeks ago were visually identical.
//
// The distinction was never missing from the data: `match_pass` (003) sets
// `return_status = 'awaiting_return'` for an RGP in the same statement that
// sets `status = 'matched'`, and `apply_item_returns` (013) rolls it forward
// to 'partially_returned' / 'returned'. So this module derives the stage from
// `return_status` ALONE — never from `status`, and never by recomputing
// anything the view already owns.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { rgpStage, rgpStageStyle, RGP_STAGE_STYLES } from '../../src/lib/rgpLifecycle';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('rgpStage', () => {
  it('reads an RGP cleared outward but not back as "out_open"', () => {
    expect(rgpStage(pass({ status: 'matched', return_status: 'awaiting_return' }))).toBe('out_open');
  });

  it('reads a partially returned RGP as its own stage, not as closed', () => {
    expect(rgpStage(pass({ return_status: 'partially_returned' }))).toBe('partly_returned');
  });

  it('reads a fully returned RGP as "closed"', () => {
    expect(rgpStage(pass({ return_status: 'returned', actual_return_date: '2026-08-10' }))).toBe('closed');
  });

  // The whole point: these two are BOTH `status: 'matched'` and must not
  // render the same. If this ever passes with both sides equal, the badge has
  // collapsed back into the status badge and the feature is gone.
  it('distinguishes "still out" from "closed" even though both are matched', () => {
    const out = pass({ status: 'matched', return_status: 'awaiting_return' });
    const closed = pass({ status: 'matched', return_status: 'returned' });
    expect(rgpStage(out)).not.toBe(rgpStage(closed));
  });

  // An NRGP never comes back — `gate_passes_return_status_rgp_only` (001)
  // pins it to 'not_applicable'. A badge here would read as missing data.
  it('is null for an NRGP', () => {
    expect(rgpStage(pass({ type: 'NRGP', return_status: 'not_applicable' }))).toBeNull();
  });

  // Before the gate clears it, an RGP is still 'not_applicable' — the return
  // obligation has not started, so there is no stage to show.
  it('is null for an RGP that has not reached the gate yet', () => {
    expect(rgpStage(pass({ status: 'pending', return_status: 'not_applicable' }))).toBeNull();
  });

  it('is null for a flagged RGP that never went out', () => {
    expect(rgpStage(pass({ status: 'flagged', return_status: 'not_applicable' }))).toBeNull();
  });
});

describe('rgpStageStyle', () => {
  it('labels the open stage with the wording the client chose', () => {
    expect(rgpStageStyle(pass({ return_status: 'awaiting_return' }))?.label).toBe('Partially Returned');
  });

  it('labels a closed loop "Closed"', () => {
    expect(rgpStageStyle(pass({ return_status: 'returned' }))?.label).toBe('Closed');
  });

  it('returns null where there is no stage', () => {
    expect(rgpStageStyle(pass({ type: 'NRGP', return_status: 'not_applicable' }))).toBeNull();
  });

  // `is_overdue` comes straight off v_gate_passes and is never recomputed
  // here. It re-TONES the pill without renaming it: several drills and KPIs
  // are named "Overdue", and exact-text lookups of those must stay
  // unambiguous (the same rule PassRow follows for its status badge).
  it('names an overdue open pass "Overdue", and tones it', () => {
    const overdue = rgpStageStyle(pass({ return_status: 'awaiting_return', is_overdue: true }));
    const onTime = rgpStageStyle(pass({ return_status: 'awaiting_return', is_overdue: false }));
    expect(overdue?.label).toBe('Overdue');
    expect(onTime?.label).toBe('Partially Returned');
    expect(overdue?.bg).not.toBe(onTime?.bg);
  });

  it('ignores is_overdue once the loop is closed', () => {
    const style = rgpStageStyle(pass({ return_status: 'returned', is_overdue: true }));
    expect(style).toEqual(RGP_STAGE_STYLES.closed);
  });
});
