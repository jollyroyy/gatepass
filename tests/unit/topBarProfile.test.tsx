// The identity chip at the top right, and the one corner log out is allowed to
// live in (client, 2026-08-19).
//
// Three things are asserted, and the third is the one that matters most: the
// chip must NOT be able to end a session. Sign out moved to the bottom left of
// the sidebar and stayed there alone, so a guard reaching for "who am I signed
// in as" cannot land on the control that sends them back to the login screen.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

const signOut = vi.fn();

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut: () => signOut() } },
  gp: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: vi.fn().mockResolvedValue('Ravi Kumar'),
  fetchMyProfile: vi.fn().mockResolvedValue({ avatar_url: null }),
}));

import TopBarProfile from '../../src/components/layout/TopBarProfile';
import SidebarSignOut from '../../src/components/layout/SidebarSignOut';

function fakeSession(): Session {
  return { user: { id: 'u1', email: 'ravi@quest.com' } } as unknown as Session;
}

function drawChip(role: 'guard' | 'hod' | 'admin') {
  return render(
    <MemoryRouter>
      <TopBarProfile session={fakeSession()} role={role} />
    </MemoryRouter>,
  );
}

beforeEach(() => signOut.mockReset());

describe('TopBarProfile — who is signed in, top right', () => {
  it.each(['guard', 'hod', 'admin'] as const)('names the signed-in %s and their role', async (role) => {
    drawChip(role);
    await waitFor(() => expect(screen.getAllByText('Ravi Kumar').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Your account/i })).toBeTruthy();
  });

  it('falls back to initials when there is no photo', async () => {
    drawChip('guard');
    await waitFor(() => expect(screen.getAllByText('Ravi Kumar').length).toBeGreaterThan(0));
    expect(screen.getByText('RK')).toBeTruthy();
  });

  it('opens a menu with the profile and the photo edit, both landing on /profile', async () => {
    drawChip('hod');
    fireEvent.click(screen.getByRole('button', { name: /Your account/i }));

    const mine = await screen.findByRole('menuitem', { name: /My profile/i });
    const edit = screen.getByRole('menuitem', { name: /Edit profile/i });
    expect(mine.getAttribute('href')).toBe('/profile');
    expect(edit.getAttribute('href')).toBe('/profile');
  });

  it('offers NO way to sign out — that control is the sidebar’s alone', async () => {
    drawChip('guard');
    fireEvent.click(screen.getByRole('button', { name: /Your account/i }));
    await screen.findByRole('menuitem', { name: /My profile/i });

    expect(screen.queryByText(/log out/i)).toBeNull();
    expect(screen.queryByText(/sign out/i)).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('SidebarSignOut — the bottom left, and the only log out', () => {
  it('signs the session out when pressed', () => {
    render(<SidebarSignOut isCollapsed={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Log out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('keeps its label when the sidebar is collapsed, for a screen reader', () => {
    render(<SidebarSignOut isCollapsed />);
    expect(screen.getByRole('button', { name: /Log out/i })).toBeTruthy();
  });

  it('carries no avatar and no name — the identity chip moved to the top right', () => {
    const { container } = render(<SidebarSignOut isCollapsed={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(/profile/i)).toBeNull();
  });
});
