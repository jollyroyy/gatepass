// Every aggregate the board draws — the daily movement series and the Top Items
// ranking.
//
// ONE RULE GOVERNS THIS WHOLE FILE: an aggregate carries the rows it counted.
// Not the count and a predicate that a caller re-applies somewhere else — the
// actual array. That is the same invariant the KPI cards have always had in this
// app ("a KPI's number is `rows.length` of the very list the click opens"),
// extended to chart segments, because a bar reading 6 that drills into 8 passes
// is a board nobody can trust and nobody can debug.
//
// Nothing here queries. The board fetches once and windows once; these functions
// only ever see an array that is already in scope.
import type { GatePassView, GatePassItemView } from '../types';
import { categoryKey } from './passTypes';
import { dayStart, dayStartBefore } from './localDay';

/** A labelled aggregate plus the exact passes behind it. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  rows: GatePassView[];
}

// ─── Top Materials (by movement) ─────────────────────────────────────────────
/** The materials that crossed the gate most often.
 *
 *  BY MOVEMENT MEANS TRIPS, NOT UNITS. One delivery of 500 screws is one
 *  movement; ten separate ladder trips are ten. Ranking by `quantity` would put
 *  the screws on top and tell an operations reader the opposite of what they came
 *  to find out — which material keeps occupying the loading bay.
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
      // First spelling seen wins the label — "Hydraulic Pump" and "hydraulic
      // pump" are one material, and title-casing them ourselves would invent a
      // spelling nobody typed.
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
      // Rebuilt from `rows` so the drill list is in the board's own order, not in
      // item-insertion order.
      rows: rows.filter((p) => entry.passIds.has(p.id)),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ─── Daily Movement Trend ────────────────────────────────────────────────────
// THE TREND PLOTS GATE EVENTS, NOT PAPERWORK: `created_at` is when an HOD typed a pass and
// `verified_at` / `actual_return_date` are when material actually moved. A
// "Daily Movement Trend" drawn on `created_at` shows traffic on a day the gate
// was shut.

export type MovementKey = 'rgpOut' | 'rgpReturn' | 'nrgpOut';

/** The three series, in the reference's legend order. */
export const MOVEMENT_SERIES: readonly { key: MovementKey; label: string }[] = [
  { key: 'rgpOut', label: 'RGP Out' },
  { key: 'rgpReturn', label: 'RGP Return' },
  { key: 'nrgpOut', label: 'NRGP' },
];

export interface MovementBucket {
  /** Local midnight of the day, as epoch ms — stable across re-renders. */
  start: number;
  /** Short axis label, e.g. "17 Aug". */
  label: string;
  counts: Record<MovementKey, number>;
  /** Movements that day, across all three series. Not the row count: a pass that
   *  went out and came back on the same day is two movements and one pass. */
  total: number;
  /** The passes behind the day, each listed once — what the day's click opens. */
  rows: GatePassView[];
}

const AXIS_LABEL = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** One bucket per LOCAL calendar day, oldest first, the last one being today.
 *
 *  Local, not UTC: a pass cleared at 09:00 IST belongs to that morning on every
 *  screen in this app, and bucketing on the ISO string would move a 06:00 IST
 *  movement to the previous day. `now` is injectable so a test cannot straddle
 *  midnight.
 *
 *  RGP In is counted in no series on purpose. `RaisePass` hardcodes
 *  `p_direction: 'out'`, so an RGP-in pass cannot currently be created at all —
 *  a fourth line that is flat by construction is a legend entry that teaches the
 *  reader nothing. Give it its own series on the day inbound returnables can be
 *  raised. */
export function movementBuckets(rows: GatePassView[], days: number, now: number = Date.now()): MovementBucket[] {
  const buckets: MovementBucket[] = [];
  const index = new Map<number, MovementBucket>();
  // One Set per bucket, so a pass that moved twice in a day is counted twice in
  // `counts` (two movements, which is the truth) but listed once in `rows`.
  const seen = new Map<number, Set<string>>();

  for (let i = days - 1; i >= 0; i--) {
    const start = dayStartBefore(now, i);
    const bucket: MovementBucket = {
      start,
      label: AXIS_LABEL.format(new Date(start)),
      counts: { rgpOut: 0, rgpReturn: 0, nrgpOut: 0 },
      total: 0,
      rows: [],
    };
    buckets.push(bucket);
    index.set(start, bucket);
    seen.set(start, new Set());
  }

  const record = (day: number, key: MovementKey, p: GatePassView): void => {
    const bucket = index.get(day);
    if (!bucket) return; // outside the window
    bucket.counts[key] += 1;
    bucket.total += 1;
    const ids = seen.get(day);
    if (ids && !ids.has(p.id)) {
      ids.add(p.id);
      bucket.rows.push(p);
    }
  };

  for (const p of rows) {
    if (p.actual_return_date) {
      record(dayStart(new Date(p.actual_return_date).getTime()), 'rgpReturn', p);
    }
    if (p.status === 'matched' && p.verified_at) {
      const category = categoryKey(p.type, p.direction);
      if (category === 'RGP-out') record(dayStart(new Date(p.verified_at).getTime()), 'rgpOut', p);
      else if (category === 'NRGP-out') record(dayStart(new Date(p.verified_at).getTime()), 'nrgpOut', p);
    }
  }

  return buckets;
}
