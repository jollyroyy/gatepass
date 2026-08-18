// The two KPI sections of the board: RGP Overview and NRGP
// Overview.
//
// TODAY'S SUMMARY IS THE ROLL-UP ROW, and it leads the board (client,
// 2026-08-18): five figures across BOTH categories, so a reader who wants the
// site-wide picture does not have to add an RGP tile to an NRGP one. It restates
// the rows below it ON PURPOSE — that is what a summary is — and every one of its
// tiles drills to the same rows the tiles it sums do.
//
// WHAT THIS FILE EXISTS TO PIN is the thing a reference-driven rebuild gets
// wrong most easily: a card whose LABEL says one thing and whose SCOPE counts
// another. "RGP Raised" must be scoped to the period; "RGP Currently Outside"
// must NOT be — an open obligation raised last week is still outside today, and
// scoping it to Today would print 0 on a board with material off site. So every
// card declares a scope, and these tests assert the scope each card's own words
// promise.
//
// NO LABEL SAYS "TODAY" (client, 2026-08-18). The word is on the board header
// chip once, and a test below pins that no tile grew it back.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  BOARD_KPIS,
  RGP_SECTION,
  NRGP_SECTION,
  type BoardKpiKey,
} from '../../src/lib/boardKpis';
import { rowsFor, kpiDrill, type BoardWindows } from '../../src/lib/boardWindows';

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
  it('RGP Overview leads with the same three figures as NRGP, in the same order', () => {
    // Client, 2026-08-18: "RGP raised, RGP awaiting clearance, RGP cleared" —
    // the NRGP row's three facts, mirrored, so a reader comparing the two halves
    // of the traffic reads the same words in the same places. The return leg
    // follows, and only RGP has one.
    expect(RGP_SECTION).toEqual([
      'rgpRaised', 'rgpAwaiting', 'rgpCleared',
      'rgpReturned', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
    ]);
    expect(NRGP_SECTION).toEqual(['nrgpRaised', 'nrgpAwaiting', 'nrgpCleared']);
    expect(RGP_SECTION.slice(0, 3).map((k) => BOARD_KPIS[k].label.replace('RGP ', '')))
      .toEqual(NRGP_SECTION.map((k) => BOARD_KPIS[k].label.replace('NRGP ', '')));
  });

  it('a pass that expired at the gate is NOT counted as waiting there', () => {
    // "Null and void": `match_pass` refuses an expired pass, so nothing the
    // guard does will clear it. Counting it under Requests / Pending Approvals
    // reported a queue longer than the one that exists, and told the HOD their
    // dead paperwork was still alive.
    const live = pass({ id: 'live', status: 'pending', is_expired: false });
    const dead = pass({ id: 'dead', status: 'pending', is_expired: true });
    expect(BOARD_KPIS.rgpAwaiting.match(live)).toBe(true);
    expect(BOARD_KPIS.rgpAwaiting.match(dead)).toBe(false);
    const nrgpLive = pass({ id: 'n1', type: 'NRGP', status: 'pending', is_expired: false });
    const nrgpDead = pass({ id: 'n2', type: 'NRGP', status: 'pending', is_expired: true });
    expect(BOARD_KPIS.nrgpAwaiting.match(nrgpLive)).toBe(true);
    expect(BOARD_KPIS.nrgpAwaiting.match(nrgpDead)).toBe(false);
  });

  it('no tile row carries a mismatch card any more', () => {
    // They were dropped to match the reference layout box for box. A mismatch is
    // NOT lost with them: it reaches the raising HOD on the notification bell,
    // opens a decision screen, and both boards carry an attention strip above
    // the sections. `BoardAttention` is what a test for that reads.
    const all = [...RGP_SECTION, ...NRGP_SECTION];
    expect(all.filter((k) => /mismatch/i.test(k))).toEqual([]);
  });

  it('NRGP Overview carries three figures and NONE of them is a return figure', () => {
    // `gate_passes_return_status_rgp_only` (001) pins an NRGP to
    // `not_applicable`, so a "currently outside" / "overdue" NRGP cannot exist
    // in this database. A permanent zero under a heading that cannot move is a
    // wrong reading, not reassurance — the reference's third NRGP card
    // ("Currently Outside") is therefore the one substitution on this board.
    expect(NRGP_SECTION).toHaveLength(3);
    for (const key of NRGP_SECTION) {
      expect(BOARD_KPIS[key].scope).not.toBe('returned');
      expect(BOARD_KPIS[key].key).not.toMatch(/outside|overdue|returned/i);
    }
  });

  it('carries NO summary row — the five roll-up keys are deleted', () => {
    // Client, 2026-08-18: off the HOD board, then off the admin board too. The
    // keys are gone from BOARD_KPIS rather than merely unlisted, so a stale
    // reference is a type error and no orphan tile can survive.
    for (const dead of ['totalRaised', 'totalCleared', 'pendingApprovals', 'overdueReturns', 'materialOutside']) {
      expect(Object.keys(BOARD_KPIS)).not.toContain(dead);
    }
  });

  it('no headline card takes the brand gold tone', () => {
    // Gold is this system's primary FILL (sidebar active link, primary button,
    // wordmark) and reads at ~2:1 as ink on a card — the same defect the
    // notification panel had.
    for (const key of [...RGP_SECTION, ...NRGP_SECTION]) {
      expect(BOARD_KPIS[key].tone).not.toBe('brand');
    }
  });

  it('every key in the record belongs to exactly one section', () => {
    const all = [...RGP_SECTION, ...NRGP_SECTION];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(Object.keys(BOARD_KPIS) as BoardKpiKey[]));
  });
});

describe('a card\'s scope matches the words on it', () => {
  it('an "Out"/"Returned"/"Cleared" card is period-scoped; a "Currently"/"Due"/"Overdue" one is not', () => {
    expect(BOARD_KPIS.rgpRaised.scope).toBe('period');
    expect(BOARD_KPIS.rgpCleared.scope).toBe('period');
    expect(BOARD_KPIS.nrgpRaised.scope).toBe('period');
    expect(BOARD_KPIS.nrgpCleared.scope).toBe('period');

    // A return is a MOVEMENT, dated by when the material came back — not by
    // when the pass was raised. Scoping it on `created_at` would drop today's
    // return of a pass raised last month, which is most of them.
    expect(BOARD_KPIS.rgpReturned.scope).toBe('returned');

    for (const key of ['rgpAwaiting', 'rgpOutside', 'rgpDueToday', 'rgpOverdue',
      'nrgpAwaiting'] as BoardKpiKey[]) {
      expect(BOARD_KPIS[key].scope).toBe('current');
    }
  });

  it('NO card label carries the word "Today" — the header chip does', () => {
    // Client, 2026-08-18. `kpiLabel` used to append it to every day-scoped tile,
    // which put the word on the screen fourteen times. It is gone from the
    // labels AND from the plumbing, so a tile cannot grow it back by accident.
    // One card is exempt, and it is not a window: "RGP Due Today" is about a
    // RETURN DATE falling today, which is why its scope is `current`.
    for (const key of Object.keys(BOARD_KPIS) as BoardKpiKey[]) {
      if (key === 'rgpDueToday') continue;
      expect(BOARD_KPIS[key].label).not.toMatch(/today/i);
    }
    expect(BOARD_KPIS.rgpDueToday.scope).toBe('current');
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
    expect(rowsFor(BOARD_KPIS.rgpRaised, windows).map((p) => p.id)).toEqual(['a']);
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
    expect(rowsFor(BOARD_KPIS.rgpRaised, w).map((p) => p.id)).toEqual(['r']);
  });

  it('a drill carries the rows the card counted, under the card\'s own key', () => {
    const rows = rowsFor(BOARD_KPIS.rgpOverdue, windows);
    const drill = kpiDrill('rgpOverdue', rows);
    expect(drill.key).toBe('kpi-rgpOverdue');
    expect(drill.rows).toBe(rows);
    expect(drill.heading).toBe(BOARD_KPIS.rgpOverdue.heading);
  });
});
