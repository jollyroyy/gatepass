// The approval ladder card seats ONE person per office, and nothing else.
//
// 054 gave every office a second permanent seat — a standing deputy an admin
// named on this very card. The client withdrew it and 068 removed it, so what
// these cases pin is the ABSENCE: no deputy control is offered, and neither
// deputy RPC is reachable from this screen. A removal nothing tests is a
// removal that comes back the next time somebody restores a select.
//
// The rest is the shape of the control, not the database's rules — "one person,
// one seat" is a unique index and two RPC refusals, and
// `tests/security/sqlInvariants.test.ts` is where that lives.
//
// Mocking pattern copied from tests/unit/createApproverUser.test.tsx — same
// `thenable` shape, same `gp()`/`fetchDirectory` mocks, so this file cannot
// drift from how the rest of the admin portal's tests fake Supabase.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Sanjay Rao', email: 'sanjay@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', full_name: 'Priya Nair', email: 'priya@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
  // Suspended (migration 040/059). `is_active` is optional on Profile, so the
  // two above stand for "flag absent, therefore active".
  {
    id: 'u3', full_name: 'Deepa Menon', email: 'deepa@demo.vms', role: 'staff',
    created_at: '2026-08-01T00:00:00Z', is_active: false,
  },
];

/** Only the Security Head office is filled; the COO's is empty. */
const LADDER = [
  {
    role_key: 'security_head',
    user_id: 'u1',
    full_name: 'Sanjay Rao',
    department_name: 'Security',
    designated_at: '2026-08-01T00:00:00Z',
  },
];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'insert', 'delete', 'schema', 'from']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

const rpcSpy = vi.hoisted(() =>
  vi.fn((name: string) => {
    if (name === 'get_approval_ladder') return Promise.resolve({ data: LADDER, error: null });
    return Promise.resolve({ data: null, error: null });
  }),
);

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => thenable([]), rpc: rpcSpy, schema: () => ({ from: () => thenable([]) }) }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(PROFILES),
}));

import ApprovalLadderCard from '../../src/pages/Admin/ApprovalLadderCard';

async function renderCard() {
  render(<ApprovalLadderCard />);
  await waitFor(() => expect(screen.getByLabelText('Security Head account')).toBeTruthy());
}

describe('the approval ladder card seats one person per office (068)', () => {
  beforeEach(() => rpcSpy.mockClear());

  it('offers no deputy control on any office', async () => {
    await renderCard();
    for (const title of ['Security Head', 'Finance HOD', 'COO', 'CEO']) {
      expect(screen.getByLabelText(`${title} account`)).toBeTruthy();
      expect(screen.queryByLabelText(`${title} deputy`)).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/deputy/i);
  });

  it('seats a holder through set_approval_role', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Security Head account'), { target: { value: 'u2' } });
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('set_approval_role', {
        p_role_key: 'security_head',
        p_user_id: 'u2',
      }),
    );
  });

  it('CLEARS the office rather than writing a null when the blank option is chosen', async () => {
    // `approval_roles.user_id` is NOT NULL — the database has two operations
    // here and the screen must pick the right one.
    await renderCard();
    fireEvent.change(screen.getByLabelText('Security Head account'), { target: { value: '' } });
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('clear_approval_role', { p_role_key: 'security_head' }),
    );
  });

  it('never calls either deputy RPC, which no longer exists', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText('Security Head account'), { target: { value: 'u2' } });
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('set_approval_role', expect.anything()));
    const called = rpcSpy.mock.calls.map((c) => c[0]);
    expect(called).not.toContain('set_approval_deputy');
    expect(called).not.toContain('clear_approval_deputy');
  });

  // A SUSPENDED ACCOUNT CANNOT BE SEATED (migration 059). `my_approval_role()`
  // gates on `is_user_active`, so designating one produces an office that reads
  // as staffed and can approve nothing — which is exactly how an office ends up
  // silently dead while passes pile up behind it.
  it('offers only ACTIVE accounts', async () => {
    await renderCard();
    const options = Array.from((screen.getByLabelText('Security Head account') as HTMLSelectElement).options)
      .map((o) => o.textContent ?? '');
    expect(options.some((o) => o.includes('Sanjay Rao'))).toBe(true);
    expect(options.some((o) => o.includes('Priya Nair'))).toBe(true);
    expect(options.some((o) => o.includes('Deepa Menon'))).toBe(false);
  });

  it('says on screen that deactivating a holder vacates their office', async () => {
    await renderCard();
    expect(document.body.textContent).toMatch(/deactivating a holder vacates their office/i);
  });

  it('says an empty office is empty rather than printing a level with no name', async () => {
    await renderCard();
    expect(document.body.textContent).toMatch(/Not designated yet/i);
  });

  it('no longer claims that designating somebody grants no access', async () => {
    // 046 made that sentence false — an office holder gets /approvals and both
    // decision RPCs — and it sat on this card unrevised until 054.
    await renderCard();
    expect(document.body.textContent).not.toMatch(/grants no access of any kind/i);
    expect(document.body.textContent).toMatch(/grants them real authority/i);
  });
});
