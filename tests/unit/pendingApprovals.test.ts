// Pending Approvals' pure derivations (migration 046): whose queue a pass is
// in, the slip-order clause, the read-only "waiting below me" split, search
// and the two filters.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  inMyQueue,
  sortOldestFirst,
  stuckBelowMe,
  matchesSearch,
  applyApprovalFilters,
  departmentOptions,
  DEFAULT_APPROVAL_FILTERS,
  type PassApproval,
} from '../../src/lib/pendingApprovals';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Formwork Support', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-19T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 3, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function approval(over: Partial<PassApproval>): PassApproval {
  return {
    gate_pass_id: 'x',
    role_key: 'security_head',
    level_no: 1,
    routed_to: 'u2',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    reason: null,
    created_at: '2026-08-19T04:50:00Z',
    ...over,
  };
}

describe('inMyQueue', () => {
  it('includes a pass whose own row is pending and is the lowest pending level', () => {
    const p = pass({ id: 'p1' });
    const rows = [approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1 })];
    expect(inMyQueue([p], rows, 'security_head')).toEqual([p]);
  });

  it('excludes a pass whose office row is decided already', () => {
    const p = pass({ id: 'p1' });
    const rows = [
      approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1, status: 'approved', decided_by: 'u9', decided_at: '2026-08-19T05:00:00Z' }),
    ];
    expect(inMyQueue([p], rows, 'security_head')).toEqual([]);
  });

  it('excludes a pass held up by an earlier office — the slip-order clause', () => {
    const p = pass({ id: 'p1' });
    const rows = [
      approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1, status: 'pending' }),
      approval({ gate_pass_id: 'p1', role_key: 'coo', level_no: 2, status: 'pending' }),
    ];
    expect(inMyQueue([p], rows, 'coo')).toEqual([]);
  });

  it('includes a pass for the second office once the first has approved', () => {
    const p = pass({ id: 'p1' });
    const rows = [
      approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1, status: 'approved', decided_by: 'u9', decided_at: '2026-08-19T05:00:00Z' }),
      approval({ gate_pass_id: 'p1', role_key: 'coo', level_no: 2, status: 'pending' }),
    ];
    expect(inMyQueue([p], rows, 'coo')).toEqual([p]);
  });

  it('excludes a pass whose own status has moved off pending (matched/flagged/cancelled)', () => {
    const p = pass({ id: 'p1', status: 'matched' });
    const rows = [approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1 })];
    expect(inMyQueue([p], rows, 'security_head')).toEqual([]);
  });

  it('excludes a pass carrying no row for my office at all', () => {
    const p = pass({ id: 'p1' });
    const rows = [approval({ gate_pass_id: 'p1', role_key: 'coo', level_no: 2 })];
    expect(inMyQueue([p], rows, 'security_head')).toEqual([]);
  });
});

describe('sortOldestFirst', () => {
  it('orders by created_at ascending', () => {
    const a = pass({ id: 'a', pass_number: 'RGP-A', created_at: '2026-08-19T05:00:00Z' });
    const b = pass({ id: 'b', pass_number: 'RGP-B', created_at: '2026-08-19T04:00:00Z' });
    expect(sortOldestFirst([a, b])).toEqual([b, a]);
  });

  it('breaks ties on pass_number for a stable order', () => {
    const a = pass({ id: 'a', pass_number: 'RGP-B', created_at: '2026-08-19T04:00:00Z' });
    const b = pass({ id: 'b', pass_number: 'RGP-A', created_at: '2026-08-19T04:00:00Z' });
    expect(sortOldestFirst([a, b])).toEqual([b, a]);
  });
});

describe('matchesSearch', () => {
  const p = pass({ pass_number: 'RGP-20260819-0007', purpose: 'Formwork Support' });

  it('matches on pass number, vendor and purpose, case-insensitively', () => {
    expect(matchesSearch(p, 'rgp-20260819-0007')).toBe(true);
    expect(matchesSearch(p, 'lmn')).toBe(true);
    expect(matchesSearch(p, 'formwork')).toBe(true);
    expect(matchesSearch(p, 'nonexistent')).toBe(false);
  });

  it('treats blank/whitespace-only search as matching everything', () => {
    expect(matchesSearch(p, '   ')).toBe(true);
  });
});

describe('applyApprovalFilters', () => {
  const passes = [
    pass({ id: 'a', pass_number: 'RGP-A', type: 'RGP', department_name: 'Engineering', purpose: 'Steel' }),
    pass({ id: 'b', pass_number: 'NRGP-B', type: 'NRGP', department_name: 'Housekeeping', purpose: 'Cleaning' }),
  ];

  it('applies no filter under the defaults', () => {
    expect(applyApprovalFilters(passes, DEFAULT_APPROVAL_FILTERS)).toHaveLength(2);
  });

  it('narrows by type', () => {
    const out = applyApprovalFilters(passes, { ...DEFAULT_APPROVAL_FILTERS, type: 'NRGP' });
    expect(out.map((p) => p.id)).toEqual(['b']);
  });

  it('narrows by department', () => {
    const out = applyApprovalFilters(passes, { ...DEFAULT_APPROVAL_FILTERS, department: 'Engineering' });
    expect(out.map((p) => p.id)).toEqual(['a']);
  });

  it('combines with search', () => {
    const out = applyApprovalFilters(passes, { ...DEFAULT_APPROVAL_FILTERS, search: 'steel' });
    expect(out.map((p) => p.id)).toEqual(['a']);
  });
});

describe('departmentOptions', () => {
  it('is sorted and de-duplicated, and drops blanks', () => {
    const rows = [
      pass({ department_name: 'Housekeeping' }),
      pass({ department_name: 'Engineering' }),
      pass({ department_name: 'Engineering' }),
      pass({ department_name: null as unknown as string }),
    ];
    expect(departmentOptions(rows)).toEqual(['Engineering', 'Housekeeping']);
  });
});

describe("stuckBelowMe — the super admin fallback's own list (067)", () => {
  const RAISED = '2026-08-19T04:50:00Z';
  const HOUR = 3600_000;
  const LATE = Date.parse(RAISED) + 60 * HOUR;

  /** A pass sitting on level 1, which 061 hides from level 3 entirely. */
  const held = () => ({
    p: pass({ id: 'p1', created_at: RAISED }),
    rows: [
      approval({ gate_pass_id: 'p1', role_key: 'security_head', level_no: 1 }),
      approval({ gate_pass_id: 'p1', role_key: 'coo', level_no: 3 }),
      approval({ gate_pass_id: 'p1', role_key: 'ceo', level_no: 3 }),
    ],
  });

  it('gives the COO and the CEO a pass nobody has approved in time', () => {
    const { p, rows } = held();
    expect(stuckBelowMe([p], rows, 'coo', 48, LATE)).toEqual([p]);
    expect(stuckBelowMe([p], rows, 'ceo', 48, LATE)).toEqual([p]);
  });

  it('is empty for every office that does not carry the fallback', () => {
    const { p, rows } = held();
    expect(stuckBelowMe([p], rows, 'security_head', 48, LATE)).toEqual([]);
    expect(stuckBelowMe([p], rows, 'finance_head', 48, LATE)).toEqual([]);
    expect(stuckBelowMe([p], rows, null, 48, LATE)).toEqual([]);
  });

  it('is empty until the window has actually elapsed', () => {
    const { p, rows } = held();
    expect(stuckBelowMe([p], rows, 'coo', 48, Date.parse(RAISED) + 47 * HOUR)).toEqual([]);
  });

  it("never lists a pass that is the office's OWN to sign", () => {
    // It belongs in the first card, where signing it properly is the offer.
    // Releasing your own rung past yourself is not a fallback, it is a bypass.
    const p = pass({ id: 'p2', created_at: RAISED });
    const rows = [
      approval({
        gate_pass_id: 'p2', role_key: 'security_head', level_no: 1,
        status: 'approved', decided_by: 'u9', decided_at: RAISED,
      }),
      approval({ gate_pass_id: 'p2', role_key: 'coo', level_no: 3 }),
    ];
    expect(stuckBelowMe([p], rows, 'coo', 48, LATE)).toEqual([]);
  });
});
