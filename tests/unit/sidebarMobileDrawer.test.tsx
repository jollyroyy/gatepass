// Sidebar's mobile drawer (src/components/layout/Sidebar.tsx) is a fixed
// full-screen overlay with a backdrop. It already closed on a backdrop click;
// this pins the added × button and Escape support.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import Sidebar from '../../src/components/layout/Sidebar';

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: () => Promise.resolve('Guard One'),
  fetchMyProfile: () => Promise.resolve({ full_name: 'Guard One', avatar_url: null }),
}));

function fakeSession(): Session {
  return { user: { id: 'u1', email: 'guard@demo.vms' } } as unknown as Session;
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar session={fakeSession()} role="guard" />
    </MemoryRouter>,
  );
}

describe('Sidebar mobile drawer', () => {
  it('opens on the hamburger and has a working × close button', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    // The drawer renders the nav a second time — assert via the drawer's own close button.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons.length).toBeGreaterThan(0);

    fireEvent.click(closeButtons[0]);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('still closes on a backdrop click (pre-existing behaviour, kept)', () => {
    const { container } = renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);

    const backdrop = container.querySelector('.bg-black\\/40') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});
