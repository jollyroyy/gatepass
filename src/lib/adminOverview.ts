// THE ADMIN OVERVIEW — the data half of the client's Overview mock-up
// (2026-08-19, twelfth pass): five figures over a rolling window, a two-series
// gate pass trend, and a five-bucket status ring.
//
// IT REPLACES `GateBoard` WHOLESALE. The admin used to get two KPI rows, a
// movement trend, a status ring, a Return Watch table, a Top Items ring and a
// department column chart; the client replaced the page with the layout above
// ("remove whatever is there in the admin dashboard currently and replace those
// with the attached one"). `src/components/board/*`, `boardKpis.ts`,
// `boardWindows.ts`, `boardAnalytics.ts`, `returnWatch.ts` and the three house
// chart components are DELETED, not flagged off, so a stale reference is a
// build error rather than a second admin board nobody notices.
//
// ONE ARRAY BEHIND THE WHOLE PAGE. The windowed rows are computed once and every
// figure, line and arc on the board is a filter of them — so the trend's two
// series sum to the RGP and NRGP cards, and the ring's centre total is the
// Total Gate Passes card, by construction rather than by coincidence. That is
// the board invariant this app has always had ("a KPI's number is `rows.length`
// of the very list its click opens"), and it survives the rewrite: every card
// and every arc carries its own rows on a `BoardDrill`.
//
// TWO FIGURES ARE DELIBERATELY OUTSIDE THAT WINDOW, and they are the two the
// mock draws in red: Pending Approvals and Overdue Returns are RUNNING queues.
// An obligation does not stop being open because the window rolled past the day
// it started in, so a window-scoped Overdue figure would print 0 while material
// sat off site.
//
// NO FIGURE COMPARES ITSELF TO A PREVIOUS WINDOW (client, 2026-08-19: "remove
// all those comparisons"). The mock's red/green "18.6% vs last week" line, the
// `Delta` type and `deltaOf` are DELETED, not flagged off — so is `prevStart`,
// the only reason `windowBounds` ever looked further back than the window it
// describes. Each card carries its scope in words instead.
import type { GatePassView } from '../types';
import type { BoardDrill } from './boardDrills';
import { IS_OPEN_RETURN } from './boardDrills';
import { pendingSplit, pendingSplitNotes } from './pendingSplit';
import { DAY_MS, dayStart } from './localDay';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

// ─── The window ──────────────────────────────────────────────────────────────

export type OverviewWindow = '7' | '30' | '90';

/** The header chip and the trend card's chip are the SAME control bound to the
 *  same state, which is why they can never disagree about what the board is
 *  showing. The mock draws both. */
export const OVERVIEW_WINDOWS: readonly { value: OverviewWindow; label: string }[] = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
];

export interface WindowBounds {
  /** Local midnight of the first day in the window. */
  start: number;
  /** Exclusive — local midnight AFTER today. */
  end: number;
}

/** `days` calendar days ending with today, in LOCAL time. Local, not UTC: a pass
 *  raised at 09:00 IST belongs to that morning on every screen in this app. */
export function windowBounds(days: number, now: number = Date.now()): WindowBounds {
  const today = dayStart(now);
  const start = today - (days - 1) * DAY_MS;
  return { start, end: today + DAY_MS };
}

const SPAN_DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const SPAN_YEAR = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** "13 Aug – 19 Aug 2026" — the mock's header chip. The year is printed once, on
 *  the closing date, because a window never spans more than one of them here. */
export function rangeLabel(b: WindowBounds): string {
  return `${SPAN_DAY.format(new Date(b.start))} – ${SPAN_YEAR.format(new Date(b.end - DAY_MS))}`;
}

function raisedBetween(rows: GatePassView[], from: number, to: number): GatePassView[] {
  return rows.filter((p) => {
    if (!p.created_at) return false;
    const t = new Date(p.created_at).getTime();
    return t >= from && t < to;
  });
}

// ─── The five figures ────────────────────────────────────────────────────────

export type OverviewKey = 'total' | 'rgp' | 'nrgp' | 'pending' | 'overdue';

/** One line under a figure — the mock has no such thing, and exactly one card
 *  carries them: Pending Approvals, which the client asked to be broken into
 *  the two desks a waiting pass can actually be sitting on (2026-08-20).
 *
 *  THEY ARE READINGS, NOT CONTROLS. The whole card is already the drill button
 *  and a button inside a button is not valid HTML, so a sub-figure states
 *  itself and the card's own list is what opens. */
export interface OverviewNote {
  key: string;
  text: string;
  tone: HodTone;
}

export interface OverviewCard {
  key: OverviewKey;
  label: string;
  glyph: HodGlyph;
  tone: HodTone;
  value: number;
  /** What the figure is scoped to, in words. It is the whole of the card's
   *  second line now that no figure compares itself to anything. */
  note: string;
  /** Empty on four of the five cards. See `OverviewNote`. */
  notes: OverviewNote[];
  drill: BoardDrill;
}

/**
 * The mock's five cards, in its own order, each carrying the rows it counted.
 *
 * THE THIRD CARD IS NRGP. The mock-up's own label is "Energy Pay Pass"; the
 * client corrected that phrase on sight the first time it appeared (on the raise
 * form's second pass type, same mock family) — it is NRGP, and this app has no
 * such thing as an energy pay pass.
 */
export function buildOverviewCards(
  rows: GatePassView[],
  days: number,
  now: number = Date.now(),
): OverviewCard[] {
  const b = windowBounds(days, now);
  const win = raisedBetween(rows, b.start, b.end);
  const rgp = win.filter((p) => p.type === 'RGP');
  const nrgp = win.filter((p) => p.type === 'NRGP');
  // RUNNING, and unscoped by the window on purpose — see the file header.
  // `split.waiting` IS the old `rows.filter(isWaitingAtGate)`; the two
  // sub-figures under the card are that same array cut in half by
  // `awaits_approval`, so they sum to the figure by construction.
  const split = pendingSplit(rows);
  const pending = split.waiting;
  const overdue = rows.filter((p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue);
  const since = `Raised in the last ${days} days`;

  return [
    {
      key: 'total',
      label: 'Total Gate Passes',
      glyph: 'document',
      tone: 'blue',
      value: win.length,
      note: since,
      notes: [],
      drill: {
        key: 'total',
        heading: 'Passes raised in this window',
        empty: 'No pass was raised in this window.',
        rows: win,
      },
    },
    {
      key: 'rgp',
      label: 'RGP',
      glyph: 'exchange',
      tone: 'green',
      value: rgp.length,
      note: since,
      notes: [],
      drill: {
        key: 'rgp',
        heading: 'RGP raised in this window',
        empty: 'No RGP was raised in this window.',
        rows: rgp,
      },
    },
    {
      key: 'nrgp',
      label: 'NRGP',
      glyph: 'send',
      tone: 'purple',
      value: nrgp.length,
      note: since,
      notes: [],
      drill: {
        key: 'nrgp',
        heading: 'NRGP raised in this window',
        empty: 'No NRGP was raised in this window.',
        rows: nrgp,
      },
    },
    {
      key: 'pending',
      label: 'Pending Approvals',
      glyph: 'clock',
      tone: 'orange',
      value: pending.length,
      note: 'Not through the gate yet',
      notes: pendingSplitNotes(split).map((n) => ({
        ...n,
        tone: n.key === 'gate' ? ('orange' as HodTone) : ('purple' as HodTone),
      })),
      drill: {
        key: 'pending',
        heading: 'Passes not through the gate yet',
        empty: 'Nothing is waiting.',
        rows: pending,
      },
    },
    {
      key: 'overdue',
      label: 'Overdue Returns',
      glyph: 'alert',
      tone: 'red',
      value: overdue.length,
      note: 'Still out, past its date',
      notes: [],
      drill: {
        key: 'overdue',
        heading: 'Material past its return date',
        empty: 'Nothing is overdue.',
        rows: overdue,
      },
    },
  ];
}

// ─── The trend ───────────────────────────────────────────────────────────────

export interface TrendDay {
  /** Local midnight, as epoch ms — a stable React key. */
  start: number;
  label: string;
  rgp: number;
  nrgp: number;
  /** The passes raised that day — what the day's click opens. */
  rows: GatePassView[];
}

const AXIS_LABEL = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/**
 * One bucket per local calendar day, oldest first, the last being today.
 *
 * IT PLOTS PASSES RAISED, NOT GATE EVENTS, and that is a change from the trend
 * this board used to carry. The card is titled "Gate Pass Trend" and sits under
 * a row of raise counts, so bucketing on `created_at` is what makes the two
 * lines sum to the RGP and NRGP cards above them. A trend drawn on `verified_at`
 * would be a chart that visibly disagrees with the figures it sits beneath.
 */
export function trendDays(rows: GatePassView[], days: number, now: number = Date.now()): TrendDay[] {
  const b = windowBounds(days, now);
  const buckets: TrendDay[] = [];
  const index = new Map<number, TrendDay>();
  for (let i = 0; i < days; i += 1) {
    const start = b.start + i * DAY_MS;
    const bucket: TrendDay = { start, label: AXIS_LABEL.format(new Date(start)), rgp: 0, nrgp: 0, rows: [] };
    buckets.push(bucket);
    index.set(start, bucket);
  }

  for (const p of raisedBetween(rows, b.start, b.end)) {
    const bucket = index.get(dayStart(new Date(p.created_at as string).getTime()));
    if (!bucket) continue;
    if (p.type === 'RGP') bucket.rgp += 1;
    else bucket.nrgp += 1;
    bucket.rows.push(p);
  }
  return buckets;
}

// ─── Passes by status ────────────────────────────────────────────────────────

/** A labelled aggregate plus the exact passes behind it. Carrying the rows
 *  rather than a predicate is the whole point — a predicate would have to be
 *  re-applied against some array, and "some array" is where a count and its list
 *  drift apart. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  rows: GatePassView[];
}

export type OverviewStatus = 'approved' | 'pending' | 'rejected' | 'returned' | 'overdue';

/** Legend order, top to bottom, exactly as the mock draws it. */
export const OVERVIEW_STATUS_ORDER: readonly OverviewStatus[] = [
  'approved', 'pending', 'rejected', 'returned', 'overdue',
];

export const OVERVIEW_STATUS_LABELS: Record<OverviewStatus, string> = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  returned: 'Returned',
  overdue: 'Overdue',
};

/**
 * Which of the mock's five buckets a pass falls in. EXACTLY ONE, always — the
 * arms are tried in order and the last is a remainder, so the ring's arcs sum to
 * the row count and its centre total is the Total Gate Passes card.
 *
 * The order is the mock's own reading of urgency, and it matters:
 *
 *   1. Rejected  — `flagged` (security found a mismatch) or `cancelled` (the
 *                  HOD rejected a flagged pass, or voided an expired one).
 *                  Outranks everything: a stopped pass is not "approved".
 *   2. Pending   — still owes a gate decision: `pending`, `held`,
 *                  `hod_reviewed`. KNOWN IMPRECISION, flagged: an EXPIRED pass
 *                  is still `status = 'pending'` and lands here, though nothing
 *                  can clear it. The mock has five buckets and none of them is
 *                  Expired; the drill list this arc opens badges each such pass
 *                  "Expired", so the count and its own list correct each other.
 *                  Expiry is still tracked by name in Reports.
 *   3. Overdue   — cleared out, still out, past its date. `is_overdue` comes
 *                  straight off `gatepass.v_gate_passes` and is NEVER
 *                  recomputed here.
 *   4. Returned  — every line came back.
 *   5. Approved  — the remainder: cleared the gate and nothing above applies —
 *                  an NRGP that is finished, or an RGP out and on time.
 *
 * A `Record`-free chain of exact equalities, never `includes()` on the enum:
 * adding a label to `gatepass.pass_status` leaves it falling through to
 * `approved`, which is why `passStage.ts`'s exhaustive maps stay the place a new
 * status must be declared.
 */
export function overviewStatusOf(p: GatePassView): OverviewStatus {
  if (p.status === 'flagged' || p.status === 'cancelled') return 'rejected';
  if (p.status === 'pending' || p.status === 'held' || p.status === 'hod_reviewed') return 'pending';
  if (IS_OPEN_RETURN[p.return_status] && p.is_overdue) return 'overdue';
  if (p.return_status === 'returned') return 'returned';
  return 'approved';
}

/** The ring, over the SAME windowed rows the five cards count. Every bucket is
 *  listed even at zero: five fixed states, and one that vanished on a quiet week
 *  would make the legend mean something different from one week to the next. */
export function statusSlices(rows: GatePassView[], days: number, now: number = Date.now()): Slice[] {
  const b = windowBounds(days, now);
  const win = raisedBetween(rows, b.start, b.end);
  return OVERVIEW_STATUS_ORDER.map((key) => {
    const own = win.filter((p) => overviewStatusOf(p) === key);
    return { key, label: OVERVIEW_STATUS_LABELS[key], value: own.length, rows: own };
  });
}
