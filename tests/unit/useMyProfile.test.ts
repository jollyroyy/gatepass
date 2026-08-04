// useMyProfile — the profile page's data source. Reads through
// gatepass.my_profile() and writes through the gatepass RPCs, never
// public.profiles directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMyProfile } from '../../src/lib/useMyProfile';

const mocks = vi.hoisted(() => ({
  fetchMyProfile: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../src/lib/profiles', () => ({ fetchMyProfile: mocks.fetchMyProfile }));
vi.mock('../../src/supabaseClient', () => ({ gp: () => ({ rpc: mocks.rpc }) }));

const PROFILE = {
  id: 'u1',
  email: 'hod.it@demo.vms',
  full_name: 'Riya Sen',
  role: 'hod' as const,
  department_id: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mocks.fetchMyProfile.mockReset();
  mocks.rpc.mockReset();
});

describe('useMyProfile', () => {
  it('loads the caller profile on mount', async () => {
    mocks.fetchMyProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a load failure as an error message instead of throwing', async () => {
    mocks.fetchMyProfile.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.error).toBe('network down'));
  });

  it('rejects an empty display name without calling the RPC', async () => {
    mocks.fetchMyProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    const err = await act(async () => result.current.saveName('   '));
    expect(err).toBe('Your name cannot be empty.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('saves the name through update_my_name and reflects it locally', async () => {
    mocks.fetchMyProfile.mockResolvedValue(PROFILE);
    mocks.rpc.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    const err = await act(async () => result.current.saveName('  New Name  '));
    expect(err).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith('update_my_name', { p_full_name: 'New Name' });
    expect(result.current.profile?.full_name).toBe('New Name');
  });

  it('returns the RPC error message when the name save fails', async () => {
    mocks.fetchMyProfile.mockResolvedValue(PROFILE);
    mocks.rpc.mockResolvedValue({ error: { message: 'name rejected' } });
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    const err = await act(async () => result.current.saveName('New Name'));
    expect(err).toBe('name rejected');
  });

  it('setAvatarUrl updates the avatar locally without a round trip', async () => {
    mocks.fetchMyProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useMyProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    act(() => result.current.setAvatarUrl('https://x/avatar.png'));
    expect(result.current.profile?.avatar_url).toBe('https://x/avatar.png');

    act(() => result.current.setAvatarUrl(null));
    expect(result.current.profile?.avatar_url).toBeNull();
  });
});
