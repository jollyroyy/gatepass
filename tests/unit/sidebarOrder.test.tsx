// The sidebar's ORDER is ROLE_ROUTES' order.
//
// Client, 2026-08-18: "make the overdue item the second tab in the admin view.
// Keep the dashboard as the first tab." `/overdue` is ONE entry in ALL_LINKS
// shared by three roles, so it cannot sit in the right slot for all of them by
// position in that array — Sidebar sorts the role's links by the role's own
// route list instead, which is also where the landing page is defined.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../src/types';
import Sidebar from '../../src/components/layout/Sidebar';

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } },
}));
vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: () => Promise.resolve('A Person'),
  fetchMyProfile: () => Promise.resolve({ full_name: 'A Person', avatar_url: null }),
}));

function labels(role: UserRole): string[] {
  const { container, unmount } = render(
    <MemoryRouter>
      <Sidebar session={{ user: { id: 'u1', email: 'a@b.c' } } as unknown as Session} role={role} />
    </MemoryRouter>,
  );
  // The desktop rail is the last <aside>; the mobile drawer only exists once
  // opened, so a single render gives exactly one copy of the nav.
  const rail = container.querySelector('aside') as HTMLElement;
  const NAV = ['Dashboard', 'Overdue Items', 'Settings', 'Reports',
    'Search Pass', 'Pending OUT', 'Pending RGP Return', 'Raise Gate Pass', 'My Passes'];
  const out = [...rail.querySelectorAll('a')]
    .map((a) => a.textContent?.trim() ?? '')
    .filter((t) => NAV.includes(t));
  unmount();
  return out;
}

describe('sidebar order', () => {
  it('gives the admin Dashboard first and Overdue Items second', () => {
    expect(labels('admin').slice(0, 4)).toEqual([
      'Dashboard', 'Overdue Items', 'Settings', 'Reports',
    ]);
  });

  // REWRITTEN 2026-08-22. It used to hold that the guard's tabs were
  // Dashboard · Pending OUT · Pending RGP Return · Overdue Items. The client
  // took both list tabs away — the two lists open on the dashboard itself when
  // their KPI figure is pressed — so a guard has two tabs and the search sits
  // on the board beside Scan QR.
  it('gives the guard a Dashboard and Overdue Items, and no list tab of any kind', () => {
    expect(labels('guard')).toEqual(['Dashboard', 'Overdue Items']);
  });

  it('gives the HOD Dashboard, My Passes, Overdue Items and Reports — no Raise tab', () => {
    // Client, 2026-08-20: Raise Gate Pass left the sidebar; the dashboard's
    // Quick Action tile opens the same form. Reports was ADDED the same day —
    // the HOD's own copy of the admin's report screen, scoped to their own
    // department by RLS (see HodReports.tsx).
    expect(labels('hod')).toEqual(['Dashboard', 'My Passes', 'Overdue Items', 'Reports']);
  });
});
