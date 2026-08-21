// RENAMED TWICE ON 2026-08-21, and this is the second pass. Every assertion
// here that read "Out — Not Returned" briefly read "In Progress" and now
// reads "Partially Returned" — the one word the client settled on for the
// whole return leg ("replace the 'in progress' with 'partially returned'
// across all the reporting everywhere in all the views"). Both open stages
// therefore carry the SAME label and the same style; only the labels moved,
// and no stage, tone or precedence rule changed with them.
// The ONE pill on a pass card, and the timeline behind it.
//
// Round one (2026-08-11): "once the RGP is cleared for going out it shows as
// matched and not cleared." Fixed by adding a second pill from
// `return_status`, so a card read "Matched  Partially Returned".
//
// Round two, same day: "Only show what is the latest status… if the passes are
// closed, completely returned, just put it Closed. Don't show matched
// returned." So the two pills collapse to one (`passStageStyle`) and the
// outward match moves into the expanded card's timeline (`passTimeline`),
// where the client asked for it: "in those details you can show the timeline
// when it was first matched."
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import PassRow from '../../src/components/PassRow';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'P M Sharma',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Servicing', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Drill Machine',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function renderRow(p: GatePassView, variant: 'row' | 'drill' = 'row') {
  return render(
    <MemoryRouter>
      <PassRow pass={p} variant={variant} defaultOpen />
    </MemoryRouter>,
  );
}

describe.each(['row', 'drill'] as const)('pass stage pill — %s variant', (variant) => {
  it('reads "Partially Returned" ALONE for a pass still outside', () => {
    renderRow(pass({ status: 'matched', return_status: 'awaiting_return' }), variant);
    expect(screen.getByText('Partially Returned')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('reads "Closed" ALONE once every line is back', () => {
    renderRow(pass({ status: 'matched', return_status: 'returned' }), variant);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
    expect(screen.queryByText('Returned')).toBeNull();
    expect(screen.queryByText('Partially Returned')).toBeNull();
  });

  it('reads "Partially Returned" in between', () => {
    renderRow(pass({ return_status: 'partially_returned' }), variant);
    expect(screen.getByText('Partially Returned')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  // An NRGP never comes back, so the outward match IS its final state.
  it('reads "Closed" for a cleared NRGP, never "Matched"', () => {
    renderRow(pass({ type: 'NRGP', return_status: 'not_applicable' }), variant);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
    expect(screen.queryByText('Partially Returned')).toBeNull();
  });

  it('reads the status badge before the pass reaches the gate', () => {
    renderRow(pass({ status: 'pending', return_status: 'not_applicable' }), variant);
    expect(screen.getByText('Pending Gate Review')).toBeInTheDocument();
    expect(screen.queryByText('Partially Returned')).toBeNull();
  });

  // An overdue pass gets the orange TONE, never an 'Overdue' label — several
  // KPIs and drills are named "Overdue" and exact-text lookups of those must
  // stay unambiguous.
  it('names a late pill "Overdue"', () => {
    renderRow(pass({ return_status: 'awaiting_return', is_overdue: true }), variant);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Partially Returned')).toBeNull();
  });
});

// The badge lost the outward match; the timeline must have gained it, or the
// fact is simply gone from the UI.
describe('the expanded card carries the history the badge dropped', () => {
  const AT = '2026-08-01T07:00:00Z';

  it('shows "Cleared Out" in the drill card body of a returned pass', () => {
    renderRow(
      pass({ status: 'matched', verified_at: AT, return_status: 'returned', actual_return_date: AT }),
      'drill',
    );
    expect(screen.getByText('Cleared Out')).toBeInTheDocument();
    expect(screen.getByText('Returned')).toBeInTheDocument();
  });
});
