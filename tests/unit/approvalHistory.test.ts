// What an office holder has already decided (client, 2026-08-20). The two
// history lists behind the Approved / Rejected KPI cards on `/approvals`.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import type { PassApproval } from '../../src/lib/pendingApprovals';
import { decidedByMe, passIdsOnMyLadder } from '../../src/lib/approvalHistory';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234', purpose: 'Formwork', expected_return_date: null,
    actual_return_date: null, verified_by: null, verified_by_name: null,
    verified_at: null, flag_reason: null, qr_token: 't',
    expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-19T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, material_summary: 'Steel',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function approval(over: Partial<PassApproval>): PassApproval {
  return {
    gate_pass_id: 'x', role_key: 'coo', level_no: 2, routed_to: 'me',
    status: 'approved', decided_by: 'me', decided_at: '2026-08-20T09:00:00Z',
    reason: null, created_at: '2026-08-19T04:50:00Z',
    ...over,
  };
}

describe('decidedByMe', () => {
  it('lists the passes I approved, and not the ones I rejected', () => {
    const passes = [pass({ id: 'p1' }), pass({ id: 'p2' })];
    const approvals = [
      approval({ gate_pass_id: 'p1', status: 'approved' }),
      approval({ gate_pass_id: 'p2', status: 'rejected' }),
    ];
    expect(decidedByMe(passes, approvals, 'me', 'approved').map((p) => p.id)).toEqual(['p1']);
    expect(decidedByMe(passes, approvals, 'me', 'rejected').map((p) => p.id)).toEqual(['p2']);
  });

  it('never claims a decision somebody else made on my office', () => {
    const passes = [pass({ id: 'p1' })];
    const approvals = [approval({ gate_pass_id: 'p1', decided_by: 'someone-else' })];
    expect(decidedByMe(passes, approvals, 'me', 'approved')).toEqual([]);
  });

  it('excludes a grandfathered rung — nobody signed it (058)', () => {
    const passes = [pass({ id: 'p1' })];
    const approvals = [approval({ gate_pass_id: 'p1', decided_by: null })];
    expect(decidedByMe(passes, approvals, 'me', 'approved')).toEqual([]);
  });

  it('is empty while the signed-in user is still unresolved', () => {
    const passes = [pass({ id: 'p1' })];
    expect(decidedByMe(passes, [approval({ gate_pass_id: 'p1' })], null, 'approved')).toEqual([]);
  });

  it('reads newest decision first, ties broken on the pass number', () => {
    const passes = [
      pass({ id: 'p1', pass_number: 'RGP-0001' }),
      pass({ id: 'p2', pass_number: 'RGP-0002' }),
      pass({ id: 'p3', pass_number: 'RGP-0003' }),
    ];
    const approvals = [
      approval({ gate_pass_id: 'p1', decided_at: '2026-08-18T09:00:00Z' }),
      approval({ gate_pass_id: 'p2', decided_at: '2026-08-20T09:00:00Z' }),
      approval({ gate_pass_id: 'p3', decided_at: '2026-08-20T09:00:00Z' }),
    ];
    expect(decidedByMe(passes, approvals, 'me', 'approved').map((p) => p.id))
      .toEqual(['p2', 'p3', 'p1']);
  });

  it('keeps a decided pass whatever became of it afterwards', () => {
    const passes = [pass({ id: 'p1', status: 'matched' }), pass({ id: 'p2', status: 'cancelled' })];
    const approvals = [
      approval({ gate_pass_id: 'p1' }),
      approval({ gate_pass_id: 'p2', status: 'rejected' }),
    ];
    expect(decidedByMe(passes, approvals, 'me', 'approved').map((p) => p.id)).toEqual(['p1']);
    expect(decidedByMe(passes, approvals, 'me', 'rejected').map((p) => p.id)).toEqual(['p2']);
  });
});

describe('passIdsOnMyLadder', () => {
  it('takes every pass routed to my office plus everything I decided', () => {
    const approvals = [
      approval({ gate_pass_id: 'p1', role_key: 'coo', status: 'pending', decided_by: null }),
      approval({ gate_pass_id: 'p2', role_key: 'ceo', decided_by: 'me' }),
      approval({ gate_pass_id: 'p3', role_key: 'ceo', decided_by: 'other' }),
    ];
    expect(passIdsOnMyLadder(approvals, 'me', 'coo').sort()).toEqual(['p1', 'p2']);
  });

  it('de-duplicates a pass carrying several of my rungs', () => {
    const approvals = [
      approval({ gate_pass_id: 'p1', role_key: 'coo' }),
      approval({ gate_pass_id: 'p1', role_key: 'ceo', decided_by: 'me' }),
    ];
    expect(passIdsOnMyLadder(approvals, 'me', 'coo')).toEqual(['p1']);
  });
});
