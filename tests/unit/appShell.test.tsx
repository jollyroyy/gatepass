import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import AppShell from '../../src/components/layout/AppShell';
import { fetchDisplayName } from '../../src/lib/profiles';

vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: vi.fn(),
}));

vi.mock('../../src/components/layout/Sidebar', () => ({
  default: () => <nav data-testid="sidebar-stub" />,
}));

vi.mock('../../src/components/layout/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell-stub" />,
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

  it('renders the notification bell', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>content</div>
      </AppShell>
    );
    expect(screen.getByTestId('notification-bell-stub')).toBeInTheDocument();
  });

  it('does NOT render the display name — that belongs to SidebarProfile', async () => {
    render(
      <AppShell session={fakeSession('sudeshna.pal@x.com')} role="hod">
        <div>Dashboard content</div>
      </AppShell>
    );
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
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('never performs a profile lookup — the shell has no identity to resolve', async () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>content</div>
      </AppShell>
    );
    await waitFor(() => expect(screen.getByText('content')).toBeInTheDocument());
    expect(mockedFetchDisplayName).not.toHaveBeenCalled();
  });

  // THE SKIN IS EVERY ROLE'S, ON EVERY TAB (client, 2026-08-19: "admin and HOD
  // do not have the same typography as the guard … keep the type and the box,
  // everything exactly the same as the guard's typography, colour"). It was the
  // guard's alone until then, and the four cases that pinned the other roles to
  // the house theme are REWRITTEN into the one below rather than deleted, so
  // this file still says what changed and why. It is put on <main> rather than
  // on each page, which is the only thing that makes My Passes, Reports, the
  // Admin panel and the pass record read the same without knowing about it.
  it.each(['guard', 'hod', 'admin', 'super_admin', null] as const)(
    'skins <main> with .gb-main for %s',
    (role) => {
      const { container } = render(
        <AppShell session={fakeSession('someone@x.com')} role={role}>
          <div>content</div>
        </AppShell>
      );
      expect(container.querySelector('main')?.className).toContain('gb-main');
    },
  );

  it('renders regardless of role, including null while the role is still resolving', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role={null}>
        <div>Still loading role</div>
      </AppShell>
    );
    expect(screen.getByText('Still loading role')).toBeInTheDocument();
  });
});
