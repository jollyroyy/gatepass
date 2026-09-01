// Live verification probe for migration 040 — deactivation is a STATUS, and it
// is enforced in Postgres rather than by a screen.
//
// Runs as REAL users over the anon-key REST path, never as postgres: postgres
// bypasses RLS and every SECURITY DEFINER guard here, so a psql run could not
// prove any of it. What has to hold for a browser client:
//
//   * a suspended person keeps their role and their department, and
//   * still cannot read a single pass, because app_role() and
//     my_department_ids() both consult the flag.
//
// Probe users are created here and deleted afterwards via psql (nobody holds
// DELETE over the anon path), so the DB is left as it was found.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) { console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)'); process.exit(1); }

const ADMIN_EMAIL = 'admin@demo.quest';
const ADMIN_PASSWORD = 'demo123';
const LEGACY_STAFF_EMAIL = 'staff@demo.vms'; // read-only: only ever a refused target

const stamp = Date.now();
const GUARD_EMAIL = `probe.040.guard.${stamp}@demo.vms`;
const HOD_EMAIL = `probe.040.hod.${stamp}@demo.vms`;
const PW = 'probe-040-pw';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const info = (name, detail) => console.log(`INFO  ${name}${detail ? `\n        ${detail}` : ''}`);

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');

async function signIn(email, password) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  return { client: c, error };
}

/** How many gate passes this client can actually see. */
async function visiblePasses(client) {
  const { count, error } = await gp(client)
    .from('v_gate_passes')
    .select('id', { count: 'exact', head: true });
  return { count: count ?? 0, error };
}

async function listed(admin, id) {
  const { data } = await gp(admin).rpc('admin_list_profiles', { p_role: null });
  return (data ?? []).find((r) => r.id === id);
}

async function main() {
  const { client: admin, error: adminErr } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (adminErr) { console.error(`could not sign in as ${ADMIN_EMAIL}: ${adminErr.message}`); process.exit(1); }
  const { data: adminProfile } = await gp(admin).rpc('my_profile');
  const adminId = (Array.isArray(adminProfile) ? adminProfile[0] : adminProfile)?.id;

  const { data: depts } = await admin.schema('public').from('departments').select('id, name').limit(1);
  const deptId = depts?.[0]?.id;
  if (!deptId) { console.error('no department to assign an HOD to'); process.exit(1); }

  // ── 1. `staff` is no longer writable from the portal ──────────────────────
  {
    const { error } = await gp(admin).rpc('admin_create_user', {
      p_email: `probe.040.staff.${stamp}@demo.vms`,
      p_password: PW,
      p_full_name: 'Probe Staff',
      p_role: 'staff',
      p_department_ids: null,
    });
    record('admin_create_user refuses the role staff', !!error && /Allowed: guard, hod/i.test(error.message),
      error ? error.message : 'NO ERROR — a staff account was created');
  }

  // ── 2. two probe users ────────────────────────────────────────────────────
  const { data: g, error: gErr } = await gp(admin).rpc('admin_create_user', {
    p_email: GUARD_EMAIL, p_password: PW, p_full_name: 'Probe Guard', p_role: 'guard', p_department_ids: null,
  });
  if (gErr) { console.error(`could not create the probe guard: ${gErr.message}`); process.exit(1); }
  const guardId = g.id;

  const { data: h, error: hErr } = await gp(admin).rpc('admin_create_user', {
    p_email: HOD_EMAIL, p_password: PW, p_full_name: 'Probe Hod', p_role: 'hod', p_department_ids: [deptId],
  });
  if (hErr) { console.error(`could not create the probe HOD: ${hErr.message}`); process.exit(1); }
  const hodId = h.id;
  console.log(`\nprobe guard ${guardId}\nprobe hod   ${hodId} (dept ${depts[0].name})\n`);

  // ── 3. baseline: a new account is active and can see the gate ─────────────
  const row = await listed(admin, guardId);
  record('a new account is listed active', row?.is_active === true && row?.role === 'guard',
    `role=${row?.role} is_active=${row?.is_active}`);

  const { client: guard, error: gSignIn } = await signIn(GUARD_EMAIL, PW);
  if (gSignIn) { console.error(`probe guard cannot sign in: ${gSignIn.message}`); process.exit(1); }
  const guardBaseline = await visiblePasses(guard);
  record('the guard can read passes before suspension', guardBaseline.count > 0,
    `${guardBaseline.count} visible${guardBaseline.error ? ` (${guardBaseline.error.message})` : ''}`);

  const { client: hod, error: hSignIn } = await signIn(HOD_EMAIL, PW);
  if (hSignIn) { console.error(`probe HOD cannot sign in: ${hSignIn.message}`); process.exit(1); }
  const { data: hodDepts } = await gp(hod).rpc('my_department_ids');
  record('the HOD holds their department before suspension', (hodDepts ?? []).length === 1,
    JSON.stringify(hodDepts));

  // ── 4. only an admin may suspend, and never themselves ────────────────────
  {
    const { error } = await gp(guard).rpc('admin_soft_delete_user', { p_user_id: hodId });
    record('a guard cannot deactivate anyone', !!error && /Only an admin/i.test(error.message),
      error ? error.message : 'NO ERROR — a guard suspended an HOD');
  }
  {
    const { error } = await gp(admin).rpc('admin_soft_delete_user', { p_user_id: adminId });
    record('an admin cannot deactivate themselves', !!error && /your own account/i.test(error.message),
      error ? error.message : 'NO ERROR — the admin locked themselves out');
  }
  info('the admin-target refusal is not exercised here',
    'admin@demo.quest is the only admin, so that branch is unreachable behind the self-check above; ' +
    'sqlInvariants pins it statically');

  // ── 5. suspend the guard ──────────────────────────────────────────────────
  {
    const { error } = await gp(admin).rpc('admin_soft_delete_user', { p_user_id: guardId });
    record('the admin deactivates the guard', !error, error ? error.message : 'ok');
  }

  const after = await listed(admin, guardId);
  record('THE ROLE SURVIVES THE SUSPENSION', after?.role === 'guard' && after?.is_active === false,
    `role=${after?.role} is_active=${after?.is_active} deactivated_at=${after?.deactivated_at}`);

  // A FRESH sign-in, so this cannot be a stale-session artefact: GoTrue does not
  // know about the flag, so the credential still works and authorization is what
  // refuses. That is the whole shape of this feature.
  {
    const { client: c, error } = await signIn(GUARD_EMAIL, PW);
    record('a suspended person can still authenticate', !error,
      error ? error.message : 'signed in — the block is authorization, not the password');
    if (!error) {
      const { data: appRole } = await gp(c).rpc('app_role');
      record('app_role() is null for them', appRole === null, `app_role -> ${JSON.stringify(appRole)}`);

      const seen = await visiblePasses(c);
      record('THEY CAN READ NO PASSES', seen.count === 0,
        `${seen.count} visible (was ${guardBaseline.count})${seen.error ? ` (${seen.error.message})` : ''}`);

      const { data: mine } = await gp(c).rpc('my_profile');
      const flag = (Array.isArray(mine) ? mine[0] : mine)?.is_active;
      record('my_profile() tells the client it is suspended', flag === false, `is_active = ${flag}`);
    }
  }

  // ── 6. suspend the HOD — the department path is the one app_role misses ───
  {
    const { error } = await gp(admin).rpc('admin_soft_delete_user', { p_user_id: hodId });
    record('the admin deactivates the HOD', !error, error ? error.message : 'ok');
  }
  {
    const { client: c, error } = await signIn(HOD_EMAIL, PW);
    if (error) { record('suspended HOD signs in', false, error.message); }
    else {
      const { data: mineDepts } = await gp(c).rpc('my_department_ids');
      record('my_department_ids() returns nothing for them', (mineDepts ?? []).length === 0,
        JSON.stringify(mineDepts));

      const seen = await visiblePasses(c);
      record('a suspended HOD reads none of their department\'s passes', seen.count === 0,
        `${seen.count} visible`);
    }
  }
  {
    const { data: rows } = await gp(admin).from('hod_departments').select('department_id').eq('hod_id', hodId);
    record('the HOD keeps their department assignment', (rows ?? []).length === 1,
      `${(rows ?? []).length} row(s) — reactivation restores the exact scope`);
  }

  // ── 7. a role with nothing to restore is refused ──────────────────────────
  {
    const { data: staffRows } = await gp(admin).rpc('admin_list_profiles', { p_role: 'staff' });
    const legacy = (staffRows ?? []).find((r) => r.email === LEGACY_STAFF_EMAIL) ?? staffRows?.[0];
    if (!legacy) { info('no legacy staff row to probe', 'skipped'); }
    else {
      const { error } = await gp(admin).rpc('admin_reactivate_user', { p_user_id: legacy.id });
      record('reactivating a staff row is refused', !!error && /before reactivating/i.test(error.message),
        error ? error.message : 'NO ERROR — someone with no role was reported Active');
    }
  }

  // ── 8. reactivation restores everything ──────────────────────────────────
  {
    const { error } = await gp(admin).rpc('admin_reactivate_user', { p_user_id: guardId });
    record('the admin reactivates the guard', !error, error ? error.message : 'ok');

    const back = await listed(admin, guardId);
    record('the row is active again, same role', back?.is_active === true && back?.role === 'guard',
      `role=${back?.role} is_active=${back?.is_active} deactivated_at=${back?.deactivated_at}`);

    const { client: c, error: e2 } = await signIn(GUARD_EMAIL, PW);
    if (e2) { record('the reactivated guard signs in', false, e2.message); }
    else {
      const seen = await visiblePasses(c);
      record('their access is restored', seen.count === guardBaseline.count,
        `${seen.count} visible (baseline ${guardBaseline.count})`);
    }
  }
  {
    const { error } = await gp(admin).rpc('admin_reactivate_user', { p_user_id: hodId });
    record('the admin reactivates the HOD', !error, error ? error.message : 'ok');
    const { client: c } = await signIn(HOD_EMAIL, PW);
    const { data: mineDepts } = await gp(c).rpc('my_department_ids');
    record('the HOD holds the SAME department again', (mineDepts ?? [])[0] === deptId, JSON.stringify(mineDepts));
  }

  // ── 9. nobody can write the status table directly ─────────────────────────
  {
    const { error } = await gp(admin).from('user_status').insert({ user_id: guardId, is_active: false });
    record('user_status is RPC-only, even for an admin', !!error,
      error ? error.message : 'NO ERROR — the client can suspend people without the RPC');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`\nCLEANUP (anon cannot delete auth.users):
  delete from gatepass.user_status where user_id in (select id from auth.users where email like 'probe.040.%');
  delete from auth.users where email like 'probe.040.%';`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
