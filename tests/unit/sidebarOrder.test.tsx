// The sidebar's ORDER is ROLE_ROUTES' order.
//
// It was `/overdue` that made the point, from 2026-08-18 until the client took
// the tab off entirely on 2026-08-23: ONE entry in ALL_LINKS shared by three
// roles cannot sit in the right slot for all of them by position in that array,
// so Sidebar sorts the role's links by the role's own route list instead, which
// is also where the landing page is defined. The ordering rule is unchanged and
// is what these three cases pin; Overdue Items is simply no longer one of the
// labels any role gets.
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
  it('gives the admin Dashboard first, then Settings and Reports', () => {
    expect(labels('admin').slice(0, 3)).toEqual([
      'Dashboard', 'Settings', 'Reports',
    ]);
  });

  // REWRITTEN 2026-08-22. It used to hold that the guard's tabs were
  // Dashboard · Pending OUT · Pending RGP Return · Overdue Items. The client
  // took both list tabs away — the two lists open on the dashboard itself when
  // their KPI figure is pressed — so a guard has two tabs and the search sits
  // on the board beside Scan QR.
  // REWRITTEN AGAIN 2026-08-23: Overdue Items came off every sidebar ("remove
  // ... the tab name from the left-hand side panel"). The guard still reaches
  // `/overdue` from the Overdue Returns quick action on the board.
  it('gives the guard a Dashboard and nothing else', () => {
    expect(labels('guard')).toEqual(['Dashboard']);
  });

  it('gives the HOD Dashboard and Reports — no Raise, My Passes or Overdue tab', () => {
    // Client, 2026-08-20: Raise Gate Pass left the sidebar; the dashboard's
    // Quick Action tile opens the same form. Reports was ADDED the same day —
    // the HOD's own copy of the admin's report screen, scoped to their own
    // department by RLS (see HodReports.tsx).
    expect(labels('hod')).toEqual(['Dashboard', 'Reports']);
  });
});
