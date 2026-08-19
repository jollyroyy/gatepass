// `visitor_name` does not hold a visitor's name — it holds the name of the
// person the department authorizes to take material through the gate. The
// label was unified to "Visitor Name" on 2026-08-10; the client corrected the
// vocabulary on 2026-08-13: it reads "Authorized Person's Name" everywhere a
// human sees it, including the printed slip.
//
// Every machine-facing identifier is deliberately untouched — the column, the
// RPC arg `p_visitor_name`, and the CSV column *keys* still say `visitor_name`.
// Rename what a human reads, never what a machine reads.
//
// The same session dropped "Material" from the printed slip's own heading:
// "Returnable Gate Pass" / "Non-Returnable Gate Pass". The item table below it
// is already headed "Material Items", so the word was said twice on one sheet.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

// Mutable slot the hoisted supabaseClient mock reads — set per-test before the
// page under test is dynamically imported and rendered.
let detailPass: GatePassView | null = null;
let detailItems: unknown[] = [];

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: detailPass, error: null });
  builder.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve({ data: detailItems, error: null }).then(ok);
  return {
    gp: () => ({ from: () => builder }),
    pub: () => ({ from: () => builder }),
    supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'p1' }),
    useSearchParams: () => [new URLSearchParams(), () => {}],
  };
});

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260813-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: '2026-08-13T23:59:59Z', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const LABEL = "Authorized Person's Name";

describe(`"${LABEL}" is the label everywhere visitor_name is shown`, () => {
  // 2026-08-19: the raise form was rebuilt to the client's "Raise Gate Pass"
  // mock-up. The mock's own words for this field are "Person Who Will Carry",
  // under a "Carrier / Person Details" card — this form no longer uses
  // "Authorized Person's Name" or "Authorized Person Details" at all; those
  // stay the words the success popup, the pass-detail page and the printed
  // slip use, which is what the rest of this file still pins.
  it('the raise-pass form (RGP and NRGP alike) labels the field "Person Who Will Carry", under a "Carrier / Person Details" card', async () => {
    const PassDetailsCards = (await import('../../src/pages/HOD/PassDetailsCards')).default;
    render(
      <PassDetailsCards
        form={{
          type: 'RGP', direction: 'out', department_id: 'd1',
          visitor_name: '', visitor_phone: '', visitor_company: '', company_address: '',
          vehicle_number: '', purpose: '', expected_return_date: '', items: [],
        }}
        errors={{}}
        depts={[]}
        vendors={[]}
        vendorId=""
        onTypeChange={() => {}}
        onUpdate={() => {}}
        onVendorPick={() => {}}
      />
    );
    expect(screen.getByText('Carrier / Person Details')).toBeInTheDocument();
    expect(screen.getByText('Person Who Will Carry', { exact: false })).toBeInTheDocument();
    // The placeholder stays descriptive — it is form guidance, not the label.
    expect(screen.getByPlaceholderText('Enter person name')).toBeInTheDocument();
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Authorized Person Details')).not.toBeInTheDocument();
    expect(screen.queryByText('Visitor Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Visitor Details')).not.toBeInTheDocument();
  });

  it('the raise-pass success popup labels it', async () => {
    const PassSubmittedModal = (await import('../../src/pages/HOD/PassSubmittedModal')).default;
    render(
      <MemoryRouter>
        <PassSubmittedModal submittedPass={pass()} deptName="Engineering (ENG)" itemCount={1} onClose={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.queryByText('Visitor Name')).not.toBeInTheDocument();
  });

  it('the pass-detail page labels it', async () => {
    detailPass = pass();
    detailItems = [];
    const PassDetail = (await import('../../src/pages/Shared/PassDetail')).default;
    render(
      <MemoryRouter initialEntries={['/pass/p1']}>
        <PassDetail />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(LABEL)).toBeInTheDocument());
    expect(screen.queryByText('Visitor Name')).not.toBeInTheDocument();
  });

  it('the printed slip labels it, and its heading no longer says "Material"', async () => {
    detailPass = pass({ type: 'NRGP', direction: 'out' });
    detailItems = [];
    const PassPrint = (await import('../../src/pages/Shared/PassPrint')).default;
    render(
      <MemoryRouter initialEntries={['/print/p1']}>
        <PassPrint />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(LABEL)).toBeInTheDocument());
    // The heading uses a non-breaking hyphen (U+2011), so match loosely.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Non.Returnable Gate Pass$/);
    expect(screen.queryByText('Visitor Name')).not.toBeInTheDocument();
  });
});

describe('no stale "Visitor" label text survives anywhere in src/', () => {
  function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
      else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('grep: no human-facing "Visitor" label, and no "Material Gate Pass" heading', () => {
    // Only quoted/rendered LABEL text is banned — `visitor_name`,
    // `visitor_company` and `p_visitor_name` are machine-facing and must stay.
    const banned = /Visitor Name|Visitor Details|label="Visitor"|Material Gate Pass/;
    const offenders = listSourceFiles(join(__dirname, '../../src'))
      .filter((f) => banned.test(readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
