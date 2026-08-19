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

// The identity chip resolves its own name, photo and route context (it uses
// useLocation and Link). Stubbed here for the same reason the sidebar is: this
// file is about what the SHELL puts on screen, not about what the chip does.
vi.mock('../../src/components/layout/TopBarProfile', () => ({
  default: () => <div data-testid="topbar-profile-stub" />,
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

  // WHO IS SIGNED IN SITS TOP RIGHT, on every role's shell (client,
  // 2026-08-19: "put all the users' profile picture on the top right corner ...
  // for admin profile picture as well as HOD profile picture"). It is the
  // shell's job because it must be true of every page without any page saying
  // so — the same argument that puts `.gb-main` here.
  it.each(['guard', 'hod', 'admin', 'super_admin'] as const)(
    'puts the identity chip at the top right for %s',
    (role) => {
      render(
        <AppShell session={fakeSession('someone@x.com')} role={role}>
          <div>content</div>
        </AppShell>
      );
      expect(screen.getByTestId('topbar-profile-stub')).toBeInTheDocument();
    }
  );

  // Log out stayed at the bottom left of the sidebar, and ONLY there (client,
  // 2026-08-19). The sidebar is stubbed in this file, so the assertion is that
  // the shell itself puts no sign-out control on screen.
  it('carries no log out control of its own — that corner is the sidebar', () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="guard">
        <div>content</div>
      </AppShell>
    );
    expect(screen.queryByRole('button', { name: /log out|sign out/i })).not.toBeInTheDocument();
  });

  it('never performs a profile lookup ITSELF — the chip resolves its own name', async () => {
    render(
      <AppShell session={fakeSession('someone@x.com')} role="hod">
        <div>content</div>
      </AppShell>
    );
    await waitFor(() => expect(screen.getByText('content')).toBeInTheDocument());
    expect(mockedFetchDisplayName).not.toHaveBeenCalled();
  });

  // The guard's shell is the mock-up's fixed-light skin, on EVERY tab (client,
  // 2026-08-19). It is put on <main> here rather than on each page, which is
  // the only thing that makes Verify, Search Pass, Overdue Items and the gate
  // pass record read the same as the dashboard without knowing about it.
  it('skins <main> with .gb-main for a guard', () => {
    const { container } = render(
      <AppShell session={fakeSession('guard@x.com')} role="guard">
        <div>content</div>
      </AppShell>
    );
    const main = container.querySelector('main');
    expect(main?.className).toContain('gb-main');
  });

  it.each(['hod', 'admin', 'super_admin', null] as const)(
    'leaves <main> on the house theme for %s',
    (role) => {
      const { container } = render(
        <AppShell session={fakeSession('someone@x.com')} role={role}>
          <div>content</div>
        </AppShell>
      );
      expect(container.querySelector('main')?.className).not.toContain('gb-main');
    }
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
