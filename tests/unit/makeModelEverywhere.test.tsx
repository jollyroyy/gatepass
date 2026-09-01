// "Put the make, model and brand name against each item across all the views"
// (client, 2026-08-23). `gate_pass_items.make_model` (migration 045) is that
// one field — "Make / Model / Size" on the raise form — and the expandable
// stacked card (PassStackItems) was the only list that gave it a column.
//
// This pins the column on every OTHER list of material lines: the pass record,
// the guard's Pending OUT disclosure, the guard's return panel and Scheduled
// Returns. A line raised before 045 carries none: the guard's gb-tables dash
// it, as they dash every other absent value, and the pass record leaves the
// cell empty, as it already does for Serial / ID.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import PendingReturnItems from '../../src/components/guard/PendingReturnItems';
import ScheduledReturnsTable from '../../src/components/returns/ScheduledReturnsTable';
import { EMPTY_DRAFT } from '../../src/lib/returnDraft';

const MAKE = 'Bosch GSB 13 RE';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260823-0001', type: 'RGP', status: 'matched',
    return_status: 'awaiting_return', is_expired: false, is_overdue: false,
    visitor_name: 'Ravi', department_name: 'Engineering',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine', description: 'Impact drill',
    make_model: MAKE, serial_no: 'SN-1', quantity: 3, unit: 'nos', returned_qty: 0,
    returned_at: null, approx_value: 500, expected_return_date: '2026-08-24', outstanding_qty: 3,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function headings(): (string | null)[] {
  return screen.getAllByRole('columnheader').map((h) => h.textContent);
}

describe('every list of material lines names the make / model', () => {
  it('the pass record gives it a column of its own', () => {
    render(<PassRecordItems pass={pass()} items={[line()]} draft={EMPTY_DRAFT} canRecord={false} onAdd={vi.fn()} />);
    expect(headings()).toContain('Make / Model');
    expect(screen.getByText(MAKE)).toBeTruthy();
  });

  it('leaves the record cell EMPTY on a line raised before migration 045 — never an em dash', () => {
    render(
      <PassRecordItems pass={pass()} items={[line({ make_model: null })]} draft={EMPTY_DRAFT} canRecord={false} onAdd={vi.fn()} />,
    );
    // Scoped to the Make / Model CELL, not the whole table: the status badge
    // beside it now legitimately reads "Out — Awaiting Return", which itself
    // contains an em dash (2026-09-01) — a container-wide search would catch
    // that word rather than the empty-cell rule this test actually pins.
    const headings = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headings).toContain('Make / Model');
    const makeModelCol = headings.indexOf('Make / Model');
    const dataRow = screen.getAllByRole('row')[1];
    const cells = within(dataRow).getAllByRole('cell');
    expect(cells[makeModelCol].textContent).toBe('');
  });

  it("the guard's return panel gives it a column of its own", () => {
    render(<PendingReturnItems items={[line()]} draft={EMPTY_DRAFT} onAdd={vi.fn()} />);
    expect(headings()).toContain('Make / Model');
    expect(screen.getByText(MAKE)).toBeTruthy();
  });

  it('Scheduled Returns gives it a column of its own', () => {
    const page = {
      rows: [{ item: line(), pass: pass(), stage: 'pending', expectedReturn: '2026-08-24' }],
      page: 1, pageCount: 1, total: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    render(
      <MemoryRouter>
        <ScheduledReturnsTable page={page} picked={new Set()} onToggle={vi.fn()} onPage={vi.fn()} busy={false} />
      </MemoryRouter>,
    );
    expect(headings()).toContain('Make / Model');
    expect(screen.getByText(MAKE)).toBeTruthy();
  });
});
