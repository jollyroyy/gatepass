// "Today's Gate Activity" — the events the gate actually recorded today, and
// the daily movement series the trend line plots.
//
// A MOVEMENT IS A GATE EVENT, NOT A RAISED PASS. `created_at` says when an HOD
// typed the paperwork; `verified_at` says when the material crossed the barrier
// and `actual_return_date` says when it came back. A "Daily Movement Trend"
// plotted on `created_at` would show traffic on a day nothing moved, which is
// the one thing a gate board must not do.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { gateActivityEvents } from '../../src/lib/gateActivity';
import { movementBuckets, MOVEMENT_SERIES } from '../../src/lib/boardAnalytics';

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

describe('the daily movement trend', () => {
  it('plots the three reference series', () => {
    expect(MOVEMENT_SERIES.map((s) => s.label)).toEqual(['RGP Out', 'RGP Return', 'NRGP Out']);
  });

  it('buckets by LOCAL day, oldest first, ending today', () => {
    const buckets = movementBuckets([], 7, NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[6].start).toBe(new Date(2026, 7, 17).getTime());
    expect(buckets[0].start).toBe(new Date(2026, 7, 11).getTime());
  });

  it('counts a clearance under its own series and a return under the return series', () => {
    const buckets = movementBuckets([
      pass({ id: 'a', verified_at: at(1, 10) }),
      pass({ id: 'b', type: 'NRGP', verified_at: at(1, 11) }),
      pass({ id: 'c', verified_at: at(4, 9), return_status: 'returned', actual_return_date: at(1, 16) }),
    ], 7, NOW);

    const yesterday = buckets[5];
    expect(yesterday.counts).toEqual({ rgpOut: 1, rgpReturn: 1, nrgpOut: 1 });
    expect(yesterday.total).toBe(3);
    // Three movements, three passes — the row list is what the day's click opens.
    expect(yesterday.rows.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('lists a pass once in a day even when it moved twice that day', () => {
    const buckets = movementBuckets([
      pass({ id: 'a', verified_at: at(0, 9), return_status: 'returned', actual_return_date: at(0, 17) }),
    ], 7, NOW);
    const today = buckets[6];
    expect(today.counts.rgpOut).toBe(1);
    expect(today.counts.rgpReturn).toBe(1);
    expect(today.total).toBe(2);
    expect(today.rows.map((p) => p.id)).toEqual(['a']);
  });

  it('ignores movements outside the window', () => {
    const buckets = movementBuckets([pass({ id: 'old', verified_at: at(30, 10) })], 7, NOW);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});
