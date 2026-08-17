// The dashboard's charts are hand-drawn SVG — no charting dependency. That is a
// deliberate call (see src/lib/chartGeometry.ts), and it means the geometry has
// to be pinned by tests instead of trusted to a library: a donut whose segments
// do not add up to the whole ring is a chart that LIES about the database rather
// than one that looks wrong.
//
// The line/area/axis cases went with the trend chart when the board was cut back
// to today only (2026-08-17) — one ring is the whole of this dashboard's
// geometry now.
import { describe, it, expect } from 'vitest';
import { ringSegments, circumferenceOf, percentOf } from '../../src/lib/chartGeometry';

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
