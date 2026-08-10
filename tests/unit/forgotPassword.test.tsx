// Password reset is NOT self-service in this app (user's call, 2026-08-10).
// The old "Forgot password?" link opened an email-only card that sent a Supabase
// recovery mail — that whole flow is gone, because the built-in email sender is
// capped at ~2 messages/hour PROJECT-WIDE (shared with VMS), so the link failed
// for most people who clicked it and left them with no next step. The login card
// now points at a human instead: contact the administrator.
//
// These tests pin BOTH halves — the link must not come back, and the admin's
// address must actually be on the page and clickable.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login, { ADMIN_CONTACT_EMAIL } from '../../src/pages/Login';

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  gp: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
  pub: () => ({
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );

describe('Password reset is admin-assisted, not self-service', () => {
  it('has no "Forgot password?" control at all', () => {
    renderLogin();
    expect(screen.queryByRole('button', { name: /forgot password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument();
  });

  it('tells the user to contact the administrator, and names the address', () => {
    renderLogin();
    expect(screen.getByText(/contact the administrator/i)).toBeInTheDocument();
    expect(screen.getByText(ADMIN_CONTACT_EMAIL)).toBeInTheDocument();
  });

  it('makes the admin address a mailto link so it can be actioned in one tap', () => {
    renderLogin();
    const link = screen.getByRole('link', { name: ADMIN_CONTACT_EMAIL });
    expect(link).toHaveAttribute('href', `mailto:${ADMIN_CONTACT_EMAIL}`);
  });

  it('still renders the sign-in form itself', () => {
    renderLogin();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
