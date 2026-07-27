// Person lookups — the only place this app reads profile data.
//
// Nothing here queries `public.profiles`, and nothing anywhere else in src/ may
// either. That table belongs to VMS, and a policy on it recursed into itself:
// every GatePass screen that showed a name died with SQLSTATE 42P17,
// "infinite recursion detected in policy for relation profiles". VMS has fixed
// that class of bug three times and it came back, so this app no longer depends
// on the policies of a table it does not own.
//
// Migration 006 put the replacements in the gatepass schema:
//   gatepass.my_profile()           the caller's own row
//   gatepass.admin_list_profiles()  admin-gated directory
//   gatepass.profile_names          names, joined inside the views
//
// tests/security/no-direct-profiles-read.test.ts fails the build if a
// `pub().from('profiles')` call reappears.
import { gp } from '../supabaseClient';
import type { Profile, UserRole } from '../types';

/** Shape the RPCs return: identical to Profile except `role` arrives as text. */
type ProfileRow = Omit<Profile, 'role'> & { role: string };

const toProfile = (row: ProfileRow): Profile => ({ ...row, role: row.role as UserRole });

/**
 * The signed-in user's own profile, or null if they have no row.
 *
 * Scoped to auth.uid() server-side, so this can never read someone else.
 */
export async function fetchMyProfile(): Promise<Profile | null> {
  const { data, error } = await gp().rpc('my_profile').maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as ProfileRow) : null;
}

/**
 * The user directory, for the admin screens. Admin-only — the RPC raises
 * "Only an admin can list users." for anyone else.
 *
 * @param role  restrict to one role (the Departments tab wants only HODs);
 *              omit for everyone.
 */
export async function fetchDirectory(role?: UserRole): Promise<Profile[]> {
  const { data, error } = await gp().rpc('admin_list_profiles', { p_role: role ?? null });
  if (error) throw error;
  return ((data as ProfileRow[] | null) ?? []).map(toProfile);
}

/**
 * A display name for the top strip and the sidebar.
 *
 * Never throws and never blocks a screen: a missing profile row or a failed
 * lookup degrades to a name derived from the email address, because being
 * unable to render a label is not a reason to keep a guard away from the gate.
 */
export async function fetchDisplayName(email: string | null | undefined): Promise<string> {
  const fallback = nameFromEmail(email);
  try {
    const profile = await fetchMyProfile();
    return profile?.full_name?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/** "sudeshna.pal@x.com" → "Sudeshna". Exported for the tests. */
export function nameFromEmail(email: string | null | undefined): string {
  const part = (email ?? '').split('@')[0]?.split('.')[0] ?? '';
  if (!part) return 'User';
  return part.charAt(0).toUpperCase() + part.slice(1);
}
