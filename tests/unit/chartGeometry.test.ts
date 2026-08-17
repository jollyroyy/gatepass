// The dashboard's charts are hand-drawn SVG — no charting dependency. That is a
// deliberate call (see src/lib/chartGeometry.ts), and it means the geometry has
// to be pinned by tests instead of trusted to a library: a donut whose segments
// do not add up to the whole ring, or a line whose points do not span the plot,
// is a chart that LIES about the database rather than one that looks wrong.
import { describe, it, expect } from 'vitest';
import {
  ringSegments,
  circumferenceOf,
  linePoints,
  pathFrom,
  areaFrom,
  niceMax,
  axisTicks,
  percentOf,
} from '../../src/lib/chartGeometry';

describe('ringSegments — the donut', () => {
  const R = 100;
  const C = circumferenceOf(R);

  it('gives each slice an arc length proportional to its share of the total', () => {
    const segs = ringSegments([{ key: 'a', value: 3 }, { key: 'b', value: 1 }], R);
    expect(segs).toHaveLength(2);
    expect(segs[0].length).toBeCloseTo(C * 0.75, 6);
    expect(segs[1].length).toBeCloseTo(C * 0.25, 6);
  });

  it('lays the slices end to end so the ring closes exactly', () => {
    const segs = ringSegments([{ key: 'a', value: 2 }, { key: 'b', value: 1 }, { key: 'c', value: 1 }], R);
    // Each segment starts where the previous one ended.
    expect(segs[0].offset).toBeCloseTo(0, 6);
    expect(segs[1].offset).toBeCloseTo(segs[0].length, 6);
    expect(segs[2].offset).toBeCloseTo(segs[0].length + segs[1].length, 6);
    // ...and together they are the whole circumference, with nothing left over.
    const total = segs.reduce((s, x) => s + x.length, 0);
    expect(total).toBeCloseTo(C, 6);
  });

  it('renders a single 100% slice as a full ring, not a hairline', () => {
    // The case that breaks naive arc-path maths: start and end coincide, so an
    // <path> arc collapses to nothing. A dashed circle has no such degeneracy.
    const segs = ringSegments([{ key: 'only', value: 7 }], R);
    expect(segs[0].length).toBeCloseTo(C, 6);
    expect(segs[0].offset).toBe(0);
  });

  it('drops zero-valued slices rather than emitting invisible segments', () => {
    const segs = ringSegments([{ key: 'a', value: 5 }, { key: 'b', value: 0 }], R);
    expect(segs.map((s) => s.key)).toEqual(['a']);
  });

  it('returns nothing at all when every value is zero — an empty donut is an empty state', () => {
    expect(ringSegments([{ key: 'a', value: 0 }, { key: 'b', value: 0 }], R)).toEqual([]);
    expect(ringSegments([], R)).toEqual([]);
  });
});

describe('percentOf', () => {
  it('is rounded to two decimals, matching the legend the client asked for', () => {
    expect(percentOf(62, 162)).toBe(38.27);
    expect(percentOf(14, 162)).toBe(8.64);
  });

  it('is 0 rather than NaN when nothing has happened yet', () => {
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe('linePoints — the trend chart', () => {
  it('spans the full plot width, first point at x=0 and last at x=w', () => {
    const pts = linePoints([1, 5, 3], 10, 200, 100);
    expect(pts[0].x).toBe(0);
    expect(pts[2].x).toBe(200);
    expect(pts[1].x).toBe(100);
  });

  it('puts the maximum at the top of the plot and zero on the baseline', () => {
    const pts = linePoints([0, 10], 10, 200, 100);
    expect(pts[0].y).toBe(100); // zero → baseline
    expect(pts[1].y).toBe(0); //  max  → top
  });

  it('centres a single point instead of dividing by zero', () => {
    const pts = linePoints([4], 10, 200, 100);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBe(100);
  });

  it('flattens to the baseline when the scale max is zero — never NaN', () => {
    const pts = linePoints([0, 0, 0], 0, 200, 100);
    expect(pts.every((p) => p.y === 100)).toBe(true);
  });
});

describe('pathFrom / areaFrom', () => {
  it('draws a polyline through every point', () => {
    expect(pathFrom([{ x: 0, y: 10 }, { x: 5, y: 0 }])).toBe('M 0 10 L 5 0');
  });

  it('is an empty string for no points, so the <path> renders nothing', () => {
    expect(pathFrom([])).toBe('');
    expect(areaFrom([], 100)).toBe('');
  });

  it('closes the area down to the baseline on both ends', () => {
    expect(areaFrom([{ x: 0, y: 10 }, { x: 5, y: 0 }], 100)).toBe('M 0 100 L 0 10 L 5 0 L 5 100 Z');
  });
});

describe('niceMax / axisTicks', () => {
  it('rounds the top of the axis up to a readable number', () => {
    expect(niceMax(38)).toBe(40);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(112)).toBe(120);
  });

  it('never returns zero, so an all-empty chart still has a drawable axis', () => {
    expect(niceMax(0)).toBeGreaterThan(0);
  });

  it('keeps every gridline a whole number of passes', () => {
    for (const peak of [0, 1, 3, 7, 38, 112, 999]) {
      const max = niceMax(peak, 4);
      expect(max).toBeGreaterThanOrEqual(peak);
      expect(Number.isInteger(max / 4), `${peak} → ${max} does not divide into 4 gridlines`).toBe(true);
    }
  });

  it('gives evenly spaced ticks from 0 to the max, highest first for top-down rendering', () => {
    expect(axisTicks(80, 4)).toEqual([80, 60, 40, 20, 0]);
  });
});
