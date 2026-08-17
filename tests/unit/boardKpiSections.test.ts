// The three KPI sections of the rebuilt board (2026-08-17): RGP Overview,
// NRGP Overview and Quick Summary.
//
// WHAT THIS FILE EXISTS TO PIN is the thing a reference-driven rebuild gets
// wrong most easily: a card whose LABEL says one thing and whose SCOPE counts
// another. "RGP Out Today" must be scoped to the period; "RGP Currently
// Outside" must NOT be — an open obligation raised last week is still outside
// today, and scoping it to Today would print 0 on a board with material off
// site. So every card declares a scope, and these tests assert the scope each
// card's own words promise.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  BOARD_KPIS,
  RGP_SECTION,
  NRGP_SECTION,
  SUMMARY_SECTION,
  type BoardKpiKey,
} from '../../src/lib/boardKpis';
import { kpiLabel, rowsFor, kpiDrill, type BoardWindows } from '../../src/lib/boardWindows';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260817-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable', is_overdue: false, is_expired: false,
    due_state: 'not_applicable', actual_return_date: null, expected_return_date: null,
    created_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

describe('the board KPI sections', () => {
  it('RGP Overview carries the seven reference figures, in the reference order', () => {
    expect(RGP_SECTION).toEqual([
      'rgpRequests', 'rgpOut', 'rgpReturned', 'rgpMismatch', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
    ]);
  });

  it('BOTH categories carry a mismatch card of their own', () => {
    // The client asked for a separate mismatch-at-gate card for RGP and for
    // NRGP (2026-08-17). One shared card would not tell an admin which kind of
    // material is stopped, and the two have completely different consequences:
    // a stopped RGP still owes a return, a stopped NRGP does not.
    expect(RGP_SECTION).toContain('rgpMismatch');
    expect(NRGP_SECTION).toContain('nrgpMismatch');
    expect(BOARD_KPIS.rgpMismatch.match({ ...pass({ type: 'RGP', status: 'flagged' }) })).toBe(true);
    expect(BOARD_KPIS.rgpMismatch.match({ ...pass({ type: 'NRGP', status: 'flagged' }) })).toBe(false);
    expect(BOARD_KPIS.nrgpMismatch.match({ ...pass({ type: 'NRGP', status: 'flagged' }) })).toBe(true);
    expect(BOARD_KPIS.nrgpMismatch.match({ ...pass({ type: 'RGP', status: 'flagged' }) })).toBe(false);
    // A mismatch is an open decision, not an event of the day it happened: a
    // day-scoped card would read 0 while material sat stopped at the barrier.
    expect(BOARD_KPIS.rgpMismatch.scope).toBe('current');
    expect(BOARD_KPIS.nrgpMismatch.scope).toBe('current');
  });

  it('NRGP Overview carries four figures and NONE of them is a return figure', () => {
    // `gate_passes_return_status_rgp_only` (001) pins an NRGP to
    // `not_applicable`, so a "currently outside" / "overdue" NRGP cannot exist
    // in this database. A permanent zero under a heading that cannot move is a
    // wrong reading, not reassurance — the reference's third NRGP card
    // ("Currently Outside") is therefore the one substitution on this board.
    expect(NRGP_SECTION).toHaveLength(4);
    for (const key of NRGP_SECTION) {
      expect(BOARD_KPIS[key].scope).not.toBe('returned');
      expect(BOARD_KPIS[key].key).not.toMatch(/outside|overdue|returned/i);
    }
  });

  it('Quick Summary carries the five reference roll-ups', () => {
    expect(SUMMARY_SECTION).toEqual([
      'totalRaised', 'totalCleared', 'pendingApprovals', 'overdueReturns', 'materialOutside',
    ]);
  });

  it('no headline card takes the brand gold tone', () => {
    // Gold is this system's primary FILL (sidebar active link, primary button,
    // wordmark) and reads at ~2:1 as ink on a card — the same defect the
    // notification panel had.
    for (const key of [...RGP_SECTION, ...NRGP_SECTION, ...SUMMARY_SECTION]) {
      expect(BOARD_KPIS[key].tone).not.toBe('brand');
    }
  });

  it('every key in the record belongs to exactly one section', () => {
    const all = [...RGP_SECTION, ...NRGP_SECTION, ...SUMMARY_SECTION];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(Object.keys(BOARD_KPIS) as BoardKpiKey[]));
  });
});

describe('a card\'s scope matches the words on it', () => {
  it('an "Out"/"Returned"/"Cleared" card is period-scoped; a "Currently"/"Due"/"Overdue" one is not', () => {
    expect(BOARD_KPIS.rgpOut.scope).toBe('period');
    expect(BOARD_KPIS.nrgpOut.scope).toBe('period');
    expect(BOARD_KPIS.nrgpCleared.scope).toBe('period');
    expect(BOARD_KPIS.totalRaised.scope).toBe('period');
    expect(BOARD_KPIS.totalCleared.scope).toBe('period');

    // A return is a MOVEMENT, dated by when the material came back — not by
    // when the pass was raised. Scoping it on `created_at` would drop today's
    // return of a pass raised last month, which is most of them.
    expect(BOARD_KPIS.rgpReturned.scope).toBe('returned');

    for (const key of ['rgpRequests', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
      'rgpMismatch', 'nrgpMismatch',
      'pendingApprovals', 'overdueReturns', 'materialOutside', 'nrgpPending'] as BoardKpiKey[]) {
      expect(BOARD_KPIS[key].scope).toBe('current');
    }
  });

  it('"Today" is appended only to a day-scoped label', () => {
    expect(kpiLabel(BOARD_KPIS.rgpOut)).toBe('RGP Out Today');
    expect(kpiLabel(BOARD_KPIS.rgpReturned)).toBe('RGP Returned Today');
    // A current-state card names its own scope already, and "RGP Currently
    // Outside Today" would claim a window it does not have.
    expect(kpiLabel(BOARD_KPIS.rgpOutside)).toBe('RGP Currently Outside');
    expect(kpiLabel(BOARD_KPIS.rgpOverdue)).toBe('RGP Overdue');
    expect(kpiLabel(BOARD_KPIS.rgpMismatch)).toBe('RGP Mismatched at Gate');
  });
});

describe('which array a card counts', () => {
  const TODAY = new Date().toISOString();
  const OLD = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

  const raisedToday = pass({ id: 'a', created_at: TODAY });
  const oldButStillOut = pass({
    id: 'b', created_at: OLD, status: 'matched', return_status: 'awaiting_return', is_overdue: true,
  });
  const returnedToday = pass({
    id: 'c', created_at: OLD, status: 'matched', return_status: 'returned', actual_return_date: TODAY,
  });

  const windows: BoardWindows = {
    raised: [raisedToday],
    returned: [returnedToday],
    all: [raisedToday, oldButStillOut, returnedToday],
  };

  it('a current-state card reads the WHOLE array, not the period window', () => {
    // The bug this pins: an overdue pass raised 40 days ago is invisible on a
    // Today-scoped board, and it is exactly the pass the card exists for.
    expect(rowsFor(BOARD_KPIS.rgpOverdue, windows).map((p) => p.id)).toEqual(['b']);
    expect(rowsFor(BOARD_KPIS.rgpOutside, windows).map((p) => p.id)).toEqual(['b']);
  });

  it('a period card reads the period window and a return card reads the return window', () => {
    expect(rowsFor(BOARD_KPIS.totalRaised, windows).map((p) => p.id)).toEqual(['a']);
    expect(rowsFor(BOARD_KPIS.rgpReturned, windows).map((p) => p.id)).toEqual(['c']);
  });

  it('carries no previous window at all — the delta line is gone', () => {
    // Client, 2026-08-17: "remove the 8 vs yesterday, 9 vs yesterday from all
    // the KPI cards". Removed rather than hidden: `BoardWindows` has no
    // previous array, so nothing on this board can compute a delta to show.
    expect(Object.keys(windows).sort()).toEqual(['all', 'raised', 'returned']);
  });

  it('an NRGP card never counts an RGP, and vice versa', () => {
    const rgp = pass({ id: 'r', type: 'RGP', direction: 'out', status: 'matched' });
    const nrgp = pass({ id: 'n', type: 'NRGP', direction: 'out', status: 'matched' });
    const w: BoardWindows = { raised: [rgp, nrgp], returned: [], all: [rgp, nrgp] };
    expect(rowsFor(BOARD_KPIS.nrgpCleared, w).map((p) => p.id)).toEqual(['n']);
    expect(rowsFor(BOARD_KPIS.rgpOut, w).map((p) => p.id)).toEqual(['r']);
  });

  it('a drill carries the rows the card counted, under the card\'s own key', () => {
    const rows = rowsFor(BOARD_KPIS.rgpOverdue, windows);
    const drill = kpiDrill('rgpOverdue', rows);
    expect(drill.key).toBe('kpi-rgpOverdue');
    expect(drill.rows).toBe(rows);
    expect(drill.heading).toBe(BOARD_KPIS.rgpOverdue.heading);
  });
});
