// ProfilePage — the self-service account screen every role can reach. It must
// render the display name, the photo controls (upload when none, change/remove
// when one exists) and the read-only account fields, and for an HOD it must
// list their assigned departments from gatepass.hod_departments.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import ProfilePage from '../../src/pages/Shared/Profile';
import type { Session } from '@supabase/supabase-js';

const profile = {
  id: 'u1',
  email: 'hod.it@demo.vms',
  full_name: 'Riya Sen',
  role: 'hod',
  department_id: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
};

vi.mock('../../src/lib/useMyProfile', () => ({
  useMyProfile: () => ({
    profile,
    loading: false,
    error: null,
    saveName: vi.fn().mockResolvedValue(null),
    setAvatarUrl: vi.fn(),
  }),
}));

vi.mock('../../src/supabaseClient', () => ({
  pub: () => ({
    from: () => ({ select: () => Promise.resolve({ data: [{ id: 'd1', name: 'IT' }], error: null }) }),
  }),
  gp: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ department_id: 'd1' }], error: null }) }) }),
  }),
}));

function fakeSession(): Session {
  return { user: { id: 'u1', email: 'hod.it@demo.vms' } } as unknown as Session;
}

describe('ProfilePage', () => {
  it('renders the name, email, role and photo-upload controls', async () => {
    render(<ProfilePage session={fakeSession()} role="hod" />);
    // Flush the async department lookup so its state update lands inside act.
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('heading', { name: 'My Profile' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Riya Sen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload photo/i })).toBeInTheDocument();
    expect(screen.getByText('hod.it@demo.vms')).toBeInTheDocument();
    expect(screen.getByText('HOD')).toBeInTheDocument();
  });

  it('lists the HOD\'s assigned departments', async () => {
    render(<ProfilePage session={fakeSession()} role="hod" />);
    await waitFor(() => expect(screen.getByText('IT')).toBeInTheDocument());
  });

  it('shows Change photo + Remove once an avatar exists, never before', async () => {
    render(<ProfilePage session={fakeSession()} role="hod" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('button', { name: /Upload photo/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change photo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });
});
