// The person collecting material used to be labelled "Authorized Person" on
// the pass-detail page, the print slip and the "raise pass" success popup,
// "Visitor" on the gate drill card and report tables, and the raise-pass form
// placeholder began with "Person authorized to collect material" under a
// label that also said "Authorized Person". None of these agreed with each
// other or with `visitor_name`, the column all of them actually render.
//
// This pins the label as "Visitor Name" everywhere a human reads it, while
// leaving every machine-facing identifier (the column name, the RPC arg, the
// CSV column *key*, the form placeholder text) untouched — see CLAUDE.md's
// rule: rename what a human reads, never what a machine reads.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

// Mutable slot the hoisted supabaseClient mock reads — set per-test before
// PassDetail is dynamically imported and rendered.
let detailPass: GatePassView | null = null;

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: detailPass, error: null });
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
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
    id: 'p1', pass_number: 'RGP-OUT-20260810-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: '2026-08-10T23:59:59Z', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('"Visitor Name" is the label everywhere visitor_name is shown', () => {
  it('PassDetailsCards (the raise-pass form) labels the field "Visitor Name"', async () => {
    const PassDetailsCards = (await import('../../src/pages/HOD/PassDetailsCards')).default;
    render(
      <PassDetailsCards
        form={{
          type: 'RGP', direction: 'out', department_id: 'd1',
          visitor_name: '', visitor_phone: '', visitor_company: '', company_address: '',
          vehicle_number: '', purpose: '', expected_return_date: '', items: [],
        }}
        errors={{}}
        vendors={[]}
        saveVendor={false}
        onTypeChange={() => {}}
        onUpdate={() => {}}
        onSaveVendorChange={() => {}}
      />
    );
    expect(screen.getByText('Visitor Name')).toBeInTheDocument();
    // The placeholder stays descriptive — it is form guidance, not the label.
    expect(screen.getByPlaceholderText('Person authorized to collect material')).toBeInTheDocument();
    expect(screen.queryByText('Authorized Person')).not.toBeInTheDocument();
  });

  it('PassSubmittedModal (the raise-pass success popup) labels it "Visitor Name"', async () => {
    const PassSubmittedModal = (await import('../../src/pages/HOD/PassSubmittedModal')).default;
    render(
      <MemoryRouter>
        <PassSubmittedModal submittedPass={pass()} deptName="Engineering (ENG)" itemCount={1} onClose={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText('Visitor Name')).toBeInTheDocument();
    expect(screen.queryByText('Authorized Person')).not.toBeInTheDocument();
  });

  it('the pass-detail page labels it "Visitor Name"', async () => {
    detailPass = pass();
    const PassDetail = (await import('../../src/pages/Shared/PassDetail')).default;
    render(
      <MemoryRouter initialEntries={['/pass/p1']}>
        <PassDetail />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Visitor Name')).toBeInTheDocument());
    expect(screen.queryByText('Authorized Person')).not.toBeInTheDocument();
  });
});

describe('no stale visitor-name label text survives anywhere in src/', () => {
  function listTsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...listTsxFiles(full));
      else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('grep: "Authorized Person" / "Authorised Person" / "Collector" do not appear in src/**', () => {
    const files = listTsxFiles(join(__dirname, '../../src'));
    const offenders: string[] = [];
    const banned = /Authorized Person|Authorised Person|Collector/;
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (banned.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
