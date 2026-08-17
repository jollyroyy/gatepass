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

// ─── Line / area / sparkline ─────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Values plotted across a `width` × `height` box, y measured DOWN from the top
 *  the way SVG does: 0 sits on the baseline, `max` at the top edge.
 *
 *  A single value is centred rather than pinned to x=0 — with one bucket there
 *  is no span to divide by, and a lone dot in the corner reads as a broken
 *  chart. `max <= 0` flattens everything onto the baseline instead of dividing
 *  by zero. */
export function linePoints(values: number[], max: number, width: number, height: number): Point[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [{ x: width / 2, y: max > 0 ? height - (values[0] / max) * height : height }];

  const step = width / (values.length - 1);
  return values.map((v, i) => ({
    x: i * step,
    y: max > 0 ? height - (v / max) * height : height,
  }));
}

export function pathFrom(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

/** The same polyline, closed down onto the baseline at both ends so it can be
 *  filled — the soft wash under the trend line. */
export function areaFrom(points: Point[], height: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  // The polyline's own leading `M` becomes an `L`, so the fill starts on the
  // baseline and walks UP into the first data point rather than teleporting.
  const walk = `L${pathFrom(points).slice(1)}`;
  return `M ${round(first.x)} ${round(height)} ${walk} L ${round(last.x)} ${round(height)} Z`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Axis ────────────────────────────────────────────────────────────────────

/** Steps a gridline may advance by, as multiples of a power of ten. Wider than
 *  the usual 1/2/5 ladder on purpose: with only 1/2/5 available, a peak of 112
 *  over four gridlines rounds the axis up to 200 and the chart draws its data
 *  in the bottom half of the box. 3 and 6 are what keep the plot filled. */
const STEP_LADDER = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];

/** The top of the y-axis: the smallest "nice" value ≥ `value` that divides
 *  evenly into `ticks` gridlines.
 *
 *  The step is forced to a WHOLE number because every axis in this dashboard
 *  counts passes, and "2.5 passes" on a gridline is not a quantity that exists.
 *  Never returns 0 — an axis with no height cannot be drawn, and an empty
 *  period is a normal state on this board, not an error. */
export function niceMax(value: number, ticks = 4): number {
  if (value <= 0) return ticks;
  const raw = value / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const rung = STEP_LADDER.find((s) => normalized <= s + 1e-9) ?? 10;
  return Math.max(1, Math.ceil(rung * magnitude)) * ticks;
}

/** Gridline values from `max` down to 0 inclusive — highest first, because SVG
 *  and the DOM both render top-down and the caller should not have to reverse. */
export function axisTicks(max: number, count: number): number[] {
  const ticks: number[] = [];
  for (let i = count; i >= 0; i--) ticks.push(Math.round((max / count) * i * 100) / 100);
  return ticks;
}
