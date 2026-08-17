// The compact stack card (PassRow variant="row" compact): collapsed it shows
// exactly ITEM / VALUE / REASON plus identity and status — nothing else; a
// click reveals the remaining facts inline, with the old navigation path
// surviving as a "View full pass" affordance inside the opened card.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import PassRow from '../../src/components/PassRow';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260810-0001', type: 'RGP', direction: 'out',
    status: 'flagged', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Repair of AC units', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: 'Qty short',
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill Machine', total_value: 25000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function renderRow(over: Partial<GatePassView> = {}) {
  return render(
    <MemoryRouter>
      <PassRow pass={pass(over)} to={`/pass/${over.id ?? 'x'}`} compact />
    </MemoryRouter>
  );
}

describe('PassRow compact', () => {
  it('collapsed: shows identity, Item, Value, Reason, flag reason and status — nothing else', () => {
    renderRow();
    expect(screen.getByText('RGP-OUT-20260810-0001')).toBeInTheDocument();
    expect(screen.getByText('Drill Machine')).toBeInTheDocument(); // Item
    // Exact rupees, never "₹25K" — see tests/unit/formatCurrency.test.ts.
    expect(screen.getByText('₹25,000')).toBeInTheDocument();        // Value
    expect(screen.getByText('Repair of AC units')).toBeInTheDocument(); // Reason
    expect(screen.getByText('Qty short')).toBeInTheDocument();      // flag reason trail
    expect(screen.getByText('Mismatched')).toBeInTheDocument();     // status pill

    // The facts the HOD did NOT ask to see collapsed are hidden until opened.
    expect(screen.queryByText('Ravi')).not.toBeInTheDocument();
    expect(screen.queryByText('WB01AB1234')).not.toBeInTheDocument();
    expect(screen.queryByText('HOD One')).not.toBeInTheDocument();
  });

  it('clicking the card reveals the remaining facts inline', () => {
    renderRow();
    fireEvent.click(screen.getByText('RGP-OUT-20260810-0001'));

    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.getByText('WB01AB1234')).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('Raised')).toBeInTheDocument(); // timeline label
  });

  // This component is used ONLY by HOD surfaces (MyPassesTable,
  // FlaggedReviewCard), and the HOD raised every pass on them — their own name
  // back at them is noise (client feedback, 2026-08-11). Pinned so it cannot
  // creep back in.
  it('never shows "Raised By", opened or closed', () => {
    renderRow();
    expect(screen.queryByText('Raised By')).toBeNull();
    fireEvent.click(screen.getByText('RGP-OUT-20260810-0001'));
    expect(screen.queryByText('Raised By')).toBeNull();
    expect(screen.queryByText('HOD One')).toBeNull();
  });

  it('the expanded card keeps the navigation as a View full pass link', () => {
    renderRow();
    fireEvent.click(screen.getByText('RGP-OUT-20260810-0001'));

    const link = screen.getByRole('link', { name: /view full pass/i });
    expect(link).toHaveAttribute('href', '/pass/x');
  });

  it('clicking View full pass does not collapse the card', () => {
    renderRow();
    fireEvent.click(screen.getByText('RGP-OUT-20260810-0001'));
    const link = screen.getByRole('link', { name: /view full pass/i });
    fireEvent.click(link);
    expect(screen.getByText('Ravi')).toBeInTheDocument(); // still open
  });

  it('Value falls back to — when no line declared a value', () => {
    renderRow({ total_value: 0 });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('Reason falls back to — when the pass has no purpose', () => {
    renderRow({ purpose: '' });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('a pass without a flag reason shows no red trail', () => {
    renderRow({ flag_reason: null });
    expect(screen.queryByText('Qty short')).not.toBeInTheDocument();
  });
});