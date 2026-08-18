// The 2026-08-10 client complaint, verbatim: "I see that you have cluttered
// all information together... I do see the vendor name you have mentioned in
// the body and also on the top." The header used to repeat vendor / visitor /
// material / vehicle / department that the (already-expanded) body also
// showed. This pins the fix: every fact appears EXACTLY ONCE, the header is
// identity + status only, the drill list is a full-width vertical stack (not
// a 2-up grid), and the four fields the client asked to be emphasised
// (vendor, raised by, expected return — RGP only) render without duplicating
// anything.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return {
    gp: () => ({ from: () => builder, rpc: () => builder }),
    pub: () => ({ from: () => builder }),
    supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
  };
});

import GuardDrillCard from '../../src/pages/Security/GuardDrillCard';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260810-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: JSON.stringify({ n: 'Bosch Services Co', a: '', v: '' }),
    vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: '2026-09-01', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 2, total_quantity: 3, returned_quantity: 0,
    material_summary: 'Drill, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function renderCard(over: Partial<GatePassView> = {}) {
  return render(
    <MemoryRouter>
      <GuardDrillCard pass={pass(over)} />
    </MemoryRouter>,
  );
}

describe('GuardDrillCard — de-duplication (client complaint 2026-08-10)', () => {
  it('renders the vendor company exactly once on the whole card', () => {
    renderCard();
    expect(screen.getAllByText('Bosch Services Co')).toHaveLength(1);
  });

  it('renders the vehicle number exactly once', () => {
    renderCard();
    expect(screen.getAllByText('WB01AB1234')).toHaveLength(1);
  });

  it('renders the department name exactly once', () => {
    renderCard();
    expect(screen.getAllByText('Engineering')).toHaveLength(1);
  });

  it('the identity header carries only the pass number, type chip and status — no vendor, visitor, material, vehicle or department', () => {
    const { container } = renderCard();
    const header = container.querySelector('[data-testid="pass-card-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('RGP-OUT-20260810-0001');
    expect(header.textContent).not.toContain('Bosch Services Co');
    expect(header.textContent).not.toContain('Ravi');
    expect(header.textContent).not.toContain('WB01AB1234');
    expect(header.textContent).not.toContain('Engineering');
    expect(header.textContent).not.toContain('Drill, Ladder');
  });
});

describe('GuardDrillCard — the four emphasised fields', () => {
  it('shows vendor, who raised it, and (RGP) the expected return date', () => {
    renderCard();
    expect(screen.getByText('Bosch Services Co')).toBeInTheDocument();
    expect(screen.getByText('HOD One')).toBeInTheDocument();
    expect(screen.getByText(/Expected Return/i)).toBeInTheDocument();
  });

  it('renders NO expected-return-date field at all for an NRGP pass', () => {
    renderCard({ type: 'NRGP', direction: 'out', expected_return_date: null });
    expect(screen.queryByText(/Expected Return/i)).not.toBeInTheDocument();
  });
});

describe('GuardDrillCard — the footer after returns moved off the board', () => {
  // Awaiting Return and Overdue stopped being in-place drills on 2026-08-18:
  // returns are recorded on /returns and /overdue, line by line. Nothing on a
  // drill card records one any more.
  it('offers no return control at all', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /record returns/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return all/i })).not.toBeInTheDocument();
  });

  // The Pending Queue left Search Pass the same day, so this card is where a
  // guard picks a waiting pass off a list — it must still reach the gate screen.
  it('links a still-clearable pass straight to the verify screen', () => {
    renderCard({ status: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString() });
    expect(screen.getByRole('link', { name: /verify at gate/i })).toHaveAttribute('href', '/verify/x');
  });

  it('offers no Verify at Gate on a pass the gate can no longer clear', () => {
    renderCard({ status: 'matched' });
    expect(screen.queryByRole('link', { name: /verify at gate/i })).not.toBeInTheDocument();
  });
});
