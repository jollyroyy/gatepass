// Every number on the admin dashboard is derived here, and every chart segment
// carries the exact rows it counted. That is the invariant the whole board rests
// on (CLAUDE.md: "a KPI's number is `rows.length` of the very list the click
// opens") — these tests exist to make a slice whose label and drill disagree
// impossible rather than merely unlikely.
import { describe, it, expect } from 'vitest';
import type { GatePassView, GatePassItemView } from '../../src/types';
import { departmentSlices, topMaterials } from '../../src/lib/boardAnalytics';

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now" so a test can never straddle local midnight and fail at 23:59.
const NOW = new Date(2026, 7, 17, 14, 0, 0).getTime();
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x',
    pass_number: 'RGP-OUT-20260817-0001',
    type: 'RGP',
    direction: 'out',
    status: 'matched',
    return_status: 'not_applicable',
    department_id: 'd1',
    department_name: 'Housekeeping',
    department_code: 'HK',
    is_overdue: false,
    created_at: daysAgo(0),
    ...over,
  } as GatePassView;
}

describe('departmentSlices', () => {
  it('ranks departments by volume, busiest first', () => {
    const rows = [
      pass({ id: '1', department_id: 'a', department_name: 'Engineering' }),
      pass({ id: '2', department_id: 'b', department_name: 'Housekeeping' }),
      pass({ id: '3', department_id: 'b', department_name: 'Housekeeping' }),
      pass({ id: '4', department_id: 'b', department_name: 'Housekeeping' }),
      pass({ id: '5', department_id: 'a', department_name: 'Engineering' }),
    ];
    expect(departmentSlices(rows).map((s) => [s.label, s.value])).toEqual([
      ['Housekeeping', 3],
      ['Engineering', 2],
    ]);
  });

  it('never invents a department name for a pass whose join came back null', () => {
    // v_gate_passes LEFT JOINs public.departments on purpose (VMS owns that
    // table and can narrow its policies without notice), so a null name is a
    // state this board must render honestly rather than crash on.
    const slices = departmentSlices([pass({ department_id: 'z', department_name: null as unknown as string })]);
    expect(slices[0].label).toBe('Unassigned');
  });
});

describe('topMaterials', () => {
  function item(over: Partial<GatePassItemView>): GatePassItemView {
    return { id: 'i', gate_pass_id: 'a', name: 'Drill', quantity: 1, ...over } as GatePassItemView;
  }

  const rows = [pass({ id: 'a' }), pass({ id: 'b' }), pass({ id: 'c' })];

  it('ranks material lines by how many times they moved, not by quantity', () => {
    // "By movement" is a count of trips through the gate. Ranking by quantity
    // would put one delivery of 500 screws above ten separate ladder movements,
    // which is the opposite of what an operations reader is looking for.
    const items = [
      item({ id: '1', gate_pass_id: 'a', name: 'Ladder', quantity: 1 }),
      item({ id: '2', gate_pass_id: 'b', name: 'Ladder', quantity: 1 }),
      item({ id: '3', gate_pass_id: 'c', name: 'Screws', quantity: 500 }),
    ];
    expect(topMaterials(items, rows, 5).map((m) => [m.label, m.value])).toEqual([
      ['Ladder', 2],
      ['Screws', 1],
    ]);
  });

  it('folds case and surrounding space together, keeping the first spelling seen', () => {
    const items = [
      item({ id: '1', gate_pass_id: 'a', name: 'Hydraulic Pump' }),
      item({ id: '2', gate_pass_id: 'b', name: '  hydraulic pump ' }),
    ];
    const top = topMaterials(items, rows, 5);
    expect(top).toHaveLength(1);
    expect(top[0].label).toBe('Hydraulic Pump');
    expect(top[0].value).toBe(2);
  });

  it('counts one material once per pass, however many lines of it that pass carries', () => {
    const items = [
      item({ id: '1', gate_pass_id: 'a', name: 'Ladder' }),
      item({ id: '2', gate_pass_id: 'a', name: 'Ladder' }),
    ];
    expect(topMaterials(items, rows, 5)[0].value).toBe(1);
  });

  it('drills to the passes that carried it, and only to passes in scope', () => {
    const items = [
      item({ id: '1', gate_pass_id: 'a', name: 'Ladder' }),
      // A line belonging to a pass outside the selected period. The bar must
      // not count a pass its own click cannot show.
      item({ id: '2', gate_pass_id: 'out-of-scope', name: 'Ladder' }),
    ];
    const top = topMaterials(items, rows, 5);
    expect(top[0].value).toBe(1);
    expect(top[0].rows.map((p) => p.id)).toEqual(['a']);
  });

  it('honours the limit', () => {
    const items = ['a', 'b', 'c'].map((id, i) => item({ id: String(i), gate_pass_id: id, name: `M${i}` }));
    expect(topMaterials(items, rows, 2)).toHaveLength(2);
  });
});

