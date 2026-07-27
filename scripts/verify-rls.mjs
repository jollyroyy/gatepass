// Live RLS verification against the real Supabase project.
//
// This is the "API-layer RLS checks" item that CLAUDE.md lists as outstanding:
// cross-department reads, direct PATCH rejection, double-match refusal. Static
// tests cannot prove any of it — RLS only exists in the database, and the SQL
// Editor runs as `postgres`, which bypasses every policy. The only honest test is
// a real HTTP request carrying a real user's JWT.
//
//   node scripts/verify-rls.mjs              read-only checks — cleans up fully
//   node scripts/verify-rls.mjs --mutate     also inserts a pass, matches it,
//                                            and proves a second match is refused
//
// It creates two throwaway accounts (guard + hod), signs in as each with the ANON
// key like the browser does, and deletes everything it made in a finally block.
// It never asserts anything as `postgres` and never uses the service-role key for
// a check — only for setup and teardown.
//
// PREREQUISITE: migration 007. Without it the service role has no USAGE on the
// gatepass schema and this aborts during setup with `42501 permission denied for
// schema gatepass`, before checking anything.
//
// --mutate CANNOT fully clean up: nothing holds DELETE on gatepass.gate_passes
// (audit trail), so the pass it raises — and the users the FK then pins — survive
// the run. It prints the exact SQL to remove them. Prefer the read-only mode for
// routine checks; it needs no manual follow-up.
//
// The service-role key stays server-side: this file lives in scripts/, is never
// imported by src/, and reads a bare SUPABASE_SERVICE_ROLE_KEY (no VITE_ prefix,
// which would inline it into the browser bundle).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const MUTATE = process.argv.includes('--mutate');
const TAG = `rlstest-${Date.now()}`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const info = (name, detail) => {
  results.push({ name, ok: null, detail });
  console.log(`INFO  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const errText = (e) => (e ? `${e.code ?? '-'} ${e.message}` : 'no error');

async function makeUser(role) {
  const email = `${TAG}-${role}@example.com`;
  const password = `T${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Authorization is read from app_metadata ONLY — user_metadata is
    // user-writable and must never carry a role.
    app_metadata: { role },
    user_metadata: { full_name: `RLS Test ${role}` },
  });
  if (error) throw new Error(`createUser(${role}): ${error.message}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn(${role}): ${signInErr.message}`);
  return { id: data.user.id, email, client };
}

const gp = (c) => c.schema('gatepass');
const pub = (c) => c.schema('public');

async function main() {
  const created = { userIds: [], passIds: [] };
  try {
    // ── Setup: two real signed-in users, and a department for the HOD ────────
    const guard = await makeUser('guard');
    const hod = await makeUser('hod');
    created.userIds.push(guard.id, hod.id);

    const { data: depts, error: deptErr } = await admin
      .schema('public').from('departments').select('id, name, code').order('name').limit(2);
    if (deptErr) throw new Error(`read departments: ${deptErr.message}`);
    if (!depts?.length) throw new Error('no departments exist — cannot test department scoping');
    const own = depts[0];
    const other = depts[1] ?? null;

    const { error: assignErr } = await admin
      .schema('gatepass').from('hod_departments')
      .insert({ hod_id: hod.id, department_id: own.id });
    if (assignErr) throw new Error(`assign department: ${assignErr.message}`);

    console.log(`\nDepartment under test: ${own.name} (${own.code})`);
    console.log(`${other ? `Second department for cross-dept checks: ${other.name}` : 'Only one department exists — cross-dept read check will be skipped'}\n`);

    // ── 1. The regression itself ────────────────────────────────────────────
    // A guard loading the gate console. This is the query that died with 42P17
    // "infinite recursion detected in policy for relation profiles", because
    // v_gate_passes is security_invoker and used to LEFT JOIN public.profiles.
    {
      const { error } = await gp(guard.client).from('v_gate_passes').select('id, pass_number, raised_by_name').limit(5);
      record('guard reads gatepass.v_gate_passes (the 42P17 regression)', !error, errText(error));
      if (error?.code === '42P17') {
        console.log('        ↑ migration 006 is NOT applied yet, or the view still joins public.profiles.');
      }
    }

    // ── 2. The replacement accessors exist and are correctly scoped ──────────
    {
      const { data, error } = await gp(guard.client).rpc('my_profile').maybeSingle();
      record('guard reads own profile via gatepass.my_profile()', !error && !!data,
        error ? errText(error) : `full_name=${data?.full_name ?? 'null'}`);
    }
    {
      // Must be REFUSED: the directory returns emails and roles, so it is
      // admin-only. This is stricter than the client query it replaced.
      const { error } = await gp(guard.client).rpc('admin_list_profiles', { p_role: null });
      const refused = !!error && /only an admin/i.test(error.message ?? '');
      record('guard is refused gatepass.admin_list_profiles()', refused, errText(error));
    }
    {
      const { error } = await gp(guard.client).rpc('kpis', { p_department_id: null });
      record('guard reads gatepass.kpis()', !error, errText(error));
    }

    // ── 3. Is VMS's underlying recursion still live? ─────────────────────────
    // Informational, not a gatepass pass/fail: this app no longer reads that
    // table. A failure here means VMS itself is still broken and
    // supabase/fixes/public_profiles_recursion.sql has not been applied.
    {
      const { error } = await pub(guard.client).from('profiles').select('id').limit(1);
      info('VMS: guard reads public.profiles directly',
        error ? `STILL BROKEN — ${errText(error)}` : 'ok, no recursion');
    }

    // ── 4. Department scoping for the HOD ───────────────────────────────────
    {
      const { data, error } = await gp(hod.client).from('v_gate_passes').select('id, department_id');
      if (error) {
        record('hod reads v_gate_passes', false, errText(error));
      } else {
        const leaked = (data ?? []).filter((r) => r.department_id !== own.id);
        record('hod sees ONLY their own department in v_gate_passes', leaked.length === 0,
          `${data.length} rows visible, ${leaked.length} from other departments`);
      }
    }
    {
      const { data, error } = await gp(hod.client).from('hod_departments').select('hod_id');
      const foreign = (data ?? []).filter((r) => r.hod_id !== hod.id);
      record('hod sees only their own department assignments', !error && foreign.length === 0,
        error ? errText(error) : `${foreign.length} foreign rows`);
    }

    // ── 5. Insert authority ────────────────────────────────────────────────
    const passBody = (departmentId) => ({
      type: 'NRGP',
      department_id: departmentId,
      raised_by: hod.id,
      visitor_name: `RLS TEST ${TAG} — safe to delete`,
      material_description: `RLS TEST ${TAG}`,
      quantity: 1,
      unit: 'nos',
      purpose: 'automated RLS verification',
    });

    if (other) {
      const { error } = await gp(hod.client).from('gate_passes').insert(passBody(other.id));
      record('hod CANNOT raise a pass for a department they do not hold', !!error, errText(error));
    }
    {
      // Attribution forgery: raising a pass in someone else's name.
      const { error } = await gp(hod.client).from('gate_passes')
        .insert({ ...passBody(own.id), raised_by: guard.id });
      record('hod CANNOT attribute a pass to another user', !!error, errText(error));
    }
    {
      // Arriving pre-matched, which would skip the gate entirely.
      const { error } = await gp(hod.client).from('gate_passes')
        .insert({ ...passBody(own.id), status: 'matched' });
      record('hod CANNOT insert a pass that is already matched', !!error, errText(error));
    }
    {
      const { error } = await gp(guard.client).from('gate_passes').insert(passBody(own.id));
      record('guard CANNOT raise a pass at all', !!error, errText(error));
    }

    if (!MUTATE) {
      console.log('\nSkipping the write path (insert / match / double-match). Re-run with --mutate for those.');
      return;
    }

    // ── 6. The write path, end to end ──────────────────────────────────────
    let passId = null;
    {
      const { data, error } = await gp(hod.client).from('gate_passes')
        .insert(passBody(own.id)).select('id, pass_number, status').single();
      record('hod raises a pass in their own department', !error && !!data, error ? errText(error) : `${data.pass_number}`);
      passId = data?.id ?? null;
      if (passId) created.passIds.push(passId);
    }
    if (passId) {
      // No client holds UPDATE on gate_passes (migration 002 grants select+insert
      // only), so a direct PATCH must be rejected regardless of who sends it.
      const { error } = await gp(guard.client).from('gate_passes')
        .update({ status: 'matched' }).eq('id', passId);
      record('guard CANNOT PATCH gate_passes directly (RPC-only state machine)', !!error, errText(error));

      const { error: hodPatchErr } = await gp(hod.client).from('gate_passes')
        .update({ visitor_name: 'rewritten' }).eq('id', passId);
      record('hod CANNOT PATCH their own pass after raising it', !!hodPatchErr, errText(hodPatchErr));

      const { error: hodMatchErr } = await gp(hod.client).rpc('match_pass', { p_pass_id: passId });
      record('hod CANNOT match their own pass via the RPC', !!hodMatchErr, errText(hodMatchErr));

      const { error: matchErr } = await gp(guard.client).rpc('match_pass', {
        p_pass_id: passId, p_verified_quantity: 1, p_remarks: `RLS verification ${TAG}`,
      });
      record('guard matches the pass', !matchErr, errText(matchErr));

      const { error: doubleErr } = await gp(guard.client).rpc('match_pass', { p_pass_id: passId });
      record('a second match is refused', !!doubleErr, errText(doubleErr));

      const { data: after } = await gp(guard.client).from('v_gate_passes')
        .select('status, verified_by_name, is_overdue').eq('id', passId).maybeSingle();
      record('matched pass reads back with a verifier name (no 42P17)',
        after?.status === 'matched', `status=${after?.status ?? 'unreadable'}, verified_by_name=${after?.verified_by_name ?? 'null'}`);
    }
  } finally {
    // ── Teardown ───────────────────────────────────────────────────────────
    // Order matters: gate_passes.raised_by references public.profiles(id) with
    // no cascade, so the passes must go before the users.
    //
    // Passes CANNOT be deleted through this API. Nothing holds DELETE on
    // gatepass.gate_passes — not even the service role (migration 007 grants it
    // hod_departments and verifications only, and sqlInvariants.test.ts fails
    // the build if anyone adds the missing grant). That is the correct posture
    // for an audit trail and a deliberate cost paid by this script: --mutate
    // leaves a tagged row behind, and the FK above then blocks deleting the user
    // who raised it. Both get reported below as copy-pasteable SQL rather than
    // silently leaking.
    const orphans = [];
    for (const id of created.passIds) {
      const { error } = await admin.schema('gatepass').from('gate_passes').delete().eq('id', id);
      if (error) orphans.push(id);
    }
    for (const id of created.userIds) {
      await admin.schema('gatepass').from('hod_departments').delete().eq('hod_id', id);
      // Skipped while a pass still references this user — the delete would fail
      // on the FK anyway, and a half-deleted auth user is worse than a live one.
      if (orphans.length) continue;
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error(`CLEANUP FAILED for user ${id}: ${error.message} — delete it manually.`);
    }
    const failed = results.filter((r) => r.ok === false);
    console.log(`\n${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} informational`);
    if (failed.length) {
      console.log('Failed:');
      for (const f of failed) console.log(`  - ${f.name}\n      ${f.detail}`);
    }
    if (orphans.length) {
      console.log(
        `\nMANUAL CLEANUP REQUIRED — ${orphans.length} test pass(es) could not be deleted ` +
        `(no DELETE on gatepass.gate_passes by design), so ${created.userIds.length} test user(s) ` +
        `were left in place too. Run this in the Supabase SQL Editor:\n\n` +
        `  delete from gatepass.verifications where gate_pass_id in ('${orphans.join("','")}');\n` +
        `  delete from gatepass.gate_passes   where id in ('${orphans.join("','")}');\n` +
        `  delete from auth.users             where id in ('${created.userIds.join("','")}');\n\n` +
        `Every row this script created is tagged "${TAG}" if you need to find them again.`
      );
    } else {
      console.log(`Cleaned up ${created.passIds.length} test pass(es) and ${created.userIds.length} test user(s).`);
    }
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`\nAborted: ${err.message}`);
  process.exitCode = 1;
});
