// Live audit of the admin user- and department-management surface, run as a
// REAL admin over the anon-key REST path. postgres bypasses is_admin() and RLS
// entirely, so a psql run proves nothing about what the Admin Panel can
// actually do — only a real JWT does.
//
// Everything it creates, it deletes. The department probe is removed via the
// admin RPC; the probe user needs psql (nobody holds DELETE on auth.users),
// and the script prints that one line at the end.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) { console.error('missing env'); process.exit(1); }

const ADMIN = { email: 'admin@demo.quest', password: 'demo123' };
const GUARD = { email: 'guard@demo.vms', password: 'demo123' };

const stamp = Date.now();
const PROBE_EMAIL = `probe.admin.${stamp}@demo.vms`;
const PROBE_PW = 'probe-admin-pw';

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
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return c;
}

async function main() {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);

  // ── the directory the Users tab renders ────────────────────────────────────
  const { data: before, error: listErr } = await gp(admin).rpc('admin_list_profiles');
  record('admin_list_profiles returns the directory', !listErr && Array.isArray(before), listErr ? listErr.message : `${before?.length} profiles`);

  // A guard must not be able to read the whole staff directory.
  {
    const { error } = await gp(guard).rpc('admin_list_profiles');
    record('a guard CANNOT list all profiles', !!error, error ? error.message : 'NO ERROR — the directory is open to non-admins');
  }

  // ── departments ────────────────────────────────────────────────────────────
  const { data: depts, error: deptErr } = await gp(admin).schema('public').from('departments').select('id, name, code').order('name');
  record('departments readable', !deptErr && (depts?.length ?? 0) > 0, deptErr ? deptErr.message : `${depts?.length} departments: ${depts?.map((d) => d.code).join(', ')}`);
  const deptId = depts?.[0]?.id;

  // ── create ─────────────────────────────────────────────────────────────────
  const { data: created, error: createErr } = await gp(admin).rpc('admin_create_user', {
    p_email: PROBE_EMAIL, p_password: PROBE_PW, p_full_name: 'Probe Admin',
    p_role: 'guard', p_department_ids: null,
  });
  record('admin creates a user', !createErr && !!created?.id, createErr ? createErr.message : `${created?.email} as ${created?.role}`);
  const probeId = created?.id;
  if (!probeId) { console.error('cannot continue without a probe user'); process.exit(1); }

  // The account must actually be able to sign in — 034's whole lesson.
  {
    const c = fresh();
    const { data, error } = await c.auth.signInWithPassword({ email: PROBE_EMAIL, password: PROBE_PW });
    record('the created user can actually SIGN IN', !error, error ? error.message : `role in JWT: ${data?.user?.app_metadata?.role}`);
    record('the JWT carries the right role', data?.user?.app_metadata?.role === 'guard', `app_metadata.role = ${data?.user?.app_metadata?.role}`);
  }

  // A duplicate email must be refused rather than silently creating a second row.
  {
    const { error } = await gp(admin).rpc('admin_create_user', {
      p_email: PROBE_EMAIL, p_password: PROBE_PW, p_full_name: 'Probe Admin',
      p_role: 'guard', p_department_ids: null,
    });
    record('duplicate email refused', !!error, error ? error.message : 'NO ERROR — duplicates allowed');
  }

  // Nobody may mint an admin from the panel.
  {
    const { error } = await gp(admin).rpc('admin_create_user', {
      p_email: `probe.esc.${stamp}@demo.vms`, p_password: PROBE_PW, p_full_name: 'Escalate',
      p_role: 'admin', p_department_ids: null,
    });
    record('cannot create an ADMIN from the panel', !!error, error ? error.message : 'NO ERROR — privilege escalation is open');
  }

  // A guard must not be able to create users at all.
  {
    const { error } = await gp(guard).rpc('admin_create_user', {
      p_email: `probe.guard.${stamp}@demo.vms`, p_password: PROBE_PW, p_full_name: 'By Guard',
      p_role: 'guard', p_department_ids: null,
    });
    record('a guard CANNOT create users', !!error, error ? error.message : 'NO ERROR');
  }

  // ── update: promote to HOD with a department ───────────────────────────────
  {
    const { error } = await gp(admin).rpc('admin_update_user', {
      p_user_id: probeId, p_full_name: 'Probe Renamed', p_role: 'hod',
      p_department_ids: deptId ? [deptId] : [],
    });
    record('admin edits a user (rename + promote to HOD)', !error, error ? error.message : 'ok');

    const { data: rows } = await gp(admin).rpc('admin_list_profiles');
    const row = rows?.find((r) => r.id === probeId);
    record('the edit is reflected in the directory', row?.full_name === 'Probe Renamed' && row?.role === 'hod', `${row?.full_name} / ${row?.role}`);

    const { data: assigns } = await gp(admin).from('hod_departments').select('hod_id, department_id').eq('hod_id', probeId);
    record('HOD department assignment written', (assigns?.length ?? 0) === 1, `${assigns?.length} row(s)`);
  }

  // 032's rule: one department per person, enforced by the DB itself.
  {
    const twoDepts = (depts ?? []).slice(0, 2).map((d) => d.id);
    if (twoDepts.length === 2) {
      const { error } = await gp(admin).rpc('admin_update_user', {
        p_user_id: probeId, p_full_name: 'Probe Renamed', p_role: 'hod', p_department_ids: twoDepts,
      });
      record('two departments refused (one per person)', !!error, error ? error.message : 'NO ERROR — 032 is not holding');
    }
  }

  // ── deactivate ─────────────────────────────────────────────────────────────
  {
    const { error } = await gp(admin).rpc('admin_soft_delete_user', { p_user_id: probeId });
    record('admin deactivates a user', !error, error ? error.message : 'ok');

    const { data: rows } = await gp(admin).rpc('admin_list_profiles');
    const row = rows?.find((r) => r.id === probeId);
    record('deactivated user reads as staff (no access)', row?.role === 'staff', `role = ${row?.role}`);

    const { data: assigns } = await gp(admin).from('hod_departments').select('hod_id').eq('hod_id', probeId);
    record('deactivation clears the department assignment', (assigns?.length ?? 0) === 0, `${assigns?.length} row(s) left`);
  }

  // A deactivated user keeps their credentials but must reach nothing.
  {
    const c = fresh();
    const { data, error } = await c.auth.signInWithPassword({ email: PROBE_EMAIL, password: PROBE_PW });
    record('deactivated user is demoted in the JWT', !error && data?.user?.app_metadata?.role === 'staff', error ? error.message : `role = ${data?.user?.app_metadata?.role}`);
    if (!error) {
      const { data: passes } = await c.schema('gatepass').from('v_gate_passes').select('id').limit(5);
      record('deactivated user sees NO gate passes', (passes?.length ?? 0) === 0, `${passes?.length ?? 0} rows visible`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(`\nCLEANUP:\n  delete from auth.users where email like 'probe.admin.${stamp}%' or email like 'probe.esc.${stamp}%' or email like 'probe.guard.${stamp}%';`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
