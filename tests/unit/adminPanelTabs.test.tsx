// The admin panel's tab strip.
//
// AI Analytics was removed at the client's request (2026-08-17) and
// `src/pages/Admin/AIAnalyticsTab.tsx` deleted with it. This pins the absence:
// the tab was a whole screen of speculative aggregates nobody asked to keep, and
// a stray re-import would put it back in front of the client without anyone
// noticing it had returned.
//
// The four surviving tabs are asserted by name and in order, so this also fails
// if a tab is quietly dropped rather than only if one is added.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/pages/Admin/DepartmentsTab', () => ({ default: () => <div>departments pane</div> }));
vi.mock('../../src/pages/Admin/UsersTab', () => ({ default: () => <div>users pane</div> }));
vi.mock('../../src/pages/Admin/FunctionalRolesTab', () => ({ default: () => <div>roles pane</div> }));
vi.mock('../../src/pages/Admin/BlacklistTab', () => ({ default: () => <div>blacklist pane</div> }));
vi.mock('../../src/pages/Admin/WhitelistRequestsTab', () => ({ default: () => <div>whitelist pane</div> }));
vi.mock('../../src/pages/Admin/MailSettingsCard', () => ({ default: () => <div>mail settings pane</div> }));
vi.mock('../../src/pages/Admin/CeoApproverCard', () => ({ default: () => <div>CEO approver</div> }));
vi.mock('../../src/lib/useMyProfile', () => ({
  useMyProfile: () => ({ profile: { role: 'admin' }, loading: false, error: null, saveName: vi.fn(), setAvatarUrl: vi.fn() }),
}));

import AdminPanel from '../../src/pages/Admin/AdminPanel';

describe('AdminPanel tabs', () => {
  // REWRITTEN 2026-08-20. It used to hold that the strip was exactly
  // Departments · Users · Blacklist · Whitelist Requests · Settings. The client
  // asked for Functional Roles "just beside the users and departments", so the
  // tab is asserted BY POSITION as well as by name — third, immediately after
  // the two it was asked to sit beside.
  it('offers exactly Departments, Users, Functional Roles, Blacklist, Whitelist Requests and Settings, in that order', () => {
    render(<AdminPanel />);
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Departments',
      'Users',
      'Functional Roles',
      'Blacklist',
      'Whitelist Requests',
      'Settings',
    ]);
  });

  it('opens the roles screen on that tab', () => {
    render(<AdminPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Functional Roles' }));
    expect(screen.getByText('roles pane')).toBeTruthy();
  });

  // Client, 2026-08-20: the inbox every approval letter is redirected to must
  // be editable by an admin rather than by a redeploy.
  it('opens the approval mail settings on the Settings tab', () => {
    render(<AdminPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('mail settings pane')).toBeInTheDocument();
  });

  // Client, 2026-08-20: the CEO office on the approval ladder decides whitelist
  // requests since 053, so `gatepass.ceo_approver` — a SECOND, super-admin-only
  // designation that no ladder CEO can ever be named in — had nothing left to
  // say except a false warning that no CEO was designated. The card is gone; a
  // whitelist request is approved by whoever holds the CEO office.
  it('carries no CEO-designation card on the Whitelist Requests tab', () => {
    render(<AdminPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Whitelist Requests' }));
    expect(screen.getByText('whitelist pane')).toBeInTheDocument();
    expect(screen.queryByText(/CEO approver/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No CEO approver is designated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Designate CEO approver/i)).not.toBeInTheDocument();
  });

  it('never offers an AI Analytics tab', () => {
    render(<AdminPanel />);
    expect(screen.queryByRole('button', { name: /analytics/i })).not.toBeInTheDocument();
    expect(screen.queryByText('AI Analytics')).not.toBeInTheDocument();
  });
});
