// The "Item-wise Details" table on RaisePass.tsx, drawn to the client's
// 2026-08-19 "Raise Gate Pass" mock-up. MaterialItemsCard/MaterialItemRow
// share ONE grid template (materialItemGrid.ts, consumed by `.item-grid` in
// index.css) between the header row and every item row.
//
// Column order, left to right (see materialItemGrid.ts):
//
//   #  ·  Item Description  ·  Quantity  ·  Unit  ·  Make / Model / Size  ·
//   Serial / Asset Tag  ·  Order No.  ·  Remarks  ·
//   Expected Return Date (RGP only)  ·  Action
//
// THE UNIT COLUMN IS BACK (client, 2026-08-20) — this file used to hold that
// there was none, which is exactly what left every line `nos`. There is still
// NO PURPOSE and NO VALUE column: purpose is asked once for the whole pass.
// The per-line date is the ONE RGP/NRGP variant of this template.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialItemsCard from '../../src/pages/HOD/MaterialItemsCard';
import { itemGridColumns, itemGridMinWidth } from '../../src/pages/HOD/materialItemGrid';
import { EMPTY_ITEM } from '../../src/types';

function renderCard(itemCount = 1) {
  const items = Array.from({ length: itemCount }, () => ({ ...EMPTY_ITEM }));
  return render(
    <MaterialItemsCard
      items={items}
      errors={{}}
      onItemChange={() => {}}
      onRemoveItem={() => {}}
      onAddItem={() => {}}
      showReturnDate={false}
    />
  );
}

const HEADER_LABELS = [
  '#',
  'Item Description',
  'Quantity',
  'Unit',
  'Make / Model / Size',
  'Serial / Asset Tag',
  'Order No.',
  'Remarks',
  'Action',
];

describe('materialItemGrid — one column template, one RGP-only variant', () => {
  // REWRITTEN 2026-08-20: it used to hold NINE tracks. The tenth is
  // "Approx. Value (Rs)", back on both pass types (client: "make a field for
  // the HOD to input the approx value for each item in our GP and RGP form").
  it('has ten columns: # · Item Description · Quantity · Unit · Approx. Value · Make/Model/Size · Serial/Asset Tag · Order No. · Remarks · Action', () => {
    expect(itemGridColumns(false).split(' ')).toHaveLength(10);
  });

  it('an RGP splices the per-line return date in before Action', () => {
    expect(itemGridColumns(true).split(' ')).toHaveLength(11);
  });
});

// 2026-08-11: "the background frame is a bit shorter [than the fields]". The
// row's grey frame is a plain block, so it only ever spans the CARD's width —
// while the grid's own minimum (the sum of its column tracks + gaps) is wider
// than that. The fix scrolls the header + every row together inside one track
// whose min-width IS that sum, so the frame is always at least as wide as the
// fields it contains and the columns stay on one line.
describe('MaterialItemsCard — the row frame is as wide as the columns it holds', () => {
  it('the scroll track carries a min-width equal to the grid template total', () => {
    renderCard(2);
    const track = document.querySelector('.item-grid-track') as HTMLElement;
    expect(track).not.toBeNull();
    expect(track.style.minWidth).toBe(itemGridMinWidth(false));
  });

  it('the header and every row live inside that one track, so they scroll together', () => {
    renderCard(3);
    const track = document.querySelector('.item-grid-track') as HTMLElement;
    expect(track.querySelectorAll('.item-grid').length).toBe(4); // header + 3 rows
  });
});

describe('MaterialItemsCard — the header names every column exactly once', () => {
  it('renders each column header exactly once, regardless of item count', () => {
    renderCard(3);
    for (const label of HEADER_LABELS) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
  });

  // REWRITTEN 2026-08-20: this case used to hold that there was no Unit column
  // either ("the mock has none of them"). The client asked for the dropdown
  // back — see raiseUnitSelect.test.tsx — so only Purpose and Value are banned.
  it('renders no Purpose or Value column — purpose is asked once for the whole pass', () => {
    renderCard(1);
    expect(screen.queryByText('UOM')).not.toBeInTheDocument();
    expect(screen.queryByText('Purpose')).not.toBeInTheDocument();
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
  });

  // An NRGP draws no date column at all — the RGP half is pinned in
  // raisePassReturnDate.test.tsx, which mounts the real form.
  it('renders no Expected Return Date column or input on an NRGP', () => {
    renderCard(1);
    expect(screen.queryByText('Expected Return Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expected Return Date')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });
});

describe('MaterialItemsCard — every row carries one input per column', () => {
  it('renders one input per row for every named field, keyed by its aria-label', () => {
    renderCard(3);
    expect(screen.getAllByLabelText('Item Description')).toHaveLength(3);
    expect(screen.getAllByLabelText('Quantity')).toHaveLength(3);
    expect(screen.getAllByLabelText('Make / Model / Size')).toHaveLength(3);
    expect(screen.getAllByLabelText('Serial / Asset Tag')).toHaveLength(3);
    expect(screen.getAllByLabelText('Order No.')).toHaveLength(3);
    expect(screen.getAllByLabelText('Remarks')).toHaveLength(3);
  });

  it('the Quantity input takes whole numbers only — every line raised here is nos', () => {
    renderCard(1);
    const qty = screen.getByLabelText('Quantity') as HTMLInputElement;
    expect(qty.type).toBe('number');
    expect(qty.step).toBe('1');
    expect(qty.min).toBe('1');
  });
});

describe('MaterialItemsCard — adding items keeps the same column structure', () => {
  it('every row and the header carry the identical --item-grid-cols value', () => {
    renderCard(3);
    const grids = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    // One header grid + one grid per item row.
    expect(grids.length).toBe(4);
    const templates = new Set(Array.from(grids).map((el) => el.style.getPropertyValue('--item-grid-cols')));
    expect(templates.size).toBe(1);
  });

  it('"Add Another Item" calls back to the parent, which owns the item array', () => {
    // MaterialItemsCard is controlled — it renders `items` as given and never
    // holds its own copy, so pressing the button must call `onAddItem` rather
    // than mutate anything locally.
    let added = false;
    render(
      <MaterialItemsCard
        items={[{ ...EMPTY_ITEM }]}
        errors={{}}
        onItemChange={() => {}}
        onRemoveItem={() => {}}
        onAddItem={() => {
          added = true;
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Another Item/ }));
    expect(added).toBe(true);
  });
});

describe('MaterialItemsCard — the remove control has its own fixed-width column', () => {
  it('a single row (which cannot be removed) still reserves the same trailing grid column as the header', () => {
    renderCard(1);
    const rows = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    const [header, row] = Array.from(rows);
    // No "Remove item" button should exist — the only item can't be removed —
    // yet the row must still have exactly as many grid children as the
    // header, i.e. the column is reserved (empty), never collapsed away.
    expect(screen.queryByRole('button', { name: /Remove item/ })).not.toBeInTheDocument();
    expect(row.children.length).toBe(header.children.length);
  });

  it('with two rows, every row (including one that cannot be removed) reserves the same trailing column', () => {
    renderCard(2);
    const rows = document.querySelectorAll('.item-grid') as NodeListOf<HTMLElement>;
    // grids[0] is the header; the rest are item rows.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].children.length).toBe(rows[0].children.length);
    }
  });
});
