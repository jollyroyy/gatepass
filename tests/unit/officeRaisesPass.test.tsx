// THE ONE DIFFERENCE BETWEEN THE HOD'S FORM AND THE COO'S / CEO'S: A DEPARTMENT
// SELECTOR, AND NOTHING ELSE.
//
// Client, 2026-08-31: "make sure CEO and COO has the ability to raise pass on
// behalf of any department in their logins, so create those forms exactly as
// the hod sees it except one thing that ceo and coo can select the department
// to raise the gatepass." Migration 069 is the RPC side of this; this file is
// the form side: `useRaiseDepartments` (which list loads, and whether anything
// is pre-selected), `PassDetailsCards` (the selector itself, and the reference
// number preview it feeds), and `RaisePass`'s submit path (which department id
// is sent, and which error an empty choice prints).
//
// `RAISING_OFFICES` in roleRoutes.ts is `['coo', 'ceo']` — the Security Head and
// the Finance HOD are two of the four offices and must render the HOD-shaped
// form with no selector at all, exactly as an HOD would. Route ACCESS to
// `/raise` for those two offices is already covered by
// tests/unit/roleRoutes.test.ts; this file only asserts the FORM they render
// once they are there.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(onFulfilled, onRejected),
  };
  obj.order = () => obj; // office path: `.select(...).order('name')` — unfiltered, full list
  // HOD path: `.select(...).in('id', ids)` — filters `departments` down to the
  // caller's own assignment. A mock that ignored this filter (returning every
  // department regardless) would make the HOD case pass for the wrong reason:
  // it would read back the alphabetically-first department (Engineering)
  // rather than proving the query is scoped by `hod_departments` at all.
  obj.in = (_col: string, ids: string[]) =>
    thenable(Array.isArray(data) ? data.filter((d: { id: string }) => ids.includes(d.id)) : data);
  obj.eq = () => obj;
  obj.limit = () => obj;
  return obj;
}

// EVERY DEPARTMENT IN THE MALL, in the order `useRaiseDepartments` asks
// `pub().from('departments')` to return them: `.order('name')`, so the
// alphabetically-first one (Engineering) is exactly the WRONG department a
// silent default would land a COO's pass on if `autoSelect` were ever set for
// an office holder.
const ALL_DEPTS = [
  { id: 'd-eng', name: 'Engineering', code: 'ENG' },
  { id: 'd-it', name: 'IT', code: 'IT' },
  { id: 'd-mkt', name: 'Marketing', code: 'MKT' },
];

const TABLE_DATA: Record<string, unknown> = {
  hod_departments: [{ department_id: 'd-it' }],
  departments: ALL_DEPTS,
};

function fakeFrom(table: string) {
  return { select: () => thenable(TABLE_DATA[table] ?? []) };
}

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: fakeFrom,
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({
        data: {
          id: 'p-new', pass_number: 'RGP-ENG-0001', type: 'RGP', direction: 'out',
          status: 'pending', visitor_name: 'Vendor Rep', visitor_company: null,
          vehicle_number: null, total_quantity: 2, created_at: new Date().toISOString(),
        },
        error: null,
      });
    },
  }),
  pub: () => ({ from: fakeFrom }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-office' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'Test Office Holder' }),
}));

vi.mock('../../src/lib/notifyApproval', () => ({
  notifyApproval: () => Promise.resolve(),
}));

import RaisePass from '../../src/pages/HOD/RaisePass';

function renderAs(office: 'coo' | 'ceo' | 'security_head' | 'finance_head' | null) {
  return render(
    <MemoryRouter>
      <RaisePass office={office} />
    </MemoryRouter>,
  );
}

async function fillRequiredFields() {
  // Several of these labels carry a trailing `<Req/>` asterisk as part of the
  // label's own text ("Person Who Will Carry *"), so an exact match on the
  // visible words alone never resolves — a leading-substring regex is used
  // wherever the field has no separate `aria-label` overriding it.
  fireEvent.change(screen.getByLabelText('Vendor Name'), { target: { value: 'Acme Vendor' } });
  fireEvent.change(screen.getByLabelText(/^Person Who Will Carry/), { target: { value: 'Carrier One' } });
  fireEvent.change(screen.getByLabelText(/^Mobile Number/), { target: { value: '9876543210' } });
  fireEvent.change(screen.getByLabelText(/^Purpose \/ Description/), { target: { value: 'Testing' } });
  const names = await screen.findAllByLabelText('Item Description');
  const makeModels = screen.getAllByLabelText('Make / Model / Size');
  const qtys = screen.getAllByLabelText('Quantity');
  const dates = screen.getAllByLabelText('Expected Return Date');
  names.forEach((el, i) => fireEvent.change(el, { target: { value: `Item ${i + 1}` } }));
  makeModels.forEach((el, i) => fireEvent.change(el, { target: { value: `Model ${i + 1}` } }));
  qtys.forEach((el) => fireEvent.change(el, { target: { value: '1' } }));
  dates.forEach((el) => fireEvent.change(el, { target: { value: '2026-09-15' } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
});

describe('RaisePass — a raising office picks the department; an HOD never does', () => {
  it('renders a Department select for a COO, listing every department, blank and unselected', async () => {
    renderAs('coo');
    // The label's own text is "Department *" (the `<Req/>` asterisk lives
    // inside the `<label>`, not a separate `aria-label`), so an exact match on
    // "Department" alone never resolves — every query below matches by prefix.
    const select = (await screen.findByLabelText(/^Department/)) as HTMLSelectElement;
    expect(select.id).toBe('rp-dept');

    await waitFor(() => expect(select.options.length).toBe(ALL_DEPTS.length + 1));
    expect(select.options[0].value).toBe('');
    // Alphabetical, matching the `.order('name')` the hook asks for.
    expect(Array.from(select.options).slice(1).map((o) => o.textContent)).toEqual([
      'Engineering (ENG)', 'IT (IT)', 'Marketing (MKT)',
    ]);

    // AN OFFICE HOLDER HEADS NONE OF THESE — nothing is pre-selected, because
    // defaulting to the alphabetically-first department is how a pass gets
    // raised against a department nobody chose.
    expect(select.value).toBe('');
  });

  it('renders no department control at all for a plain HOD, who loads from hod_departments', async () => {
    renderAs(null);
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));

    expect(screen.queryByLabelText(/^Department/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('rp-dept')).not.toBeInTheDocument();
    // The reference number still resolves — from the HOD's own assignment, IT
    // — proving the department loaded from `hod_departments`, not `departments`
    // unfiltered.
    expect((await screen.findByLabelText('Reference Number') as HTMLInputElement).value)
      .toBe('RGP-IT-####');
  });

  it('the Security Head and the Finance HOD get the HOD-shaped form too — no selector', async () => {
    renderAs('security_head');
    await waitFor(() => expect(screen.getAllByLabelText('Item Description')).toHaveLength(2));
    expect(screen.queryByLabelText(/^Department/)).not.toBeInTheDocument();

    renderAs('finance_head');
    await waitFor(() => expect(screen.getAllByLabelText('Item Description').length).toBeGreaterThan(0));
    expect(screen.queryAllByLabelText(/^Department/)).toHaveLength(0);
  });

  it('picking a department updates the Reference Number preview to its code', async () => {
    renderAs('coo');
    const select = (await screen.findByLabelText(/^Department/)) as HTMLSelectElement;
    const ref = screen.getByLabelText('Reference Number') as HTMLInputElement;

    // NOTHING IS CHOSEN, SO NOTHING IS PREVIEWED. `chosenDept` deliberately
    // does NOT fall back to `depts[0]` for a reader who picks: printing the
    // alphabetically-first department's code in the read-only reference field
    // over a form where no department has been chosen reads as a choice already
    // made — the same silent default `useRaiseDepartments.ts` refuses for the
    // value itself. `DEPT` is the honest placeholder, and it never claims to be
    // a real prefix. (An HOD is unaffected: their one department is selected
    // for them the moment the list lands, and `depts[0]` still covers the frame
    // before that.)
    expect(ref.value).toBe('RGP-DEPT-####');

    fireEvent.change(select, { target: { value: 'd-mkt' } });
    await waitFor(() => expect(ref.value).toBe('RGP-MKT-####'));

    fireEvent.change(select, { target: { value: 'd-eng' } });
    await waitFor(() => expect(ref.value).toBe('RGP-ENG-####'));
  });

  it('submitting as a COO sends p_department_id equal to the CHOSEN department', async () => {
    renderAs('coo');
    const select = (await screen.findByLabelText(/^Department/)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'd-mkt' } });
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'raise_pass')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'raise_pass')!;
    expect(call.args.p_department_id).toBe('d-mkt');
  });

  it('submitting as a COO with no department chosen calls no RPC and names the office error', async () => {
    renderAs('coo');
    await screen.findByLabelText(/^Department/);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() =>
      expect(screen.getByText('Choose the department this pass is raised for.')).toBeInTheDocument(),
    );
    expect(rpcCalls.some((c) => c.fn === 'raise_pass')).toBe(false);
    // The HOD's own wording for the same underlying failure must not leak into
    // an office holder's form — it names an assignment they were never given.
    expect(screen.queryByText('You are not assigned to any department.')).not.toBeInTheDocument();
  });
});
