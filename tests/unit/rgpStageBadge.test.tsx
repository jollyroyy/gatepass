// The second pill on a pass card: where the RGP return loop stands.
//
// Client complaint, 2026-08-11: "once the RGP is cleared for going out it
// shows as matched and not cleared — it is half matched, half not yet
// closed." Both an RGP still outside the mall and one that came back and
// closed are `status: 'matched'`, so the single status badge showed them
// identically. `rgpStageStyle` (src/lib/rgpLifecycle.ts) derives the missing
// half from `return_status`; these tests pin that every card surface actually
// renders it BESIDE the status badge — "Matched" must survive, because the
// guard still needs to know the gate cleared it.
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

describe.each(['row', 'drill'] as const)('RGP stage pill — %s variant', (variant) => {
  it('shows "Matched" AND "Out — Not Returned" for a pass still outside', () => {
    renderRow(pass({ status: 'matched', return_status: 'awaiting_return' }), variant);
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Out — Not Returned')).toBeInTheDocument();
  });

  it('shows "Closed" once every line is back', () => {
    renderRow(pass({ status: 'matched', return_status: 'returned' }), variant);
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Out — Not Returned')).toBeNull();
  });

  it('shows "Partly Returned" in between', () => {
    renderRow(pass({ return_status: 'partially_returned' }), variant);
    expect(screen.getByText('Partly Returned')).toBeInTheDocument();
  });

  it('adds no pill to an NRGP — it never comes back', () => {
    renderRow(pass({ type: 'NRGP', return_status: 'not_applicable' }), variant);
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.queryByText('Out — Not Returned')).toBeNull();
    expect(screen.queryByText('Closed')).toBeNull();
  });

  it('adds no pill to an RGP that has not reached the gate', () => {
    renderRow(pass({ status: 'pending', return_status: 'not_applicable' }), variant);
    expect(screen.queryByText('Out — Not Returned')).toBeNull();
  });

  // An overdue pass gets the orange TONE, never an 'Overdue' label — several
  // KPIs and drills are named "Overdue" and exact-text lookups of those must
  // stay unambiguous.
  it('never renames the pill to "Overdue"', () => {
    renderRow(pass({ return_status: 'awaiting_return', is_overdue: true }), variant);
    expect(screen.getByText('Out — Not Returned')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).toBeNull();
  });
});
