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

/**
 * Whether the signed-in user still owes us a password change (migration 036,
 * admin-triggered reset). Goes through fetchMyProfile() rather than a bare
 * RPC call, so App.tsx and ForcePasswordChange.tsx never reference
 * `my_profile` directly (tests/security/noDirectProfilesRead.test.ts pins
 * that only this file and supabaseClient.ts may). A lookup failure is
 * allowed to propagate — App.tsx decides to fail open on it, not this file.
 */
export async function fetchMustChangePassword(): Promise<boolean> {
  const profile = await fetchMyProfile();
  return Boolean(profile?.must_change_password);
}

/**
 * Everything App.tsx has to know before it renders a screen, in ONE read.
 *
 * Both facts live only in `gatepass.my_profile()` — neither is in the JWT — and
 * both gate the whole app, so asking for them separately would be two RPCs to
 * answer one question, with the second able to disagree with the first.
 *
 * `isActive` IS THE SUSPENSION AND NOTHING ELSE: `is_active === false`, the row
 * migration 040 writes when an admin stops an account. It is deliberately NOT
 * `isDirectoryActive`, which folds in "this role has no place in this app" —
 * a second, unrelated fact that the admin DIRECTORY needs in one column and
 * this gate must not confuse with a suspension.
 *
 * Folding them together made App.tsx tell every VMS `staff` account "Account
 * Deactivated … your role and department are unchanged, an administrator can
 * reactivate the account" — a false statement about a `user_status` row that
 * was never written, and one that sends the reader to ask for the wrong fix.
 * It also made the role branch of `NoAccess` unreachable. App.tsx's own role
 * check is what catches somebody with no place here, and it says so plainly:
 * "No Gate Pass Access".
 *
 * An absent row means active — 040 writes one only for somebody actually
 * suspended — and so does no profile row at all.
 *
 * Throws on a failed lookup. App.tsx decides to fail open on that, not this
 * file — being unable to reach the database is not proof anybody is suspended.
 */
export async function fetchAccessState(): Promise<{
  mustChangePassword: boolean;
  isActive: boolean;
}> {
  const profile = await fetchMyProfile();
  return {
    mustChangePassword: Boolean(profile?.must_change_password),
    isActive: profile?.is_active !== false,
  };
}

/** "sudeshna.pal@x.com" → "Sudeshna". Exported for the tests. */
export function nameFromEmail(email: string | null | undefined): string {
  const part = (email ?? '').split('@')[0]?.split('.')[0] ?? '';
  if (!part) return 'User';
  return part.charAt(0).toUpperCase() + part.slice(1);
}
