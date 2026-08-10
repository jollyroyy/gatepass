// ForcePasswordChange — the screen an admin-reset password lands a user in.
// set_my_password is the ONLY thing that clears must_change_password server
// side (migration 036), so this component must never drop the gate on its
// own say-so: success re-reads my_profile() and only then calls onCleared.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForcePasswordChange from '../../src/pages/ForcePasswordChange';

const { rpc, signOut, fetchMustChangePassword } = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(),
  fetchMustChangePassword: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut } },
  gp: () => ({ rpc }),
}));

vi.mock('../../src/lib/profiles', () => ({ fetchMustChangePassword }));

function fillAndSubmit(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
}

beforeEach(() => {
  rpc.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
  fetchMustChangePassword.mockReset();
  // Default: set_my_password succeeds, and the re-read confirms the flag is
  // down — most tests want this happy path unless they override it.
  rpc.mockImplementation((name: string) => {
    if (name === 'set_my_password') return Promise.resolve({ error: null });
    return Promise.resolve({ data: null, error: null });
  });
  fetchMustChangePassword.mockResolvedValue(false);
});

describe('ForcePasswordChange', () => {
  it('explains why the user is here', () => {
    render(<ForcePasswordChange onCleared={vi.fn()} />);
    expect(screen.getByText(/administrator reset your password/i)).toBeInTheDocument();
  });

  it('refuses a short password before calling the RPC', () => {
    render(<ForcePasswordChange onCleared={vi.fn()} />);
    fillAndSubmit('abc12', 'abc12');
    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses mismatched passwords before calling the RPC', () => {
    render(<ForcePasswordChange onCleared={vi.fn()} />);
    fillAndSubmit('brand-new-1', 'brand-new-2');
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls set_my_password with p_password on a valid submit', async () => {
    render(<ForcePasswordChange onCleared={vi.fn()} />);
    fillAndSubmit('brand-new-pass', 'brand-new-pass');
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_my_password', { p_password: 'brand-new-pass' })
    );
  });

  it('re-reads the flag and calls onCleared only after it confirms false', async () => {
    const onCleared = vi.fn();
    render(<ForcePasswordChange onCleared={onCleared} />);
    fillAndSubmit('brand-new-pass', 'brand-new-pass');
    await waitFor(() => expect(fetchMustChangePassword).toHaveBeenCalled());
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));
  });

  it('does not call onCleared if the re-read still shows the flag set', async () => {
    fetchMustChangePassword.mockResolvedValue(true);
    const onCleared = vi.fn();
    render(<ForcePasswordChange onCleared={onCleared} />);
    fillAndSubmit('brand-new-pass', 'brand-new-pass');
    await waitFor(() => expect(screen.getByText(/could not confirm/i)).toBeInTheDocument());
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('surfaces the server "not used before" refusal', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'set_my_password') {
        return Promise.resolve({ error: { message: 'Choose a password you have not used before.' } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const onCleared = vi.fn();
    render(<ForcePasswordChange onCleared={onCleared} />);
    fillAndSubmit('brand-new-pass', 'brand-new-pass');
    expect(await screen.findByText(/not used before/i)).toBeInTheDocument();
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('offers a working sign-out escape hatch', async () => {
    render(<ForcePasswordChange onCleared={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
