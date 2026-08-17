// My Passes now uses the dashboard's card idiom, trimmed.
//
// Client, 2026-08-11: "The My Passes cards are not properly showing it. Can you
// make it like the card format of the dashboard but with a little less
// information? Premium looking glass morphic design."
//
// So: the same `PassRow variant="drill"` shell DrillPassCard uses (identity
// header + one status pill + a labelled-fact body + a footer link), on a glass
// surface, collapsed by default, and carrying FEWER facts than the dashboard —
// no Visitor, no Department, no Raised By, no Raised At. What survives is what
// an HOD scans their own register for: what went out, what it was worth, on
// which vehicle, and when it is due back.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import MyPassCard from '../../src/pages/HOD/MyPassCard';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'returned',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Servicing', expected_return_date: '2026-08-05',
    actual_return_date: '2026-08-03T07:00:00Z',
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-01T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: null, created_at: '2026-08-01T04:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 2, total_quantity: 3, returned_quantity: 3, total_value: 25000,
    material_summary: 'Drill Machine, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function renderCard(over: Partial<GatePassView> = {}) {
  return render(
    <MemoryRouter>
      <MyPassCard pass={pass(over)} />
    </MemoryRouter>,
  );
}

describe('MyPassCard', () => {
  it('uses the dashboard card idiom — an identity header', () => {
    renderCard();
    const header = screen.getByTestId('pass-card-header');
    expect(header).toHaveTextContent('RGP-OUT-20260811-0001');
  });

  it('sits on a glass surface', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-glass')).not.toBeNull();
  });

  it('shows ONE status pill, naming the latest state', () => {
    renderCard({ status: 'matched', return_status: 'returned' });
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Matched')).toBeNull();
  });

  // Collapsed, the card must still be scannable — a stack of pass numbers with
  // nothing else is not a register.
  it('shows what went out and what it was worth while collapsed', () => {
    renderCard();
    expect(screen.queryByTestId('pass-card-body')).toBeNull();
    expect(screen.getByText(/Drill Machine, Ladder/)).toBeInTheDocument();
    // Exact rupees, never "₹25K" — see tests/unit/formatCurrency.test.ts.
    expect(screen.getByText(/₹25,000/)).toBeInTheDocument();
  });

  it('opens the detail on click', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pass-card-header'));
    expect(screen.getByTestId('pass-card-body')).toBeInTheDocument();
  });

  it('carries the trimmed fact set — and the timeline — once open', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pass-card-header'));
    const body = screen.getByTestId('pass-card-body');
    expect(body).toHaveTextContent('WB01AB1234');
    expect(body).toHaveTextContent('2 items');
    // The timeline is where the outward match lives now.
    expect(body).toHaveTextContent('Cleared Out');
    expect(body).toHaveTextContent('Returned');
  });

  // Less information than the dashboard: these are the fields dropped.
  it('never shows Visitor, Department, Raised By or Raised At', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pass-card-header'));
    const body = screen.getByTestId('pass-card-body');
    expect(body).not.toHaveTextContent('Ravi Kumar');
    expect(body).not.toHaveTextContent('Engineering');
    expect(body).not.toHaveTextContent('Raised By');
    expect(body).not.toHaveTextContent('Raised At');
  });

  it('links to the full pass', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('pass-card-header'));
    expect(screen.getByRole('link', { name: /Full details/ })).toHaveAttribute('href', '/pass/p1');
  });
});
