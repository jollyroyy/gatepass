// An approval office holder's VMS role is `staff` (046), which is true but
// meaningless to the person reading it. ProfileDetails already prints the
// office title instead; the sidebar's own profile block printed "Staff".
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Sidebar from '../../src/components/layout/Sidebar';
import SidebarProfile from '../../src/components/layout/SidebarProfile';

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: () => Promise.resolve('Vikram Singh'),
  fetchMyProfile: () => Promise.resolve({ full_name: 'Vikram Singh', avatar_url: null }),
}));

function fakeSession(): Session {
  return { user: { id: 'u1', email: 'coo@demo.vms' } } as unknown as Session;
}

describe('SidebarProfile role line', () => {
  it('prints the approval office title, not the VMS role behind it', () => {
    render(
      <MemoryRouter>
        <SidebarProfile role="staff" office="coo" isCollapsed={false} profileName="Vikram Singh" initials="VS" />
      </MemoryRouter>,
    );
    expect(screen.getByText('COO')).toBeTruthy();
    expect(screen.queryByText('Staff')).toBeNull();
  });

  it('still prints the plain role when no office is held', () => {
    render(
      <MemoryRouter>
        <SidebarProfile role="guard" office={null} isCollapsed={false} profileName="Guard One" initials="G1" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Security')).toBeTruthy();
  });

  it('Sidebar passes the office through', () => {
    render(
      <MemoryRouter>
        <Sidebar session={fakeSession()} role="staff" isApprover office="coo" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('COO').length).toBeGreaterThan(0);
    expect(screen.queryByText('Staff')).toBeNull();
  });
});
