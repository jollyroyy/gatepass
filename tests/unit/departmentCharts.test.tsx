// Two department bar charts the client asked for on 2026-08-18:
//
//   * the admin dashboard — "make a vertical bar chart showing the departments
//     who are raising the most number of passes";
//   * the Overdue tab, admin scope — "a bar chart of which department has the
//     department-wise overdue items".
//
// Both are `ColumnChart` over a `Slice[]`, and both obey the board's standing
// invariant: a bar carries the rows it counted, so its height and the list its
// click opens can never disagree.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { departmentSlices } from '../../src/lib/boardAnalytics';
import { overdueByDepartment } from '../../src/lib/overdueItems';
import ColumnChart from '../../src/components/charts/ColumnChart';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One', visitor_name: 'Ravi',
    visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: '2026-08-01', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null,
    created_at: '2026-08-18T04:00:00Z', updated_at: '2026-08-18T04:00:00Z',
    is_overdue: true, is_expired: false, due_state: 'overdue',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('departmentSlices — who raises the most passes', () => {
  it('ranks departments by pass count, biggest first, and carries their rows', () => {
    // Bucketed by department_id — two departments may share a name across a
    // rename, and the id is what the rows actually belong to.
    const rows = [
      pass({ id: 'a', department_id: 'd1', department_name: 'Engineering' }),
      pass({ id: 'b', department_id: 'd1', department_name: 'Engineering' }),
      pass({ id: 'c', department_id: 'd2', department_name: 'Housekeeping' }),
    ];
    const slices = departmentSlices(rows, 5);
    expect(slices.map((s) => [s.label, s.value])).toEqual([
      ['Engineering', 2], ['Housekeeping', 1],
    ]);
    expect(slices[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps a pass whose department did not resolve, under one honest label', () => {
    const slices = departmentSlices([pass({ department_id: null, department_name: null })], 5);
    expect(slices).toHaveLength(1);
    expect(slices[0].label).toBe('Unassigned');
  });

  it('caps the ranking at the limit it is given', () => {
    const rows = ['A', 'B', 'C', 'D'].map((d, i) =>
      pass({ id: `p${i}`, department_id: `d${i}`, department_name: d }));
    expect(departmentSlices(rows, 2)).toHaveLength(2);
  });
});

describe('overdueByDepartment — where the late material is', () => {
  it('counts overdue LINES per department, biggest first', () => {
    const rows = [
      { pass: pass({ department_id: 'd1', department_name: 'Engineering' }), daysLate: 2 },
      { pass: pass({ department_id: 'd1', department_name: 'Engineering' }), daysLate: 5 },
      { pass: pass({ department_id: 'd2', department_name: 'F&B' }), daysLate: 1 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[];
    expect(overdueByDepartment(rows).map((s) => [s.label, s.value])).toEqual([
      ['Engineering', 2], ['F&B', 1],
    ]);
  });

  it('is empty when nothing is overdue — never a chart of zeroes', () => {
    expect(overdueByDepartment([])).toEqual([]);
  });
});

describe('ColumnChart', () => {
  const slices = [
    { key: 'a', label: 'Engineering', value: 4, rows: [] },
    { key: 'b', label: 'F&B', value: 1, rows: [] },
  ];

  it('draws one labelled column per slice, with its value', () => {
    render(<ColumnChart slices={slices} valueLabel="passes" />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('F&B')).toBeInTheDocument();
    const bars = screen.getAllByTestId('column-bar');
    expect(bars).toHaveLength(2);
    // The tallest bar is the biggest value; heights are relative to it.
    expect(bars[0].style.height).toBe('100%');
    expect(bars[1].style.height).toBe('25%');
  });

  it('says so plainly when there is nothing to plot', () => {
    render(<ColumnChart slices={[]} valueLabel="passes" empty="Nothing to show." />);
    expect(screen.getByText('Nothing to show.')).toBeInTheDocument();
  });
});

// ─── The baseline (client, 2026-08-18) ──────────────────────────────────────
// The columns used to stand on different lines: the shell was one flex column
// and the LABEL was inside it, so a department whose name wrapped to two lines
// stole a line's height from the plot above it and that bar started lower. The
// plot is a fixed box now and the label sits under it in a fixed box of its own.
describe('ColumnChart — one baseline for every column', () => {
  it('gives every column a plot area of the same fixed height', () => {
    render(<ColumnChart
      slices={[
        { key: 'a', label: 'Engineering', value: 4, rows: [] },
        { key: 'b', label: 'Housekeeping and Facilities Management', value: 1, rows: [] },
      ]}
      valueLabel="passes"
    />);
    const plots = screen.getAllByTestId('column-plot');
    expect(plots).toHaveLength(2);
    expect(plots[0].style.height).toBe(plots[1].style.height);
    expect(plots[0].style.height).not.toBe('');
  });

  it('boxes the label so a long department name cannot move the baseline', () => {
    render(<ColumnChart
      slices={[{ key: 'a', label: 'Housekeeping and Facilities Management', value: 4, rows: [] }]}
      valueLabel="passes"
    />);
    const label = screen.getByText('Housekeeping and Facilities Management');
    expect(label.className).toMatch(/\bh-8\b/);
    expect(label.className).toMatch(/overflow-hidden/);
  });
});

// ─── Today only (client, 2026-08-18) ────────────────────────────────────────
describe('BoardDepartments — today, not all time', () => {
  it('counts only passes raised today', async () => {
    const BoardDepartments = (await import('../../src/components/board/BoardDepartments')).default;
    const today = new Date(); today.setHours(9, 0, 0, 0);
    const rows = [
      pass({ id: 'a', department_id: 'd1', department_name: 'Engineering', created_at: today.toISOString() }),
      pass({ id: 'b', department_id: 'd2', department_name: 'Housekeeping', created_at: '2026-01-02T04:00:00Z' }),
    ];
    render(<BoardDepartments rows={rows} loading={false} />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Housekeeping')).not.toBeInTheDocument();
  });
});
