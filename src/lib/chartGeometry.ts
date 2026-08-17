// SVG chart geometry — the whole of it. There is deliberately NO charting
// dependency in this project.
//
// Three reasons, in order of how much they would actually hurt:
//   1. `vercel.json`'s CSP is a live footgun (see CLAUDE.md): it applies only in
//      production, so anything a chart library loads or eval()s works perfectly
//      on localhost and fails silently once deployed. Inline SVG has nothing to
//      load.
//   2. The theme inverts. `navy-*` / `surface-*` flip between light and dark,
//      and a library that paints its own axis/grid colours would need a second,
//      parallel theme definition that nothing keeps in sync.
//   3. Recharts/Chart.js are 90-150 kB for what is, below, sixty lines of
//      arithmetic that unit tests can pin exactly.
//
// Everything here is pure. The components in src/components/charts/ do nothing
// but turn these numbers into elements, so a chart that disagrees with the
// database is a bug in the data layer, never in the drawing.

// ─── Donut ────────────────────────────────────────────────────────────────────
// Drawn as a dashed <circle>, not as <path> arcs. That is not a shortcut: an arc
// path whose start and end coincide — a single slice at 100%, which is the
// normal state of this dashboard on a quiet day — collapses to nothing at all,
// and the fix people reach for (nudging the end angle by a hair) leaves a
// visible notch. A dash on a circle has no such degenerate case.

export interface RingInput {
  key: string;
  value: number;
}

export interface RingSegment extends RingInput {
  /** Arc length of this slice, in user units — the first half of `stroke-dasharray`. */
  length: number;
  /** Where the slice starts along the ring. Negate it for `stroke-dashoffset`. */
  offset: number;
}

export function circumferenceOf(radius: number): number {
  return 2 * Math.PI * radius;
}

/** Slices laid end to end around the ring, in the order given.
 *
 *  Zero-valued slices are DROPPED rather than emitted with a zero length — a
 *  zero-length dash still paints a round line-cap in some renderers, which
 *  shows up as a stray dot on a category that has no passes at all. */
export function ringSegments(inputs: RingInput[], radius: number): RingSegment[] {
  const total = inputs.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return [];

  const circumference = circumferenceOf(radius);
  let offset = 0;
  const out: RingSegment[] = [];
  for (const input of inputs) {
    if (input.value <= 0) continue;
    const length = (input.value / total) * circumference;
    out.push({ ...input, length, offset });
    offset += length;
  }
  return out;
}

/** Share of the total, to two decimals — the form the legend shows. 0 rather
 *  than NaN on an empty period, because "38.27%" and "NaN%" are different kinds
 *  of wrong and only one of them is visibly a bug. */
export function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}
