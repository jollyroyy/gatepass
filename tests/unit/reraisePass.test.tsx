// "RAISE IT AGAIN" — the raise form as the mismatch review hands it over.
//
// Client, 2026-08-17: "if he decides to raise the pass again, it will directly
// take him to the gate pass raise. Depending on the type of the thing, it will
// be automatically populating all those things. He just has to fill it up
// properly and review and then submit it."
//
// THE ONE THING THAT COULD BE CONFIDENTLY WRONG HERE is copying a return date
// that has already passed. `validateRaiseForm` refuses one, so a faithful copy
// hands the HOD a form that CANNOT be submitted and an error under a field they
// never touched — the exact shape of the 2026-08-04 bug where an RGP could not
// be raised at all. A stale date is therefore dropped, which is a question
// rather than a fault.
//
// 2026-08-19: the return date is PASS-LEVEL again (client: "the return date of
// all individual items in the pass should be the expected return date of the
// entire pass"), so it is the source PASS's own `expected_return_date` that is
// carried or dropped here — never a per-item one. Each item's `serial_no` is
// carried across unconditionally; it has no "in the past" problem to guard.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SOURCE: GatePassView = {
  id: 'p-flagged',
  pass_number: 'RGP-OUT-20260817-0009',
  type: 'RGP',
  direction: 'out',
  status: 'flagged',
  flag_reason: 'Two ladders loaded, three on the slip',
  visitor_name: 'Alice Contractor',
  visitor_company: JSON.stringify({ n: 'BSC Services', a: '12 Park St', v: '9876543210' }),
  vehicle_number: 'WB 12 3456',
  expected_return_date: TOMORROW,
  created_at: new Date().toISOString(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const SOURCE_ITEMS = [
  {
    id: 'i1', gate_pass_id: 'p-flagged', line_no: 1, name: 'Ladder',
    description: 'Aluminium 12ft', purpose: 'Signage work', quantity: 3, unit: 'nos',
    approx_value: 4500, serial_no: 'SN-LADDER-1',
  },
  {
    id: 'i2', gate_pass_id: 'p-flagged', line_no: 2, name: 'Drill',
    description: 'Bosch GSB 13mm', purpose: 'Signage work', quantity: 1, unit: 'nos',
    approx_value: 7200, serial_no: null,
  },
];

/** The dead pass being replaced. Mutable so one case can swap the flagged
 *  source for an EXPIRED one — the two are voided by different RPCs. */
let sourceRow: GatePassView = SOURCE;

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let supersedeError: { message: string } | null = null;

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(ok, bad),
  };
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) obj[m] = () => obj;
  obj.maybeSingle = () => thenable(data);
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'hod-1' } } }) } },
  pub: () => ({
    from: () => thenable([{ id: 'd1', name: 'Housekeeping', code: 'HK' }]),
  }),
  gp: () => ({
    from: (table: string) =>
      table === 'v_gate_pass_items'
        ? thenable(SOURCE_ITEMS)
        : table === 'hod_departments'
          ? thenable([{ department_id: 'd1' }])
          : thenable(sourceRow),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'raise_pass') {
        return Promise.resolve({
          data: {
            id: 'p-new', pass_number: 'RGP-OUT-20260817-0011', type: 'RGP', direction: 'out',
            status: 'pending', visitor_name: 'Alice Contractor', visitor_company: null,
            vehicle_number: 'WB 12 3456', total_quantity: 4, created_at: new Date().toISOString(),
          },
          error: null,
        });
      }
      if (fn === 'hod_review_flagged_pass' || fn === 'hod_void_expired_pass') {
        return Promise.resolve({ data: null, error: supersedeError });
      }
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'P M Sharma' }),
}));

import RaisePass from '../../src/pages/HOD/RaisePass';

function renderReraise() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/raise', state: { copyFrom: 'p-flagged' } }]}>
      <Routes>
        <Route path="/raise" element={<RaisePass />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderFresh() {
  return render(
    <MemoryRouter initialEntries={['/raise']}>
      <Routes>
        <Route path="/raise" element={<RaisePass />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  supersedeError = null;
  sourceRow = SOURCE;
});

describe('the raise form, arrived at from a mismatch', () => {
  it('says which pass it is correcting, and why it was stopped', async () => {
    // Repeated from the review screen on purpose: this form is where the HOD
    // acts on the reason, and a correction made from memory is how the same
    // pass gets flagged twice.
    renderReraise();
    expect(await screen.findByRole('heading', { name: 'Raise Gate Pass Again' })).toBeInTheDocument();
    expect(screen.getByText(/RGP-OUT-20260817-0009/)).toBeInTheDocument();
    expect(screen.getByText(/Two ladders loaded, three on the slip/)).toBeInTheDocument();
  });

  it('fills in the vendor, the authorized person, every material line and its serial', async () => {
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Alice Contractor')).toBeInTheDocument());
    // `visitor_company` is a packed `{n,a,v}` blob — unpacked back into three
    // fields, never shown as JSON.
    expect(screen.getByDisplayValue('BSC Services')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12 Park St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument();
    expect(screen.getByDisplayValue('WB 12 3456')).toBeInTheDocument();

    expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Drill')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aluminium 12ft')).toBeInTheDocument();

    // The first line's serial carries across; the second's null becomes ''.
    expect(screen.getByDisplayValue('SN-LADDER-1')).toBeInTheDocument();
    const serials = screen.getAllByLabelText('Serial / ID') as HTMLInputElement[];
    expect(serials.map((s) => s.value)).toEqual(['SN-LADDER-1', '']);
  });

  it('carries the pass-level return date when it is still ahead', async () => {
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument());

    expect((screen.getByLabelText('Expected Return Date') as HTMLInputElement).value).toBe(TOMORROW);
  });

  it('blanks the pass-level return date when the source pass has already passed it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceRow = { ...SOURCE, expected_return_date: '2026-01-02' } as any;
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument());

    expect((screen.getByLabelText('Expected Return Date') as HTMLInputElement).value).toBe('');
  });

  it('voids the mismatched pass ONLY after the replacement is in the database', async () => {
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'hod_review_flagged_pass')).toBe(true));
    const order = rpcCalls.map((c) => c.fn).filter((f) => f === 'raise_pass' || f === 'hod_review_flagged_pass');
    expect(order).toEqual(['raise_pass', 'hod_review_flagged_pass']);

    const supersede = rpcCalls.find((c) => c.fn === 'hod_review_flagged_pass')!;
    expect(supersede.args.p_pass_id).toBe('p-flagged');
    expect(supersede.args.p_action).toBe('reject');
    // The audit trail says WHY it was voided, in the `verifications` row the RPC
    // writes — "rejected" alone would read as the HOD refusing their own pass.
    expect(supersede.args.p_reason).toBe('Superseded by RGP-OUT-20260817-0011');
  });

  it('a failed supersede is a warning, never a submit error', async () => {
    // The new pass exists either way. Telling the HOD "that failed" would invite
    // them to raise a third.
    supersedeError = { message: 'permission denied' };
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    expect(await screen.findByText(/could not be closed/)).toBeInTheDocument();
    expect(screen.getByText(/could not be closed/).textContent).toMatch(/RGP-OUT-20260817-0009/);
  });
});

describe('the raise form, arrived at normally', () => {
  it('carries no correction banner and supersedes nothing', async () => {
    renderFresh();
    expect(await screen.findByRole('heading', { name: 'Raise Gate Pass' })).toBeInTheDocument();
    expect(screen.queryByText(/Correcting/)).not.toBeInTheDocument();
    // One empty line, not the source pass's two.
    await waitFor(() => expect(screen.queryByDisplayValue('Ladder')).not.toBeInTheDocument());
  });
});

describe('the raise form, arrived at from an EXPIRED pass', () => {
  it('supersedes through hod_void_expired_pass, not the flagged RPC', async () => {
    // THE BUG THIS EXISTS FOR: `hod_review_flagged_pass` refuses anything that is
    // not currently flagged, so superseding an expired pass through it fails
    // every time — and fails AFTER the replacement is already raised, leaving the
    // dead pass open with a warning the HOD cannot act on.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceRow = { ...SOURCE, status: 'pending', is_expired: true, flag_reason: null } as any;
    renderReraise();
    await waitFor(() => expect(screen.getByDisplayValue('Ladder')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Raise Gate Pass/ }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'hod_void_expired_pass')).toBe(true));
    const order = rpcCalls.map((c) => c.fn).filter((f) => f === 'raise_pass' || f === 'hod_void_expired_pass');
    // Still only AFTER the replacement exists, for the same reason as the
    // flagged case: an unsubmitted form must not have destroyed the record.
    expect(order).toEqual(['raise_pass', 'hod_void_expired_pass']);
    expect(rpcCalls.some((c) => c.fn === 'hod_review_flagged_pass')).toBe(false);

    const supersede = rpcCalls.find((c) => c.fn === 'hod_void_expired_pass')!;
    expect(supersede.args.p_pass_id).toBe('p-flagged');
    expect(supersede.args.p_reason).toBe('Superseded by RGP-OUT-20260817-0011');
  });
});
