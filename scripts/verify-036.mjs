// Live verification probe for migration 036 (GatePass) / 064 (VMS) — the
// admin-assisted password reset and the forced change on first sign-in.
//
// Runs as REAL users over the anon-key REST path, never as postgres: postgres
// bypasses RLS and every SECURITY DEFINER guard in these functions, so a psql
// run could not prove any of this. The whole point of the exercise is that the
// admin check, the admin-target refusal and the auth server's acceptance of a
// hand-written bcrypt hash all hold for a browser client.
//
// The probe user is created and then deleted at the end via psql (nobody holds
// DELETE over the anon path), so the DB is left exactly as it was found.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) { console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)'); process.exit(1); }

const ADMIN_EMAIL = 'admin@demo.quest';
const ADMIN_PASSWORD = 'demo123';

const stamp = Date.now();
const PROBE_EMAIL = `probe.036.${stamp}@demo.vms`;
const PROBE_INITIAL = 'initial-036-pw';
const PROBE_RESET = 'reset-036-pw';     // what the admin sets
const PROBE_CHOSEN = 'chosen-036-pw';   // what the user then picks

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');

async function signIn(email, password) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  return { client: c, error };
}

async function main() {
  // ── 0. admin session ───────────────────────────────────────────────────────
  const { client: admin, error: adminErr } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminErr) { console.error(`could not sign in as ${ADMIN_EMAIL}: ${adminErr.message}`); process.exit(1); }

  // ── 1. create a probe user to reset ────────────────────────────────────────
  const { data: created, error: createErr } = await gp(admin).rpc('admin_create_user', {
    p_email: PROBE_EMAIL,
    p_password: PROBE_INITIAL,
    p_full_name: 'Probe User',
    p_role: 'guard',
    p_department_ids: null,
  });
  if (createErr) { console.error(`admin_create_user failed: ${createErr.message}`); process.exit(1); }
  const probeId = created.id;
  record('probe user created', !!probeId, `${PROBE_EMAIL} -> ${probeId}`);

  // Baseline: a freshly created user owes NO password change. If this were true
  // by default, every existing account in the system would be locked behind the
  // forced-change screen — the single worst way this feature could fail.
  {
    const { client: c, error } = await signIn(PROBE_EMAIL, PROBE_INITIAL);
    if (error) { record('probe can sign in before any reset', false, error.message); }
    else {
      const { data } = await gp(c).rpc('my_profile');
      const flag = Array.isArray(data) ? data[0]?.must_change_password : data?.must_change_password;
      record('fresh user is NOT forced to change password', flag === false, `must_change_password = ${flag}`);
    }
  }

  // ── 2. a NON-admin must not be able to reset anyone ────────────────────────
  {
    const { client: c, error } = await signIn(PROBE_EMAIL, PROBE_INITIAL);
    if (error) { record('non-admin refused', false, `could not sign in: ${error.message}`); }
    else {
      const { error: e } = await gp(c).rpc('admin_reset_user_password', { p_user_id: probeId, p_password: 'hijacked-pw' });
      record('non-admin CANNOT reset a password', !!e && /only an admin/i.test(e.message), e ? e.message : 'NO ERROR — the guard is missing');
    }
  }

  // ── 3. an admin must not be able to reset another ADMIN ────────────────────
  {
    const { data: me } = await gp(admin).rpc('my_profile');
    const adminId = Array.isArray(me) ? me[0]?.id : me?.id;
    const { error: e } = await gp(admin).rpc('admin_reset_user_password', { p_user_id: adminId, p_password: 'escalate-pw' });
    record('admin CANNOT reset an admin account', !!e && /admin passwords cannot be reset/i.test(e.message), e ? e.message : 'NO ERROR — privilege escalation is open');
  }

  // ── 4. too-short password is refused server-side ───────────────────────────
  {
    const { error: e } = await gp(admin).rpc('admin_reset_user_password', { p_user_id: probeId, p_password: 'abc' });
    record('short password refused', !!e && /at least 6 characters/i.test(e.message), e ? e.message : 'NO ERROR');
  }

  // ── 5. the real reset ──────────────────────────────────────────────────────
  const { data: reset, error: resetErr } = await gp(admin).rpc('admin_reset_user_password', {
    p_user_id: probeId,
    p_password: PROBE_RESET,
  });
  record('admin reset succeeds', !resetErr, resetErr ? resetErr.message : JSON.stringify(reset));

  // ── 6. the OLD password must no longer work ────────────────────────────────
  {
    const { error } = await signIn(PROBE_EMAIL, PROBE_INITIAL);
    record('old password no longer works', !!error, error ? error.message : 'NO ERROR — the old password still signs in');
  }

  // ── 7. the NEW password works, and the flag is up ──────────────────────────
  //     This is the load-bearing claim: GoTrue accepts a bcrypt hash written by
  //     our own SQL, so the person can actually sign in with what the admin read
  //     out to them.
  let probeClient = null;
  {
    const { client: c, error } = await signIn(PROBE_EMAIL, PROBE_RESET);
    record('user signs in with the admin-set password', !error, error ? error.message : 'signed in');
    if (!error) {
      probeClient = c;
      const { data } = await gp(c).rpc('my_profile');
      const flag = Array.isArray(data) ? data[0]?.must_change_password : data?.must_change_password;
      record('gatepass my_profile reports must_change_password', flag === true, `must_change_password = ${flag}`);

      const { data: vmsFlag, error: vmsErr } = await c.rpc('my_must_change_password');
      record('VMS my_must_change_password agrees', vmsFlag === true && !vmsErr, vmsErr ? vmsErr.message : `-> ${vmsFlag}`);
    }
  }

  // ── 8. reusing the temporary password is refused ───────────────────────────
  if (probeClient) {
    const { error: e } = await gp(probeClient).rpc('set_my_password', { p_password: PROBE_RESET });
    record('cannot re-set the same password', !!e && /have not used before/i.test(e.message), e ? e.message : 'NO ERROR — the temp password can be kept');
  }

  // ── 9. the user chooses their own; the flag clears in the same call ────────
  if (probeClient) {
    const { error: e } = await gp(probeClient).rpc('set_my_password', { p_password: PROBE_CHOSEN });
    record('user sets their own password', !e, e ? e.message : 'ok');

    const { data } = await gp(probeClient).rpc('my_profile');
    const flag = Array.isArray(data) ? data[0]?.must_change_password : data?.must_change_password;
    record('flag clears with the password write', flag === false, `must_change_password = ${flag}`);
  }

  // ── 10. the chosen password works from a COMPLETELY fresh client ───────────
  //      A fresh client proves the credential itself changed, not that some
  //      cached session happened to still be valid.
  {
    const { client: c, error } = await signIn(PROBE_EMAIL, PROBE_CHOSEN);
    record('user signs in with their OWN new password', !error, error ? error.message : 'signed in');
    if (!error) {
      const { data: flag } = await c.rpc('my_must_change_password');
      record('second sign-in is NOT gated', flag === false, `my_must_change_password -> ${flag}`);
    }
  }

  // ── 11. the admin-set password is dead once replaced ───────────────────────
  {
    const { error } = await signIn(PROBE_EMAIL, PROBE_RESET);
    record('the temporary password stops working', !!error, error ? error.message : 'NO ERROR — temp password still valid');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`\nCLEANUP (anon cannot delete auth.users):\n  delete from auth.users where email = '${PROBE_EMAIL}';`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
