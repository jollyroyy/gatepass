// The 2026-08-10 layout fix for RaisePass's Material Items section: "the
// date and item and all those fields are not properly aligned in the same
// line, currently they are haphazard." The Return Date column only ever
// rendered for RGP and every field used an ad hoc width, so no two rows (or
// any header) agreed on where a column started.
//
// MaterialItemsCard/MaterialItemRow now share ONE grid template
// (materialItemGrid.ts, consumed by `.item-grid` in index.css) between the
// header row and every item row. This test file pins the load-bearing shape
// of that fix without touching raisePassSubmit.test.tsx's submit/validation
// coverage, which must keep passing unchanged.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaterialItemsCard from '../../src/pages/HOD/MaterialItemsCard';
import { itemGridColumns } from '../../src/pages/HOD/materialItemGrid';
import { EMPTY_ITEM } from '../../src/types';

function renderCard(showReturnDate: boolean, itemCount = 1) {
  const items = Array.from({ length: itemCount }, () => ({ ...EMPTY_ITEM }));
  return render(
    <MaterialItemsCard
      items={items}
      errors={{}}
      showReturnDate={showReturnDate}
      onItemChange={() => {}}
      onRemoveItem={() => {}}
      onAddItem={() => {}}
      todayStr="2026-08-10"
    />
  );
}

describe('materialItemGrid — one column template, shared', () => {
  it('the RGP template has one more column than the NRGP template (the Return Date slot)', () => {
    const withReturn = itemGridColumns(true).split(' ');
    const withoutReturn = itemGridColumns(false).split(' ');
    expect(withReturn.length).toBe(withoutReturn.length + 1);
  });
});

describe('MaterialItemsCard — RGP renders a Return Date column, NRGP does not', () => {
  it('shows exactly one "Return Date" column header and one date input for an RGP row', () => {
    renderCard(true, 1);
    expect(screen.getByText('Return Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Return Date')).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(1);
  });

  it('renders no Return Date column or input at all for an NRGP row', () => {
    renderCard(false, 1);
    expect(screen.queryByText('Return Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Return Date')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });

  it('the column header text appears exactly once regardless of item count (never repeated per row)', () => {
    renderCard(true, 3);
    expect(screen.getAllByText('Return Date')).toHaveLength(1);
    expect(screen.getAllByText('Item Name')).toHaveLength(1);
    expect(screen.getAllByText('Description')).toHaveLength(1);
  });
});

describe('MaterialItemsCard — adding items keeps the same column structure', () => {
  it('every row and the header carry the identical --item-grid-cols value', () => {
    renderCard(true, 3);
    const grids = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    // One header grid + one grid per item row.
    expect(grids.length).toBe(4);
    const templates = new Set(Array.from(grids).map((el) => el.style.getPropertyValue('--item-grid-cols')));
    expect(templates.size).toBe(1);
  });

  it('a date input exists for every RGP row, each independently labelled "Return Date"', () => {
    renderCard(true, 3);
    expect(screen.getAllByLabelText('Return Date')).toHaveLength(3);
  });
});

describe('MaterialItemsCard — the remove control has its own fixed-width column', () => {
  it('a single row (which cannot be removed) still reserves the same trailing grid column as the header', () => {
    renderCard(true, 1);
    const rows = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    const [header, row] = Array.from(rows);
    // No "Remove item" button should exist — the only item can't be removed —
    // yet the row must still have exactly as many grid children as the
    // header, i.e. the column is reserved (empty), never collapsed away.
    expect(screen.queryByRole('button', { name: /Remove item/ })).not.toBeInTheDocument();
    expect(row.children.length).toBe(header.children.length);
  });

  it('with two rows, every row (including one that cannot be removed) reserves the same trailing column', () => {
    renderCard(true, 2);
    const rows = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    // grids[0] is the header; the rest are item rows.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].children.length).toBe(rows[0].children.length);
    }
  });
});
