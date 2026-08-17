// Every aggregate the admin dashboard draws — donut slices, trend buckets,
// ranked bar lists, sparklines and period deltas.
//
// ONE RULE GOVERNS THIS WHOLE FILE: an aggregate carries the rows it counted.
// Not the count and a predicate that a caller re-applies somewhere else — the
// actual array. That is the same invariant the KPI cards have always had in
// this app ("a KPI's number is `rows.length` of the very list the click opens"),
// extended to chart segments, because a donut slice reading 28 that drills into
// 31 passes is a board nobody can trust and nobody can debug.
//
// Nothing here queries. `AdminDashboard` fetches once and filters once; these
// functions only ever see an array that is already in scope.
import type { GatePassView, GatePassItemView } from '../types';
import { categoryKey, PASS_CATEGORIES, PASS_CATEGORY_LIST } from './passTypes';
import { isExpiredPending } from './statusStyles';

/** A labelled aggregate plus the exact passes behind it. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  rows: GatePassView[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Gate Pass Overview — the category donut ─────────────────────────────────
/** The three legal (type, direction) combinations, straight off
 *  `PASS_CATEGORY_LIST` — the gate console's filter reads the same list, so the
 *  donut and the filter can never offer different categories.
 *
 *  Deliberately keeps categories whose count is zero. A legend that silently
 *  drops "RGP In" on a day nobody raised one reads as "this system has no such
 *  category", which is a stronger and wronger claim than "none today". The
 *  donut itself omits the zero segment (`ringSegments` does that); the legend
 *  still lists it. */
export function categorySlices(rows: GatePassView[]): Slice[] {
  return PASS_CATEGORY_LIST.map((key) => {
    const matched = rows.filter((p) => categoryKey(p.type, p.direction) === key);
    return { key, label: PASS_CATEGORIES[key].label, value: matched.length, rows: matched };
  });
}

// ─── Gate Pass Overview, status mode ─────────────────────────────────────────
// The same donut read the other way: where the passes GOT TO, rather than what
// they were.
//
// EXPIRED IS SPLIT OUT OF PENDING, and that split is the whole reason this mode
// exists. `is_expired` is derived on the view and only means anything while a
// pass is still pending (see statusStyles.isExpiredPending); a board that folds
// the two together tells an admin there are 12 passes waiting at the gate when
// 9 of them are dead paperwork nobody can act on.
//
// Unlike the category legend, ZERO BUCKETS ARE DROPPED here (the card passes
// hideEmpty). Categories are a fixed taxonomy — "RGP In: 0" is a fact about
// today. `held` and `cancelled` are rare terminal states, and five permanent
// zeros under the ring is clutter that buries the three lines that move.
const STATUS_SLICE_ORDER: { key: string; label: string; match: (p: GatePassView) => boolean }[] = [
  { key: 'pending', label: 'Pending', match: (p) => p.status === 'pending' && !p.is_expired },
  { key: 'expired', label: 'Expired', match: isExpiredPending },
  { key: 'matched', label: 'Cleared at Gate', match: (p) => p.status === 'matched' },
  { key: 'flagged', label: 'Mismatched', match: (p) => p.status === 'flagged' },
  { key: 'hod_reviewed', label: 'HOD Approved', match: (p) => p.status === 'hod_reviewed' },
  { key: 'held', label: 'Held', match: (p) => p.status === 'held' },
  { key: 'cancelled', label: 'Cancelled', match: (p) => p.status === 'cancelled' },
];

export function statusSlices(rows: GatePassView[]): Slice[] {
  return STATUS_SLICE_ORDER.map(({ key, label, match }) => {
    const matched = rows.filter(match);
    return { key, label, value: matched.length, rows: matched };
  });
}

// ─── Returnable Status — the return-loop donut ───────────────────────────────
// RGP passes only. An NRGP is pinned to `not_applicable` by
// `gate_passes_return_status_rgp_only` (001) and never enters a return cycle,
// so including it would inflate the denominator with material that was never
// coming back.
//
// OVERDUE IS A THIRD BUCKET, NOT A HIGHLIGHT ON THE SECOND. An overdue pass is
// still awaiting return, so the obvious two predicates overlap and the ring adds
// up to more passes than exist. Awaiting Return here means "still out and NOT
// yet late"; the two together are the open obligation.
export function returnableSlices(rows: GatePassView[]): Slice[] {
  const returned = rows.filter((p) => p.return_status === 'returned');
  const open = rows.filter(
    (p) => p.return_status === 'awaiting_return' || p.return_status === 'partially_returned',
  );
  const overdue = open.filter((p) => p.is_overdue);
  const onTime = open.filter((p) => !p.is_overdue);

  return [
    { key: 'returned', label: 'Returned', value: returned.length, rows: returned },
    { key: 'awaiting', label: 'Awaiting Return', value: onTime.length, rows: onTime },
    { key: 'overdue', label: 'Overdue', value: overdue.length, rows: overdue },
  ];
}

// ─── Department Activity ─────────────────────────────────────────────────────
/** Departments ranked by volume, busiest first.
 *
 *  `department_name` can legitimately be null: `v_gate_passes` LEFT JOINs
 *  `public.departments` on purpose, because VMS owns that table and may narrow
 *  its policies without notice — a left join degrades to a missing name, where
 *  an inner join would make the pass row vanish entirely. Visibly wrong beats
 *  invisibly wrong, so a nameless department is labelled, not dropped. */
export function departmentSlices(rows: GatePassView[]): Slice[] {
  const byId = new Map<string, Slice>();
  for (const p of rows) {
    const key = p.department_id ?? 'unassigned';
    let slice = byId.get(key);
    if (!slice) {
      slice = { key, label: p.department_name || 'Unassigned', value: 0, rows: [] };
      byId.set(key, slice);
    }
    slice.rows.push(p);
    slice.value += 1;
  }
  return [...byId.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

// ─── Top Materials (by movement) ─────────────────────────────────────────────
/** The materials that crossed the gate most often.
 *
 *  BY MOVEMENT MEANS TRIPS, NOT UNITS. One delivery of 500 screws is one
 *  movement; ten separate ladder trips are ten. Ranking by `quantity` would put
 *  the screws on top and tell an operations reader the opposite of what they
 *  came to find out — which material keeps occupying the loading bay.
 *
 *  A pass counts ONCE per material even if it carries several lines of it, for
 *  the same reason: that is still one trip.
 *
 *  `items` is scoped by its parent pass, never by its own timestamp: only passes
 *  present in `rows` contribute, so a bar can never count a movement its own
 *  click cannot show. */
export function topMaterials(items: GatePassItemView[], rows: GatePassView[], limit: number): Slice[] {
  const passById = new Map(rows.map((p) => [p.id, p]));

  const byMaterial = new Map<string, { label: string; passIds: Set<string> }>();
  for (const item of items) {
    if (!passById.has(item.gate_pass_id)) continue;
    const name = (item.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let entry = byMaterial.get(key);
    if (!entry) {
      // First spelling seen wins the label — "Hydraulic Pump" and
      // "hydraulic pump" are one material, and title-casing them ourselves
      // would invent a spelling nobody typed.
      entry = { label: name, passIds: new Set() };
      byMaterial.set(key, entry);
    }
    entry.passIds.add(item.gate_pass_id);
  }

  return [...byMaterial.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      value: entry.passIds.size,
      // Rebuilt from `rows` so the drill list is in the board's own order, not
      // in item-insertion order.
      rows: rows.filter((p) => entry.passIds.has(p.id)),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ─── Trend ───────────────────────────────────────────────────────────────────
export interface TrendBucket {
  /** Local midnight of the day, as epoch ms — stable across re-renders. */
  start: number;
  /** Short axis label, e.g. "17 Aug". */
  label: string;
  rgp: number;
  nrgp: number;
  total: number;
  rows: GatePassView[];
}

const AXIS_LABEL = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** One bucket per LOCAL calendar day, oldest first, the last one being today.
 *
 *  Local, not UTC: a pass raised at 09:00 IST belongs to that morning on every
 *  screen in this app, and bucketing on the ISO date string would move a
 *  06:00 IST pass to the previous day. `now` is injectable so a test cannot
 *  straddle midnight. */
export function trendBuckets(rows: GatePassView[], days: number, now: number = Date.now()): TrendBucket[] {
  const today = new Date(now);
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const buckets: TrendBucket[] = [];
  const index = new Map<number, TrendBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const start = endOfToday - i * DAY_MS;
    const bucket: TrendBucket = { start, label: AXIS_LABEL.format(new Date(start)), rgp: 0, nrgp: 0, total: 0, rows: [] };
    buckets.push(bucket);
    index.set(start, bucket);
  }

  for (const p of rows) {
    const d = new Date(p.created_at);
    const bucket = index.get(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    if (!bucket) continue; // outside the window
    if (p.type === 'RGP') bucket.rgp += 1;
    else bucket.nrgp += 1;
    bucket.total += 1;
    bucket.rows.push(p);
  }

  return buckets;
}

/** Just the daily totals — what a KPI card's sparkline draws. */
export function countsPerDay(rows: GatePassView[], days: number, now: number = Date.now()): number[] {
  return trendBuckets(rows, days, now).map((b) => b.total);
}

// ─── Period delta ────────────────────────────────────────────────────────────
/** Signed percentage change against the previous window of the same length.
 *
 *  Null when the previous window was empty. A rise from 0 to 5 is not "+500%"
 *  and not "+∞%" — it is a change with no percentage form, and printing a
 *  fabricated one on a board people make decisions from is worse than printing
 *  nothing. The card shows the raw previous count instead. */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
