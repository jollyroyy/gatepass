// The signed-in user's own profile, plus the two edits they are allowed to
// make: display name and photo. All reads go through gatepass.my_profile()
// (src/lib/profiles.ts) and all writes through gatepass-schema RPCs — never
// public.profiles directly (migration 006).
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import { fetchMyProfile } from './profiles';
import type { Profile } from '../types';

export type UseMyProfile = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  saveName: (fullName: string) => Promise<string | null>;
  setAvatarUrl: (url: string | null) => void;
};

export function useMyProfile(): UseMyProfile {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile(await fetchMyProfile());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Returns an error message, or null on success. */
  const saveName = useCallback(async (fullName: string): Promise<string | null> => {
    const trimmed = fullName.trim();
    if (trimmed.length === 0) return 'Your name cannot be empty.';
    if (trimmed.length > 80) return 'Please keep your name under 80 characters.';

    const { error: err } = await gp().rpc('update_my_name', { p_full_name: trimmed });
    if (err) return err.message || 'Could not save your name.';

    setProfile((p) => (p ? { ...p, full_name: trimmed } : p));
    return null;
  }, []);

  const setAvatarUrl = useCallback((url: string | null) => {
    setProfile((p) => (p ? { ...p, avatar_url: url ?? null } : p));
  }, []);

  return { profile, loading, error, saveName, setAvatarUrl };
}
