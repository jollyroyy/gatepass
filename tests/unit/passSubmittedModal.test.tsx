// PassSubmittedModal (src/pages/HOD/PassSubmittedModal.tsx) — the popup shown
// right after an HOD raises a pass. Redesigned 2026-08-10 for scannability:
// pass number / type / direction / status / vehicle must all be visible at a
// glance, and it must close like every other popup.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PassSubmittedModal from '../../src/pages/HOD/PassSubmittedModal';
import type { GatePassView } from '../../src/types';

// THE POPUP REACHES THE DATABASE NOW, through Send to Vendor: the button reads
// what the printed slip is made of so it can photograph it. Nothing in this
// spec presses it — but the import alone would build a real Supabase client
// and demand VITE_SUPABASE_URL, which turns a missing local `.env` into a
// failing unit test. The reads are stubbed to nothing, which is exactly the
// "no items yet" shape, and the button still renders on the pass it is handed.
vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(ok, err);
  return {
    gp: () => ({ from: () => builder, rpc: () => Promise.resolve({ data: [], error: null }) }),
    pub: () => ({ from: () => builder }),
    supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
  };
});

const PASS = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260810-0007',
  type: 'RGP',
  direction: 'out',
  status: 'pending',
  visitor_name: 'Ravi Kumar',
  visitor_company: JSON.stringify({ n: 'Bharat Steel Co', a: '12 MG Road', v: '9800000000' }),
  vehicle_number: 'WB01AB1234',
  total_quantity: 5,
  created_at: '2026-08-10T09:15:00Z',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as GatePassView;

function renderModal(onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <PassSubmittedModal submittedPass={PASS} deptName="Engineering (ENG)" itemCount={3} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('PassSubmittedModal — at-a-glance fields', () => {
  it('shows the pass number, type, direction, status and vehicle number', () => {
    renderModal();
    expect(screen.getByText('RGP-OUT-20260810-0007')).toBeInTheDocument();
    expect(screen.getByText('RGP')).toBeInTheDocument();
    expect(screen.getByText('OUT')).toBeInTheDocument();
    expect(screen.getByText('Pending Gate Review')).toBeInTheDocument();
    expect(screen.getByText('WB01AB1234')).toBeInTheDocument();
  });

  it('groups vendor, department and material into labelled blocks', () => {
    renderModal();
    expect(screen.getByText('Vehicle & Department')).toBeInTheDocument();
    expect(screen.getByText('Vendor & Authorized Person')).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
    expect(screen.getByText('Engineering (ENG)')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Bharat Steel Co')).toBeInTheDocument();
  });

  it('renders an em dash for a missing vehicle number instead of a blank', () => {
    render(
      <MemoryRouter>
        <PassSubmittedModal
          submittedPass={{ ...PASS, vehicle_number: null } as GatePassView}
          deptName="Engineering (ENG)"
          itemCount={1}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('PassSubmittedModal — close behaviour', () => {
  it('closes on the × button', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on a click inside the modal', () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByText('RGP-OUT-20260810-0007'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// FORWARDING THE PASS THE MOMENT IT IS RAISED (client, 2026-08-22: "the hod,
// after raising the pass, should have the option to send the pass … have an
// option to send the pass using WhatsApp to the vendor's WhatsApp number").
//
// It is a BUTTON now, not a link (client, 2026-09-01): what goes to the vendor
// is the printed slip itself, photographed off `PassSlip` and handed to the
// device's share sheet, because a `wa.me` href cannot carry an attachment and
// a QR code cannot be typed into a chat. Pressing it is exercised in
// tests/unit/whatsappShare.test.tsx, where the share sheet is stubbed; here
// what matters is only that the raising HOD is offered it, and only when the
// pass carries a vendor number.
describe('PassSubmittedModal — sending it on', () => {
  it('offers Send to Vendor on a pass that carries a vendor number', () => {
    renderModal();
    // Nothing is sent by this app: the share sheet opens with the slip and the
    // text prepared, and the HOD presses send in their own WhatsApp.
    const button = screen.getByRole('button', { name: /Send to Vendor/ });
    expect(button).toBeEnabled();
  });

  it('draws no button when the pass carries no vendor number', () => {
    render(
      <MemoryRouter>
        <PassSubmittedModal
          submittedPass={{ ...PASS, visitor_company: JSON.stringify({ n: 'Bharat Steel Co' }) }}
          deptName="Engineering (ENG)"
          itemCount={3}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    // "If it is available" is the client's own condition, and a control that
    // opens an empty chat is worse than no control.
    expect(screen.queryByRole('button', { name: /Send to Vendor/ })).toBeNull();
  });

  it('offers the printed sheet too — the boxes are what the vendor is sent', () => {
    renderModal();
    const print = screen.getByRole('link', { name: 'Print Pass' }) as HTMLAnchorElement;
    expect(print.getAttribute('href')).toBe('/pass/p1/print');
  });
});
