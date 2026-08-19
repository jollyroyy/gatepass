// The HOD dashboard's drill cards, renovated 2026-08-11.
//
// Client feedback: "make the stacked cards under the dashboard like the gate
// console's card view, but compact, and completely remove the Raised By
// field." The HOD raised the pass — telling them "Raised By P M Sharma" on
// their own board is noise.
//
// So a drill card is now the shadcn Card idiom (`PassRow variant="drill"`):
// a CardHeader carrying identity + state only,
// a CardContent of labelled facts, and a CardFooter for the one action. What
// differs is density (`dense`) and the omitted field (`showRaisedBy={false}`).
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import DrillList from '../../src/components/DrillList';
import { drillDefOf } from '../../src/lib/boardDrills';

// The HOD board carries its rows on a `BoardDrill` and adapts it through
// `drillDefOf` — `src/lib/hodDrills.ts` and its ten flat KPI definitions were
// deleted with the 2026-08-17 rebuild. `DrillList` reads only `heading` and
// `empty`, so a hand-built drill is the honest fixture here.
const AWAITING = drillDefOf({
  key: 'kpi-outside',
  heading: 'Still out',
  empty: 'Nothing is still out.',
  rows: [],
});

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'P M Sharma',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Servicing', expected_return_date: '2026-08-20', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 2, total_quantity: 3, returned_quantity: 0, total_value: 4500,
    material_summary: 'Drill Machine, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Defaults to the HOD board's own setting (`showRaisedBy={false}`); pass
 *  true to render it the way the admin board does. */
function renderList(rows: GatePassView[], showRaisedBy = false) {
  return render(
    <MemoryRouter>
      <DrillList
        def={AWAITING}
        rows={rows}
        loading={false}
        showRaisedBy={showRaisedBy}
      />
    </MemoryRouter>,
  );
}

describe('HOD drill cards', () => {
  it('uses the gate-console card idiom — a header and a body, not a bare row', () => {
    renderList([pass()]);
    expect(screen.getByTestId('pass-card-header')).toBeInTheDocument();
    expect(screen.getByTestId('pass-card-body')).toBeInTheDocument();
  });

  it('shows identity and state in the header', () => {
    renderList([pass()]);
    const header = screen.getByTestId('pass-card-header');
    expect(header).toHaveTextContent('RGP-OUT-20260811-0001');
    // ONE pill, naming the latest state. Not "Matched  Out — Not Returned":
    // the outward match is history the moment the return loop starts, and it
    // lives in the body's timeline instead (client, 2026-08-11).
    expect(header).toHaveTextContent('Out — Not Returned');
    expect(header).not.toHaveTextContent('Matched');
  });

  it('carries the facts an HOD needs in the body', () => {
    renderList([pass()]);
    const body = screen.getByTestId('pass-card-body');
    expect(body).toHaveTextContent('Drill Machine, Ladder');
    expect(body).toHaveTextContent('WB01AB1234');
    expect(body).toHaveTextContent('Engineering');
  });

  // The point of the change.
  it('never shows "Raised By" on the HOD board', () => {
    renderList([pass()]);
    expect(screen.queryByText('Raised By')).toBeNull();
    expect(screen.queryByText('P M Sharma')).toBeNull();
  });

  // The admin board oversees every department, so who raised a pass is real
  // information there — the omission is HOD-specific, not global.
  it('still shows "Raised By" when the consumer asks for it', () => {
    renderList([pass()], true);
    expect(screen.getByText('Raised By')).toBeInTheDocument();
    expect(screen.getByText('P M Sharma')).toBeInTheDocument();
  });

  it('offers one route to the full pass', () => {
    renderList([pass()]);
    expect(screen.getByRole('link', { name: /full details/i })).toHaveAttribute('href', '/pass/p1');
  });

  it('renders the drill heading, count and empty state', () => {
    renderList([]);
    expect(screen.getByText(AWAITING.heading)).toBeInTheDocument();
    expect(screen.getByText(AWAITING.empty)).toBeInTheDocument();
  });

  it('renders one card per pass', () => {
    renderList([pass({ id: 'p1' }), pass({ id: 'p2', pass_number: 'RGP-OUT-20260811-0002' })]);
    expect(screen.getAllByTestId('pass-card-header')).toHaveLength(2);
  });
});
