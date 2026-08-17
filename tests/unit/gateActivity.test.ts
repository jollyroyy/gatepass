// "Today's Gate Activity" — the events the gate actually recorded today, and
// the ring that draws them.
//
// A MOVEMENT IS A GATE EVENT, NOT A RAISED PASS. `created_at` says when an HOD
// typed the paperwork; `verified_at` says when the material crossed the barrier
// and `actual_return_date` says when it came back. A "Daily Movement Trend"
// plotted on `created_at` would show traffic on a day nothing moved, which is
// the one thing a gate board must not do.
//
// The daily-movement-trend cases went with the trend chart when the board was
// cut back to today only (2026-08-17); the slice cases below took their place.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { gateActivityEvents, gateActivitySlices, ACTIVITY_LABEL } from '../../src/lib/gateActivity';

const NOW = new Date(2026, 7, 17, 14, 0, 0).getTime(); // 17 Aug 2026, 14:00 local

/** A local timestamp `daysAgo` days back at `hour`:`minute`. */
function at(daysAgo: number, hour: number, minute = 0): string {
  return new Date(2026, 7, 17 - daysAgo, hour, minute, 0).toISOString();
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260817-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable', is_overdue: false, is_expired: false,
    due_state: 'not_applicable', expected_return_date: null, actual_return_date: null,
    material_summary: 'Motor 10 HP', verified_at: null, created_at: at(0, 9),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

describe('today\'s gate activity', () => {
  it('records a clearance as OUT for an RGP and CLEARED for an NRGP', () => {
    const events = gateActivityEvents([
      pass({ id: 'a', verified_at: at(0, 10, 42) }),
      pass({ id: 'b', type: 'NRGP', verified_at: at(0, 9, 30), pass_number: 'NRGP-OUT-20260817-0004' }),
    ], NOW);

    expect(events.map((e) => [e.kind, e.title])).toEqual([
      ['out', 'RGP Out'],
      ['cleared', 'NRGP Cleared'],
    ]);
  });

  it('records a return as RETURNED, and a pass can produce both events', () => {
    // One RGP cleared out this morning and brought back this afternoon is two
    // movements at the gate, not one — the guard stood there twice.
    const events = gateActivityEvents([
      pass({ id: 'a', verified_at: at(0, 9), return_status: 'returned', actual_return_date: at(0, 15) }),
    ], NOW);
    expect(events.map((e) => e.kind)).toEqual(['returned', 'out']);
  });

  it('is today only, newest first', () => {
    const events = gateActivityEvents([
      pass({ id: 'old', verified_at: at(3, 11) }),
      pass({ id: 'early', verified_at: at(0, 8, 5) }),
      pass({ id: 'late', verified_at: at(0, 13, 20) }),
    ], NOW);
    expect(events.map((e) => e.passId)).toEqual(['late', 'early']);
  });

  it('ignores a pass the gate never acted on, and a flagged one', () => {
    // A flag is not a movement: the material did not go anywhere. It belongs on
    // the HOD's review queue, not in a log of what crossed the barrier.
    const events = gateActivityEvents([
      pass({ id: 'p', status: 'pending', verified_at: null }),
      pass({ id: 'f', status: 'flagged', verified_at: at(0, 12) }),
    ], NOW);
    expect(events).toEqual([]);
  });

  it('carries the pass id and number so a row can open the pass', () => {
    const [event] = gateActivityEvents([pass({ id: 'a', verified_at: at(0, 10) })], NOW);
    expect(event.passId).toBe('a');
    expect(event.passNumber).toBe('RGP-OUT-20260817-0001');
    expect(event.detail).toContain('Motor 10 HP');
  });
});

describe("today's gate activity, as the ring draws it", () => {
  it('offers all four kinds in a fixed order, even the empty ones', () => {
    // Fixed, not sorted by size: a ring whose colours move between renders
    // cannot be read at a glance, which is the only way a wall board is read.
    // And a listed zero is a fact — "nothing came back today" is worth saying.
    const slices = gateActivitySlices([pass({ id: 'a', verified_at: at(0, 10) })], NOW);
    expect(slices.map((s) => s.key)).toEqual(['out', 'in', 'returned', 'cleared']);
    expect(slices.map((s) => s.label)).toEqual(Object.values(ACTIVITY_LABEL));
    expect(slices.map((s) => s.value)).toEqual([1, 0, 0, 0]);
  });

  it('CARRIES the passes it counted, so the legend and its drill are one array', () => {
    const slices = gateActivitySlices(
      [
        pass({ id: 'a', verified_at: at(0, 10) }),
        pass({ id: 'b', type: 'NRGP', verified_at: at(0, 11) }),
      ],
      NOW,
    );
    for (const slice of slices) expect(slice.rows).toHaveLength(slice.value);
    expect(slices.find((s) => s.key === 'out')!.rows.map((p) => p.id)).toEqual(['a']);
    expect(slices.find((s) => s.key === 'cleared')!.rows.map((p) => p.id)).toEqual(['b']);
  });

  it('counts a pass that moved twice today in BOTH of its slices', () => {
    // Two visits to the barrier. Collapsing them would hide the return, which is
    // half of what a returnable board exists to show.
    const slices = gateActivitySlices(
      [pass({ id: 'a', verified_at: at(0, 9), return_status: 'returned', actual_return_date: at(0, 15) })],
      NOW,
    );
    expect(slices.find((s) => s.key === 'out')!.value).toBe(1);
    expect(slices.find((s) => s.key === 'returned')!.value).toBe(1);
  });

  it('counts nothing on a day the gate did not act', () => {
    const slices = gateActivitySlices(
      [pass({ id: 'old', verified_at: at(3, 11) }), pass({ id: 'f', status: 'flagged', verified_at: at(0, 12) })],
      NOW,
    );
    expect(slices.every((s) => s.value === 0)).toBe(true);
  });
});
