// AN HOD CAN FORWARD A PASS TO THE VENDOR ON WHATSAPP (client, 2026-08-22),
// FROM THE PASS DETAILS PAGE — AND IT OPENS THE VENDOR'S OWN CHAT DIRECTLY
// (client, 2026-09-01: "I don't have to select the WhatsApp manually … put it
// back and include the same text only, just include quest mall and department
// details").
//
// THE SLIP IMAGE IS GONE, and this spec is the record of why: attaching a file
// is only possible through the device share sheet, which makes the sender pick
// the app AND the chat by hand. A `wa.me` link is the ONLY thing that opens one
// known number's chat in one press, and it carries text alone. The client chose
// the direct chat over the picture, so what is testable is the number, the text
// and who is offered the button:
//
//   * a vendor with no number gets no button at all ("if it is available");
//   * a bare 10-digit mobile is given the country code, because `wa.me`
//     refuses a number without one, and anything too short is refused rather
//     than guessed at — a wrong number is a stranger's chat;
//   * the text names the MALL and the DEPARTMENT it comes from, and every
//     item's make and model;
//   * the message carries no portal link: a vendor has no account here.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';
import {
  passShareMessage, vendorWhatsappLink, vendorWhatsappNumber, whatsappHref,
} from '../../src/lib/whatsappShare';

let row: GatePassView;
let items: unknown[] = [];

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0003', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix Solutions","a":"B-108","v":"98765 43210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24',
    actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T06:15:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2099-08-19T18:30:00Z',
    created_at: '2026-08-18T05:00:00Z', updated_at: '2026-08-18T06:15:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 8, returned_quantity: 0, total_value: 5000,
    material_summary: 'Headsets',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Headset',
    description: 'Sony', make_model: 'Sony WH-1000XM4', serial_no: null, quantity: 8, unit: 'nos',
    returned_qty: 0, returned_at: null, approx_value: 5000,
    expected_return_date: '2026-08-24', outstanding_qty: 8,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: row, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_gate_pass_items' ? items : [], error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u9' } } }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

async function renderAs(role: 'guard' | 'hod' | 'admin') {
  render(
    <MemoryRouter initialEntries={['/pass/p1']}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail role={role} />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
}

beforeEach(() => {
  row = pass();
  items = [line()];
});

describe('the vendor number', () => {
  it('gives a bare Indian mobile its country code, ignoring how it was typed', () => {
    expect(vendorWhatsappNumber(pass())).toBe('919876543210');
    expect(vendorWhatsappNumber(pass({
      visitor_company: '{"n":"X","a":"","v":"+91-98765-43210"}',
    }))).toBe('919876543210');
  });

  it('leaves a number that already carries a code alone', () => {
    expect(vendorWhatsappNumber(pass({
      visitor_company: '{"n":"X","a":"","v":"+971 50 123 4567"}',
    }))).toBe('971501234567');
  });

  it('refuses anything too short to be a mobile, rather than guessing', () => {
    expect(vendorWhatsappNumber(pass({ visitor_company: '{"n":"X","a":"","v":"12345"}' }))).toBeNull();
    expect(vendorWhatsappNumber(pass({ visitor_company: '{"n":"X","a":"","v":""}' }))).toBeNull();
    expect(vendorWhatsappNumber(pass({ visitor_company: 'TechFix Solutions' }))).toBeNull();
    expect(vendorWhatsappNumber(pass({ visitor_company: null }))).toBeNull();
  });
});

describe('the message', () => {
  it('carries the mall, the pass, the vendor and the material — and NO portal link', () => {
    const text = passShareMessage(pass(), [line()]);
    // THE MALL IS NAMED FIRST (client, 2026-09-01: "just include quest mall
    // and department details"). A vendor works for several sites and a bare
    // pass number does not say whose gate it is for.
    expect(text.split('\n')[0]).toBe('Quest Mall — RGP Gate Pass RGP-20260818-0003');
    expect(text).toContain('Department: Engineering (MEP) (ENG)');
    expect(text).toContain('Vendor: TechFix Solutions');
    expect(text).toContain('Carried by: Ravi Kumar');
    expect(text).toContain('Vehicle: KA01AB1234');
    expect(text).toContain('Purpose: Equipment repair');
    // MAKE / MODEL RIDES WITH THE NAME (client, 2026-09-01) — "Headset" does
    // not tell the vendor or the guard which headset is leaving the mall.
    expect(text).toContain('1. Headset (Sony WH-1000XM4) — 8');
    expect(text).not.toContain('http');
    expect(text).not.toContain('/pass/');
  });

  it('states the return date on an RGP and never on an NRGP', () => {
    expect(passShareMessage(pass())).toContain('Expected return:');
    expect(passShareMessage(pass({ type: 'NRGP', return_status: 'not_applicable' })))
      .not.toContain('Expected return:');
  });

  it('escapes the whole message into the link', () => {
    const href = whatsappHref('919876543210', 'a b\n& c');
    expect(href).toBe('https://wa.me/919876543210?text=a%20b%0A%26%20c');
  });

  it('has no link at all when the pass carries no usable number', () => {
    expect(vendorWhatsappLink(pass({ visitor_company: '{"n":"X","a":"","v":""}' }))).toBeNull();
  });
});

describe('the button on the pass record', () => {
  it("is offered to the HOD, and links straight into the vendor's chat", async () => {
    await renderAs('hod');
    const link = screen.getByTestId('share-whatsapp');
    expect(link).toHaveTextContent('Send to Vendor');

    // A PLAIN LINK, NOT A SHARE SHEET. One press lands in the one chat that
    // number belongs to, with the message already typed — no app picker, no
    // contact list, nothing for the HOD to choose.
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    const text = decodeURIComponent(href.split('?text=')[1]);
    expect(text).toContain('Quest Mall — RGP Gate Pass');
    expect(text).toContain('Department: Engineering (MEP) (ENG)');
    expect(text).toContain('Sony WH-1000XM4');
  });

  it('is not drawn when the pass carries no vendor number', async () => {
    row = pass({ visitor_company: '{"n":"TechFix","a":"B-108","v":""}' });
    await renderAs('hod');
    expect(screen.queryByTestId('share-whatsapp')).not.toBeInTheDocument();
  });

  it('is the raising side’s control, not the gate’s', async () => {
    await renderAs('guard');
    expect(screen.queryByTestId('share-whatsapp')).not.toBeInTheDocument();
  });
});
