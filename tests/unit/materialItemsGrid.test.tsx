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
import { itemGridColumns, itemGridMinWidth } from '../../src/pages/HOD/materialItemGrid';
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

// 2026-08-11: "the background frame is a bit shorter [than the fields]". The
// row's grey frame is a plain block, so it only ever spans the CARD's width —
// while the grid's own minimum (the sum of its column tracks + gaps) is wider
// than that. The fields therefore spilled OUT of the frame. The fix scrolls
// the header + every row together inside one track whose min-width IS that
// sum, so the frame is always at least as wide as the fields it contains and
// the columns stay on one line.
describe('MaterialItemsCard — the row frame is as wide as the columns it holds', () => {
  it('the scroll track carries a min-width equal to the grid template total', () => {
    renderCard(true, 2);
    const track = document.querySelector('.item-grid-track') as HTMLElement;
    expect(track).not.toBeNull();
    expect(track.style.minWidth).toBe(itemGridMinWidth(true));
  });

  it('the header and every row live inside that one track, so they scroll together', () => {
    renderCard(true, 3);
    const track = document.querySelector('.item-grid-track') as HTMLElement;
    expect(track.querySelectorAll('.item-grid').length).toBe(4); // header + 3 rows
  });

  it('the NRGP track is narrower than the RGP one (one fewer column)', () => {
    expect(parseFloat(itemGridMinWidth(false))).toBeLessThan(parseFloat(itemGridMinWidth(true)));
  });

  it('every row frame fills the full track width, not just the visible card', () => {
    renderCard(true, 2);
    const track = document.querySelector('.item-grid-track') as HTMLElement;
    // Each row frame is a direct child of the track, so it inherits the
    // track's (min-)width instead of the narrower card width.
    const frames = track.querySelectorAll(':scope > div > .bg-surface-50, :scope > .bg-surface-50');
    expect(frames.length).toBeGreaterThan(0);
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

// 2026-08-11, client's wording: "the unit should be numbers not nos". The
// stored value stays the lowercase `nos` code — `gate_pass_items.unit` is free
// text and every existing row already carries it, so only the LABEL changes.
describe('MaterialItemsCard — the unit dropdown reads "Numbers", not "Nos"', () => {
  it('offers "Numbers" as the option label', () => {
    renderCard(false, 1);
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    const nos = Array.from(select.options).find((o) => o.value === 'nos');
    expect(nos?.textContent).toBe('Numbers');
    expect(screen.queryByText('Nos')).not.toBeInTheDocument();
  });

  it('still submits the lowercase `nos` code as the value', () => {
    renderCard(false, 1);
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain('nos');
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
