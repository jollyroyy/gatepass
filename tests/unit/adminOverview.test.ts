// THE ADMIN OVERVIEW's derivations — the data half of the client's mock-up
// (2026-08-19, twelfth pass). `src/lib/adminOverview.ts`.
//
// SIX THINGS THIS FILE EXISTS TO PIN, in order of how quietly each could break:
//
//   1. THE BOARD INVARIANT. Every figure on this page is a filter of ONE
//      windowed array, so the trend's two series must sum to the RGP and NRGP
//      cards and the ring's arcs must sum to the Total card. A count and its own
//      list drifting apart is this app's oldest dashboard bug and the reason no
//      board here is allowed an aggregate query.
//   2. THE WINDOW IS LOCAL CALENDAR DAYS, ending with today. A UTC cut would put
//      a pass raised at 09:00 IST in the previous day on a board that says
//      "Last 7 Days".
//   3. TWO FIGURES ARE OUTSIDE THE WINDOW ON PURPOSE — Pending Approvals and
//      Overdue Returns are RUNNING queues. A window-scoped Overdue figure would
//      print 0 while material sat off site.
//   4. NO FIGURE COMPARES ITSELF TO ANYTHING. The client removed the mock's
//      "vs last week" line outright (2026-08-19), so `deltaOf`, the `Delta` type
//      and `WindowBounds.prevStart` are gone and every card's second line is its
//      scope in words. The cases below that used to pin the arithmetic now pin
//      the absence — a delta creeping back in is what they fail on.
//   5. EVERY PASS FALLS IN EXACTLY ONE STATUS BUCKET, by an ordered chain of
//      exact equalities. The order is urgency: a stopped pass is never
//      "approved", and a late one is never merely "returned".
//   6. THE RING LISTS ALL FIVE BUCKETS EVEN AT ZERO. A legend whose rows come
//      and go means something different from one week to the next.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  OVERVIEW_STATUS_ORDER,
  OVERVIEW_WINDOWS,
  buildOverviewCards,
  overviewStatusOf,
  rangeLabel,
  statusSlices,
  trendDays,
  windowBounds,
} from '../../src/lib/adminOverview';

const DAY = 24 * 60 * 60 * 1000;

/** Noon on the day `back` days before `NOW`, in LOCAL time — the middle of the
 *  day, so a test can never be reading a timezone edge by accident. */
function daysAgo(back: number, base: number): string {
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12, 0).toISOString();
}

// A fixed instant, so the window arithmetic is reproducible: 19 Aug 2026, 15:30
// local. Every fixture below is dated relative to it.
const NOW = new Date(2026, 7, 19, 15, 30).getTime();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'hod-1', raised_by_name: 'P M Sharma',
    visitor_name: 'Alice', visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: daysAgo(0, NOW),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Bolts', flagged_at: null, hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const cardOf = (rows: GatePassView[], key: string, days = 7) =>
  buildOverviewCards(rows, days, NOW).find((c) => c.key === key)!;

describe('the window', () => {
  it('is `days` local calendar days ending with today', () => {
    const b = windowBounds(7, NOW);
    // Start is local midnight six days back; end is local midnight AFTER today,
    // so a pass raised at 23:59 tonight is inside the window.
    expect(new Date(b.start).getDate()).toBe(13);
    expect(new Date(b.start).getHours()).toBe(0);
    expect(new Date(b.end).getDate()).toBe(20);
    expect(b.end - b.start).toBe(7 * DAY);
    // The comparison window is the seven days immediately before it — adjacent,
    // never overlapping, or every delta would count some days twice.
    // No `prevStart`: nothing on this board looks further back than the window
    // it names, now that the comparison line is gone.
    expect(Object.keys(b).sort()).toEqual(['end', 'start']);
  });

  it('prints the mock\'s header chip, with the year on the closing date only', () => {
    expect(rangeLabel(windowBounds(7, NOW))).toBe('13 Aug – 19 Aug 2026');
  });

  it('offers the three windows the header and the trend card share', () => {
    expect(OVERVIEW_WINDOWS.map((w) => w.value)).toEqual(['7', '30', '90']);
  });
});

describe('the five figures', () => {
  // Inside the 7-day window: three RGP and one NRGP. Outside it: one RGP raised
  // 10 days ago, which must move no windowed figure.
  const ROWS = [
    pass({ id: 'a', created_at: daysAgo(0, NOW) }),
    pass({ id: 'b', created_at: daysAgo(3, NOW) }),
    pass({ id: 'c', created_at: daysAgo(6, NOW) }),
    pass({ id: 'd', created_at: daysAgo(1, NOW), type: 'NRGP', pass_number: 'NRGP-20260818-0001' }),
    pass({ id: 'old', created_at: daysAgo(10, NOW) }),
  ];

  it('is the mock\'s five cards, in its own order', () => {
    expect(buildOverviewCards(ROWS, 7, NOW).map((c) => c.key))
      .toEqual(['total', 'rgp', 'nrgp', 'pending', 'overdue']);
  });

  it('labels the third card NRGP — the mock says "Energy Pay Pass", which this app has no such thing as', () => {
    const labels = buildOverviewCards(ROWS, 7, NOW).map((c) => c.label);
    expect(labels).toEqual(['Total Gate Passes', 'RGP', 'NRGP', 'Pending Approvals', 'Overdue Returns']);
    expect(labels.join(' ')).not.toMatch(/Energy/i);
  });

  it('counts raises inside the window only, and RGP + NRGP sum to Total', () => {
    expect(cardOf(ROWS, 'total').value).toBe(4);
    expect(cardOf(ROWS, 'rgp').value).toBe(3);
    expect(cardOf(ROWS, 'nrgp').value).toBe(1);
    expect(cardOf(ROWS, 'rgp').value + cardOf(ROWS, 'nrgp').value).toBe(cardOf(ROWS, 'total').value);
  });

  it('carries the very rows it counted, so a figure and its list cannot disagree', () => {
    for (const card of buildOverviewCards(ROWS, 7, NOW)) {
      expect(card.drill.rows).toHaveLength(card.value);
    }
    expect(cardOf(ROWS, 'nrgp').drill.rows.map((r) => r.id)).toEqual(['d']);
  });

  it('widening the window takes the older pass in', () => {
    expect(cardOf(ROWS, 'total', 30).value).toBe(5);
  });

  it('compares itself to NOTHING — no card carries a delta, whatever the previous window held', () => {
    const rows = [
      // Two raised inside the last 7 days, against four in the seven before it:
      // the halving the old board printed as "50% ↓". Nothing prints it now.
      pass({ id: 'n1', created_at: daysAgo(1, NOW) }),
      pass({ id: 'n2', created_at: daysAgo(2, NOW) }),
      pass({ id: 'p1', created_at: daysAgo(8, NOW) }),
      pass({ id: 'p2', created_at: daysAgo(9, NOW) }),
      pass({ id: 'p3', created_at: daysAgo(10, NOW) }),
      pass({ id: 'p4', created_at: daysAgo(13, NOW) }),
    ];
    for (const card of buildOverviewCards(rows, 7, NOW)) {
      expect(card).not.toHaveProperty('delta');
      expect(card.note).not.toMatch(/vs |previous|%/);
    }
  });

  it('states each windowed figure scope in words instead', () => {
    expect(cardOf([pass({ id: 'n1', created_at: daysAgo(1, NOW) })], 'total').note)
      .toBe('Raised in the last 7 days');
  });

  describe('the two RUNNING queues', () => {
    // Both are old enough to be outside every window used here.
    const WAITING = pass({ id: 'w', created_at: daysAgo(40, NOW), status: 'pending' });
    const LATE = pass({
      id: 'l', created_at: daysAgo(40, NOW), status: 'matched',
      return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    });

    it('counts a pass older than the window — an obligation does not close because the window rolled', () => {
      expect(cardOf([WAITING, LATE], 'pending').value).toBe(1);
      expect(cardOf([WAITING, LATE], 'overdue').value).toBe(1);
      // …and neither is in a windowed figure.
      expect(cardOf([WAITING, LATE], 'total').value).toBe(0);
    });

    it('excludes an EXPIRED pass from Pending Approvals — nothing can clear it', () => {
      const dead = pass({ id: 'e', created_at: daysAgo(40, NOW), status: 'pending', is_expired: true });
      expect(cardOf([dead], 'pending').value).toBe(0);
    });

    it('says what it is, and never how it compares', () => {
      expect(cardOf([WAITING, LATE], 'pending').note).toBe('Waiting at the gate now');
      expect(cardOf([WAITING, LATE], 'overdue').note).toBe('Still out, past its date');
    });
  });
});

describe('the trend', () => {
  const ROWS = [
    pass({ id: 'a', created_at: daysAgo(0, NOW) }),
    pass({ id: 'b', created_at: daysAgo(0, NOW) }),
    pass({ id: 'c', created_at: daysAgo(2, NOW), type: 'NRGP' }),
    pass({ id: 'old', created_at: daysAgo(30, NOW) }),
  ];

  it('is one bucket per local day, oldest first, the last being today', () => {
    const days = trendDays(ROWS, 7, NOW);
    expect(days).toHaveLength(7);
    expect(days.map((d) => new Date(d.start).getDate())).toEqual([13, 14, 15, 16, 17, 18, 19]);
    expect(days[6].label).toBe('19 Aug');
  });

  it('buckets on `created_at`, so its two series sum to the RGP and NRGP cards', () => {
    const days = trendDays(ROWS, 7, NOW);
    const rgp = days.reduce((n, d) => n + d.rgp, 0);
    const nrgp = days.reduce((n, d) => n + d.nrgp, 0);
    expect(rgp).toBe(cardOf(ROWS, 'rgp').value);
    expect(nrgp).toBe(cardOf(ROWS, 'nrgp').value);
    expect(days[6].rgp).toBe(2);
    expect(days[4].nrgp).toBe(1);
  });

  it('carries each day\'s own rows, and drops what the window excludes', () => {
    const days = trendDays(ROWS, 7, NOW);
    expect(days[6].rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(days.flatMap((d) => d.rows.map((r) => r.id))).not.toContain('old');
  });

  it('leaves a quiet day at zero rather than skipping it', () => {
    const days = trendDays(ROWS, 7, NOW);
    expect(days[0]).toMatchObject({ rgp: 0, nrgp: 0, rows: [] });
  });
});

describe('passes by status', () => {
  it('files each pass in exactly one bucket, urgency first', () => {
    // Rejected outranks everything: a stopped pass is not "approved".
    expect(overviewStatusOf(pass({ status: 'flagged' }))).toBe('rejected');
    expect(overviewStatusOf(pass({ status: 'cancelled' }))).toBe('rejected');
    // Still owes a gate decision.
    expect(overviewStatusOf(pass({ status: 'pending' }))).toBe('pending');
    expect(overviewStatusOf(pass({ status: 'held' }))).toBe('pending');
    expect(overviewStatusOf(pass({ status: 'hod_reviewed' }))).toBe('pending');
    // Out, late — read straight off the view, never recomputed here.
    expect(overviewStatusOf(pass({
      status: 'matched', return_status: 'awaiting_return', is_overdue: true,
    }))).toBe('overdue');
    // Back, and on time.
    expect(overviewStatusOf(pass({ status: 'matched', return_status: 'returned' }))).toBe('returned');
    // The remainder: through the gate with nothing above applying.
    expect(overviewStatusOf(pass({ status: 'matched' }))).toBe('approved');
    expect(overviewStatusOf(pass({
      status: 'matched', return_status: 'awaiting_return', is_overdue: false,
    }))).toBe('approved');
  });

  it('grades a LATE pass overdue even though every line is still owed — not "returned"', () => {
    const late = pass({ status: 'matched', return_status: 'partially_returned', is_overdue: true });
    expect(overviewStatusOf(late)).toBe('overdue');
  });

  it('files an EXPIRED pass under Pending — a known imprecision the drill list corrects', () => {
    // The mock has five buckets and none of them is Expired. The stacked list
    // this arc opens badges such a pass "Expired", so the count and its own list
    // correct each other, and Reports still tracks expiry by name.
    expect(overviewStatusOf(pass({ status: 'pending', is_expired: true }))).toBe('pending');
  });

  it('lists all five buckets even at zero, in the mock\'s legend order', () => {
    const slices = statusSlices([pass({ id: 'a', created_at: daysAgo(1, NOW) })], 7, NOW);
    expect(slices.map((s) => s.key)).toEqual([...OVERVIEW_STATUS_ORDER]);
    expect(slices.map((s) => s.label))
      .toEqual(['Approved', 'Pending', 'Rejected', 'Returned', 'Overdue']);
    expect(slices.filter((s) => s.value === 0)).toHaveLength(4);
  });

  it('sums to the Total Gate Passes card, over the same window', () => {
    const rows = [
      pass({ id: 'a', created_at: daysAgo(1, NOW), status: 'matched' }),
      pass({ id: 'b', created_at: daysAgo(2, NOW), status: 'pending' }),
      pass({ id: 'c', created_at: daysAgo(3, NOW), status: 'flagged' }),
      pass({ id: 'd', created_at: daysAgo(4, NOW), status: 'matched', return_status: 'returned' }),
      // Outside the window — in neither the ring nor the card.
      pass({ id: 'old', created_at: daysAgo(20, NOW), status: 'matched' }),
    ];
    const slices = statusSlices(rows, 7, NOW);
    expect(slices.reduce((n, s) => n + s.value, 0)).toBe(cardOf(rows, 'total').value);
    expect(slices.reduce((n, s) => n + s.rows.length, 0)).toBe(4);
  });
});
