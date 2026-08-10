// Admin-driven password reset, added inside the Edit User modal (replacement for
// the "Forgot password?" self-service link removed from the login page). The RPC
// (`admin_reset_user_password`, migration 036, already applied — no SQL here) sets
// the password immediately, forces a change on next sign-in, and kills existing
// sessions server-side; this component only needs to call it and present the
// result. Three behaviours matter most:
//   * it must be a deliberate two-step action — the form is hidden until the
//     admin opts in, so a stray click cannot reset someone's password;
//   * a password under 6 characters must never reach the RPC;
//   * on success the password is shown back to the admin (once) with a copy
//     button, because the admin is the only channel for telling the user what
//     it now is.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
}));

import ResetPasswordSection from '../../src/pages/Admin/ResetPasswordSection';

const PROFILE = { id: 'u1', email: 'guard@demo.vms', full_name: 'G Guard' };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { id: 'u1', email: 'guard@demo.vms', must_change_password: true },
    error: null,
  });
});

describe('ResetPasswordSection', () => {
  it('does not show the password form until the admin opts in', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
  });

  it('reveals the form when the reset affordance is clicked', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('refuses a password under 6 characters without calling the RPC', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /^set new password$/i }));

    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls admin_reset_user_password with exactly the user id and password', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^set new password$/i }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_reset_user_password', {
        p_user_id: 'u1',
        p_password: 'brand-new-pass',
      }),
    );
  });

  it('the Generate button fills in a password of at least 6 characters', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    const input = screen.getByLabelText('New password') as HTMLInputElement;
    expect(input.value.length).toBeGreaterThanOrEqual(6);
  });

  it('shows the new password back to the admin on success, with a copy note', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^set new password$/i }));

    await waitFor(() => expect(screen.getByText('brand-new-pass')).toBeInTheDocument());
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    // The form itself is gone once the result is shown.
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('surfaces an RPC error and keeps the form open', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Admin passwords cannot be reset from the panel. Use the Supabase dashboard.' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /^set new password$/i }));

    expect(await screen.findByText(/use the supabase dashboard/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  // Math.random() is NOT a cryptographic source: V8 seeds it from a value an
  // attacker can often recover, and successive outputs are predictable from one
  // another. A password generated with it is guessable, and this one is handed
  // to a real person as their live credential. It must come from the CSPRNG.
  it('generates the suggested password from crypto.getRandomValues, never Math.random', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const mathRandom = vi.spyOn(Math, 'random');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    expect(getRandomValues).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();

    const value = (screen.getByLabelText('New password') as HTMLInputElement).value;
    expect(value.length).toBeGreaterThanOrEqual(14);
    getRandomValues.mockRestore();
    mathRandom.mockRestore();
  });

  it('generates a different password each time it is asked', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ResetPasswordSection profile={PROFILE as any} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    const field = () => (screen.getByLabelText('New password') as HTMLInputElement).value;

    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /generate/i }));
      seen.add(field());
    }
    expect(seen.size).toBe(5);
  });
});
