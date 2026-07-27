// AppShell renders the chrome around every page: sidebar slot, top strip,
// content, footer.
//
// It used to ALSO resolve and display the signed-in user's name and role in the
// top-right. That was removed deliberately — SidebarProfile already shows both
// in the bottom-left, and showing them twice on one screen is noise. These specs
// pin the removal, because "render the name" is exactly the kind of thing that
// gets helpfully added back by someone who has not seen the sidebar.
//
// The original point of this file still holds and is still covered below: a
// broken profile lookup (VMS's recursive public.profiles policy, SQLSTATE 42P17)
// must never take the shell down. That is now true by construction, because the
// shell no longer performs a profile lookup at all.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import AppShell from '../../src/components/layout/AppShell';
import { fetchDisplayName } from '../../src/lib/profiles';

vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: vi.fn(),
}));

// The real Sidebar opens realtime subscriptions (postgres_changes) — not
// something a render test should exercise. Stub it out entirely.
vi.mock('../../src/components/layout/Sidebar', () => ({
  default: () => <nav data-testid="sidebar-stub" />,
}));

function fakeSession(email: string): Session {
  return { user: { id: 'user-1', email } } as unknown as Session;
}

const mockedFetchDisplayName = vi.mocked(fetchDisplayName);

beforeEach(() => {
  mockedFetchDisplayName.mockReset();
  mockedFetchDisplayName.mockResolvedValue('Sudeshna Pal');
});

describe('AppShell', () => {
  it('renders children inside the main content area', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>Unique Child Marker</div>
      </AppShell>
    );
    expect(screen.getByText('Unique Child Marker')).toBeInTheDocument();
  });

  it('renders the sidebar slot', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>content</div>
      </AppShell>
    );
    expect(screen.getByTestId('sidebar-stub')).toBeInTheDocument();
  });

  it('does NOT render the display name — that belongs to SidebarProfile', async () => {
    render(
      <AppShell session={fakeSession('sudeshna.pal@x.com')} role="hod">
        <div>Dashboard content</div>
      </AppShell>
    );
    // Give any stray effect a chance to resolve and paint before asserting absence.
    await waitFor(() => expect(screen.getByText('Dashboard content')).toBeInTheDocument());
    expect(screen.queryByText('Sudeshna Pal')).not.toBeInTheDocument();
  });

  it('does NOT render the role label in the top strip', async () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="guard">
        <div>Console content</div>
      </AppShell>
    );
    await waitFor(() => expect(screen.getByText('Console content')).toBeInTheDocument());
    // ROLE_LABELS.guard === 'Security' (src/components/layout/SidebarProfile.tsx)
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('never performs a profile lookup — the shell has no identity to resolve', async () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>content</div>
      </AppShell>
    );
    await waitFor(() => expect(screen.getByText('content')).toBeInTheDocument());
    // Not merely "does not display it" — the request is not made. A lookup left
    // in place would keep the 42P17 blast radius open for no rendered benefit.
    expect(mockedFetchDisplayName).not.toHaveBeenCalled();
  });

  it('renders regardless of role, including null while the role is still resolving', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role={null}>
        <div>Still loading role</div>
      </AppShell>
    );
    expect(screen.getByText('Still loading role')).toBeInTheDocument();
  });
});
