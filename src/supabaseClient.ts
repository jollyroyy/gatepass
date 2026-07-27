// Supabase client — single instance for the whole app.
//
// This project shares a Supabase project with VMS and spans two schemas, so
// every query states its schema explicitly. Do not add a default-schema shortcut:
// a reader must always be able to tell which schema a query hits.
//
//   pub()  → `public`   schema: profiles, departments. SHARED WITH VMS.
//   gp()   → `gatepass` schema: gate_passes, verifications, hod_departments.
//
// The anon key is public-safe. The service role key NEVER appears in src/.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

if (!url || !anonKey) {
  console.error(
    '[gatepass] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example → .env.'
  );
}

export const supabase = createClient(url, anonKey);

/** The `gatepass` schema — this app's own tables and RPCs. */
export const gp = () => supabase.schema('gatepass');

/** The `public` schema — profiles and departments, shared with VMS. Read-mostly. */
export const pub = () => supabase.schema('public');

/**
 * The signed-in user's role, read from the JWT.
 *
 * Verified against the live project: all 14 users have `app_metadata.role` set,
 * so the JWT is authoritative. `app_metadata` is only writable server-side, which
 * is why it is trusted here and `user_metadata` is not.
 *
 * The fallback — for an account provisioned outside the normal flow — goes
 * through `gatepass.my_profile()`, never `public.profiles` directly: that table
 * is VMS's and a recursive policy on it used to make this call throw 42P17 at
 * login, which is the worst possible moment to lose a role lookup.
 */
export async function getUserRole(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return null;

  const jwtRole = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (typeof jwtRole === 'string' && jwtRole) return jwtRole;

  const { data: profile } = await gp().rpc('my_profile').maybeSingle();
  return ((profile as { role?: string } | null)?.role) ?? null;
}
