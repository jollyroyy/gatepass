// Live verification probe for migration 043 — the gate pass approval ladder.
//
// Runs as REAL users over the anon-key REST path, never as postgres: postgres
// bypasses RLS and every `is_admin()` guard in here, so a psql run could not
// prove any of it. What has to hold for a browser client:
//
//   * an admin can designate and vacate an office;
//   * a GUARD can READ the ladder — deliberately, because the four names are
//     printed on the face of every pass that leaves the building;
//   * a guard CANNOT write it, and neither can anybody but an admin;
//   * nobody at all holds INSERT/UPDATE/DELETE on the table itself, so the two
//     RPCs really are the only writers;
//   * and none of this touches `gatepass.ceo_approver`, which is a PERMISSION.
//
// Leaves the ladder as it found it: every office it sets, it clears again.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) { console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)'); process.exit(1); }

const ADMIN = { email: 'admin@demo.vms', password: 'demo123' };
const GUARD = { email: 'guard@demo.vms', password: 'demo123' };

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');

async function signIn({ email, password }) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);

  const { data: me } = await gp(admin).rpc('my_profile');
  const adminId = Array.isArray(me) ? me[0]?.id : me?.id;
  if (!adminId) throw new Error('could not resolve the admin profile id');

  // ── 1. An admin designates an office ──────────────────────────────────────
  {
    const { error } = await gp(admin).rpc('set_approval_role', {
      p_role_key: 'security_head', p_user_id: adminId,
    });
    record('admin can designate an office', !error, error?.message);
  }

  // ── 2. A guard can READ it ────────────────────────────────────────────────
  {
    const { data, error } = await gp(guard).rpc('get_approval_ladder');
    const row = (data ?? []).find((r) => r.role_key === 'security_head');
    record(
      'a guard reads the ladder, with the name and department',
      !error && !!row && row.user_id === adminId,
      error?.message ?? `rows=${JSON.stringify(data)}`,
    );
  }

  // ── 3. A guard cannot WRITE it ────────────────────────────────────────────
  {
    const { error } = await gp(guard).rpc('set_approval_role', {
      p_role_key: 'coo', p_user_id: adminId,
    });
    record('a guard cannot designate an office', !!error, error?.message ?? 'NO ERROR — the guard wrote it');
  }
  {
    const { error } = await gp(guard).rpc('clear_approval_role', { p_role_key: 'security_head' });
    record('a guard cannot vacate an office', !!error, error?.message ?? 'NO ERROR — the guard cleared it');
  }

  // ── 4. Nobody holds table writes — the RPCs are the only writers ──────────
  for (const [who, client] of [['admin', admin], ['guard', guard]]) {
    const { error } = await gp(client).from('approval_roles')
      .insert({ role_key: 'ceo', user_id: adminId, designated_by: adminId });
    record(`${who} holds no INSERT on approval_roles`, !!error, error?.message ?? 'NO ERROR — direct insert landed');
  }
  {
    const { error } = await gp(admin).from('approval_roles').delete().eq('role_key', 'security_head');
    record('admin holds no DELETE on approval_roles', !!error, error?.message ?? 'NO ERROR — direct delete landed');
  }

  // ── 5. An unknown office is refused ───────────────────────────────────────
  {
    const { error } = await gp(admin).rpc('set_approval_role', {
      p_role_key: 'ceo_of_everything', p_user_id: adminId,
    });
    record('an unknown level is refused', !!error, error?.message ?? 'NO ERROR — an unknown key landed');
  }

  // ── 6. Vacating works, and leaves the ladder as it was found ──────────────
  {
    const { error } = await gp(admin).rpc('clear_approval_role', { p_role_key: 'security_head' });
    const { data } = await gp(admin).rpc('get_approval_ladder');
    const gone = !(data ?? []).some((r) => r.role_key === 'security_head');
    record('admin vacates the office, and it is gone', !error && gone, error?.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
