// The forgot-password card must ask for the EMAIL ONLY — never the current
// password. The regression: the reset button used to live on the same form as
// the password field, so a user who had forgotten the password was asked for
// it anyway ("If I knew the password, why am I here?"). The card must also
// send the recovery to /reset-password, where the actual new-password form
// lives, not back to /login.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../src/pages/Login';

const { resetPasswordForEmail } = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail,
    },
  },
  gp: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
  pub: () => ({
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  resetPasswordForEmail.mockResolvedValue({ error: null });
  sessionStorage.clear();
});

describe('Forgot password flow', () => {
  it('asks for the email only — no password field on the forgot screen', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('sends the reset email for the typed address to /reset-password', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hod.it@demo.vms' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith(
        'hod.it@demo.vms',
        expect.objectContaining({
          redirectTo: expect.stringMatching(/\/reset-password$/),
        })
      )
    );
  });

  it('shows a confirmation once the email is on its way', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hod.it@demo.vms' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('surfaces the Supabase error and stays on the forgot form', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { message: 'Rate limit exceeded' } });
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hod.it@demo.vms' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Rate limit exceeded')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('lets the user escape back to the full sign-in form', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows a countdown and refuses a second send within the cooldown window', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hod.it@demo.vms' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await screen.findByText(/check your inbox/i);

    // Leave the forgot card and come back — the cooldown must survive the
    // unmount (it lives in sessionStorage, not component state), or a user who
    // clicks away and back can hammer the email quota again.
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    expect(screen.getByText(/send another/i)).toBeInTheDocument();
    const sendBtn = screen.getByRole('button', { name: /send reset link/i });
    expect(sendBtn).toBeDisabled();
    fireEvent.click(sendBtn);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh send once the cooldown window has elapsed', () => {
    sessionStorage.setItem('gatepass.forgot-cooldown-until', String(Date.now() - 5_000));
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    expect(screen.queryByText(/send another/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeEnabled();
  });
});