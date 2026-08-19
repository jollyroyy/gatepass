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
  const NAV = ['Dashboard', 'Overdue Items', 'Departments & Users', 'Reports',
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
      'Dashboard', 'Overdue Items', 'Departments & Users', 'Reports',
    ]);
  });

  it('gives the guard Pending OUT and Pending RGP Return in place of Search Pass', () => {
    // Client, 2026-08-19: the dashboard's two figures now drill into their own
    // pages, so Search Pass left the sidebar — the search itself moved to the
    // top right of those two pages, not away from the guard.
    expect(labels('guard')).toEqual(['Dashboard', 'Pending OUT', 'Pending RGP Return', 'Overdue Items']);
  });

  it('leaves the HOD order as it was', () => {
    expect(labels('hod')).toEqual(['Dashboard', 'Raise Gate Pass', 'My Passes', 'Overdue Items']);
  });
});
