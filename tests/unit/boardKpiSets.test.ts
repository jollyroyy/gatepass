// WHICH KPI CARDS EXIST is a function of the category toggle, not a constant.
//
// Client, 2026-08-17: "make sure you dynamically change those KPI buttons
// depending on what we have selected… for NRGP you have mentioned return
// information but NRGP does not have any return information… remove all the
// unnecessary KPIs which are not relevant to that particular selected item…
// when we are selecting All it should mention how many total NRGP has been
// raised, and RGP In and Out."
//
// The two rules this file pins, both of which a later edit could break without
// any screen looking obviously wrong:
//
//   1. NO RETURN CARD ON AN NRGP BOARD. `gate_passes_return_status_rgp_only`
//      (001) pins an NRGP to `not_applicable`, so Pending Return and Overdue
//      Returns can only ever read zero there. A permanent zero is not a
//      measurement, it is a wrong reading of a category that has no return leg.
//   2. NO CATEGORY COUNTER ON A NARROWED BOARD. "RGP Out Raised" on an RGP Out
//      board is "Passes Raised" with a second name — two cards that can never
//      disagree are one card and a decoration.
import { describe, it, expect } from 'vitest';
import {
  BOARD_KPIS,
  boardKpiOrder,
  categoryHasReturns,
  type BoardKpiKey,
} from '../../src/lib/boardDrills';
import { BOARD_CATEGORY_OPTIONS, type BoardCategory } from '../../src/lib/boardCategory';

const CATEGORIES = BOARD_CATEGORY_OPTIONS.map((o) => o.key);
const RETURN_KPIS: BoardKpiKey[] = ['outside', 'overdue'];
const COUNTERS: BoardKpiKey[] = ['rgpOut', 'rgpIn', 'nrgpOut'];

describe('the headline row is chosen by the category', () => {
  it('covers every category the toggle can offer', () => {
    for (const c of CATEGORIES) {
      expect(boardKpiOrder(c as BoardCategory).length).toBeGreaterThan(0);
    }
  });

  it('defines every key it names', () => {
    for (const c of CATEGORIES) {
      for (const key of boardKpiOrder(c as BoardCategory)) {
        expect(BOARD_KPIS[key]).toBeDefined();
      }
    }
  });

  it('names no key twice in one row', () => {
    for (const c of CATEGORIES) {
      const row = boardKpiOrder(c as BoardCategory);
      expect(new Set(row).size).toBe(row.length);
    }
  });

  it('always leads with Passes Raised', () => {
    for (const c of CATEGORIES) {
      expect(boardKpiOrder(c as BoardCategory)[0]).toBe('raised');
    }
  });

  it('offers the three category counters on All, and only on All', () => {
    expect(boardKpiOrder('all')).toEqual(
      expect.arrayContaining(COUNTERS),
    );
    for (const c of ['RGP-out', 'RGP-in', 'NRGP-out'] as BoardCategory[]) {
      for (const counter of COUNTERS) expect(boardKpiOrder(c)).not.toContain(counter);
    }
  });

  it('drops both return cards on NRGP Out, and keeps them on both RGP legs', () => {
    for (const gone of RETURN_KPIS) expect(boardKpiOrder('NRGP-out')).not.toContain(gone);
    for (const c of ['RGP-out', 'RGP-in'] as BoardCategory[]) {
      for (const kept of RETURN_KPIS) expect(boardKpiOrder(c)).toContain(kept);
    }
  });

  it('agrees with categoryHasReturns, which drives the panels below the cards', () => {
    for (const c of CATEGORIES) {
      const hasReturnCard = boardKpiOrder(c as BoardCategory).some((k) => RETURN_KPIS.includes(k));
      expect(hasReturnCard).toBe(categoryHasReturns(c as BoardCategory));
    }
  });

  it('fits a grid the row component actually has a width for', () => {
    // BoardKpiRow's XL_COLUMNS is a lookup, not an interpolated class — a row
    // length it has no entry for falls back to 5 columns and looks broken.
    for (const c of CATEGORIES) {
      expect(boardKpiOrder(c as BoardCategory).length).toBeLessThanOrEqual(6);
      expect(boardKpiOrder(c as BoardCategory).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the cards themselves', () => {
  it('no longer calls anything "Materials Outside", which the client could not read', () => {
    const labels = Object.values(BOARD_KPIS).map((k) => k.label);
    expect(labels).not.toContain('Materials Outside');
    expect(BOARD_KPIS.outside.label).toBe('Pending Return');
  });

  it('draws no headline figure in the brand gold', () => {
    // Gold is this system's primary FILL — the sidebar's active link, the
    // primary button, the wordmark. As ink on a card it is ~2:1 against the
    // surface, which is exactly the "not visible" the client reported.
    for (const kpi of Object.values(BOARD_KPIS)) expect(kpi.tone).not.toBe('brand');
  });

  it('counts each category with the same lookup the toggle filters on', () => {
    // Not a string built by concatenation: `categoryKey` is what
    // `filterByCategory` uses, so a counter and the board it sits on cannot
    // disagree about what an inbound pass is.
    const rgpOut = { type: 'RGP', direction: 'out' } as never;
    const rgpIn = { type: 'RGP', direction: 'in' } as never;
    const nrgp = { type: 'NRGP', direction: 'out' } as never;

    expect([rgpOut, rgpIn, nrgp].filter(BOARD_KPIS.rgpOut.match)).toEqual([rgpOut]);
    expect([rgpOut, rgpIn, nrgp].filter(BOARD_KPIS.rgpIn.match)).toEqual([rgpIn]);
    expect([rgpOut, rgpIn, nrgp].filter(BOARD_KPIS.nrgpOut.match)).toEqual([nrgp]);
  });
});
