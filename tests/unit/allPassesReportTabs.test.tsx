// The status filter tabs were moved OFF AllPassesReport in the 2026-08-08 change
// that lifted Reports' filters up to the page (ReportsFilterBar), so a filtered
// report says on the paper which scope it was printed under. This spec is what
// stops them creeping back onto the register itself.
//
// It lived in adminDashboardKpis.test.tsx until the board was rebuilt
// (2026-08-17) and that file was replaced by gateBoard.test.tsx; the coverage
// moved here rather than being dropped.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import AllPassesReport from '../../src/pages/Admin/AllPassesReport';

const ROW_A = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260730-0001',
  type: 'RGP',
  department_id: 'd1',
  department_name: 'IT',
  visitor_name: 'Alice',
  material_summary: 'Bolts',
  item_count: 2,
  total_quantity: 10,
  status: 'pending',
  raised_by_name: 'HOD One',
  created_at: '2026-07-29T10:00:00Z',
  vehicle_number: null,
  is_expired: false,
} as unknown as GatePassView;

const ROW_B = { ...ROW_A, id: 'p2', pass_number: 'RGP-OUT-20260730-0002', status: 'flagged' } as unknown as GatePassView;

describe('AllPassesReport status tabs removed', () => {
  it('renders no status filter tab group, but keeps the Status column', () => {
    render(
      <MemoryRouter>
        <AllPassesReport rows={[ROW_A, ROW_B]} onRowsChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /Pending for Gate Approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mismatched/ })).not.toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
