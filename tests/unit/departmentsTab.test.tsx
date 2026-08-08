// The admin Departments tab had two gaps:
//   * "Heads of Department" was a dead KPI — a number with no onClick, so there
//     was no way to see WHO the HODs are or which departments they cover.
//   * Departments rendered in a 3-across grid, so a department with several HODs
//     produced a tall narrow column of cramped rows.
// Departments are now one full-width glass row each, and the HOD KPI opens a
// directory of every HOD with their department.
// One department per person since migration 032: an HOD appears against a single
// department, but a department can still host several HODs.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const DEPARTMENTS = [
  { id: 'd1', name: 'Engineering', code: 'ENG' },
  { id: 'd2', name: 'Housekeeping', code: 'HK' },
];

const HODS = [
  { id: 'h1', full_name: 'Asha Rao', email: 'asha@demo.vms', role: 'hod' },
  { id: 'h2', full_name: 'Bikram Sen', email: 'bikram@demo.vms', role: 'hod' },
];

// Each HOD heads exactly one department; Engineering has two HODs (032 rule).
const ASSIGNMENTS = [
  { hod_id: 'h1', department_id: 'd1', created_at: '2026-08-01T00:00:00Z' },
  { hod_id: 'h2', department_id: 'd1', created_at: '2026-08-01T00:00:00Z' },
];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'insert', 'delete']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => thenable(ASSIGNMENTS), rpc: () => thenable(null) }),
  pub: () => ({ from: () => thenable(DEPARTMENTS) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(HODS),
  fetchDisplayName: () => Promise.resolve('Admin'),
  fetchMyProfile: () => Promise.resolve({ full_name: 'Admin', avatar_url: null }),
}));

import DepartmentsTab from '../../src/pages/Admin/DepartmentsTab';

/** The KPI card specifically — "Heads of Department" also appears as the
 *  heading of the panel it opens, so a bare text query is ambiguous once open. */
function hodKpi(): HTMLElement {
  const card = screen.getAllByText('Heads of Department')
    .map((el) => el.closest('button'))
    .find((el): el is HTMLButtonElement => el !== null);
  if (!card) throw new Error('Heads of Department KPI is not a button');
  return card;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Departments tab — HOD directory', () => {
  it('makes the Heads of Department figure clickable', async () => {
    render(<DepartmentsTab />);
    await waitFor(() => expect(screen.getByText('Heads of Department')).toBeInTheDocument());
    const card = screen.getByText('Heads of Department').closest('button');
    expect(card).not.toBeNull();
  });

  it('lists every HOD with the departments they cover when clicked', async () => {
    render(<DepartmentsTab />);
    await waitFor(() => expect(screen.getByText('Heads of Department')).toBeInTheDocument());

    fireEvent.click(hodKpi());

    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.getByText('Bikram Sen')).toBeInTheDocument();
    expect(screen.getByText('asha@demo.vms')).toBeInTheDocument();

    // Asha heads Engineering; Housekeeping has no HOD of its own here.
    const ashaRow = screen.getByText('Asha Rao').closest('[data-testid="hod-row"]');
    expect(ashaRow).not.toBeNull();
    expect(ashaRow?.textContent).toContain('ENG');
    expect(ashaRow?.textContent).not.toContain('HK');

    const bikramRow = screen.getByText('Bikram Sen').closest('[data-testid="hod-row"]');
    expect(bikramRow?.textContent).toContain('ENG');
    expect(bikramRow?.textContent).not.toContain('HK');
  });

  it('closes the directory when the figure is clicked again', async () => {
    render(<DepartmentsTab />);
    await waitFor(() => expect(screen.getByText('Heads of Department')).toBeInTheDocument());

    fireEvent.click(hodKpi());
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());

    fireEvent.click(hodKpi());
    await waitFor(() => expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument());
  });

  it('says so plainly when an HOD covers no department', async () => {
    render(<DepartmentsTab />);
    await waitFor(() => expect(screen.getByText('Heads of Department')).toBeInTheDocument());
    fireEvent.click(hodKpi());
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    // Both fixtures have departments, so the empty phrasing must NOT appear.
    expect(screen.queryByText('No department assigned')).not.toBeInTheDocument();
  });
});

describe('Departments tab — row-wise layout', () => {
  it('lays departments out one per row, not in a multi-column grid', async () => {
    const { container } = render(<DepartmentsTab />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Departments' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /show all departments/i }));
    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    const list = container.querySelector('[data-testid="department-rows"]');
    expect(list).not.toBeNull();
    // A single-column stack — no md:grid-cols-2 / xl:grid-cols-3 fan-out.
    expect(list?.className).not.toMatch(/grid-cols-2|grid-cols-3/);
  });

  it('shows each department with its code and its HODs', async () => {
    render(<DepartmentsTab />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Departments' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /show all departments/i }));

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());
    expect(screen.getByText('Housekeeping')).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('HK')).toBeInTheDocument();
  });
});
