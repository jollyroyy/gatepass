// Provision the e2e cast against the shared Supabase project.
//
// TWO CREDENTIALS, ON PURPOSE:
//   * the service-role key creates auth users and writes `public` (profiles,
//     departments) and `gatepass.hod_departments` — the same grants
//     scripts/create-user.ts uses.
//   * psql (SUPABASE_DB_URL) does the rest of `gatepass`, because migration 007
//     deliberately gives service_role no privilege on most of that schema —
//     `approval_roles` answers "permission denied" over PostgREST.
//
// IDEMPOTENT: re-running adopts whatever already exists.
//
// THE FOUR APPROVAL OFFICES ARE SINGLETON SEATS (049), so seeding EVICTS the
// sitting holders to put the e2e cast on the ladder. The eviction is
// snapshotted to tests/e2e/.state/approval_roles.snapshot.json and put back by
// scripts/e2e/restore.mjs. Do not run this against a project whose ladder is in
// live use.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS, E2E_DEPT, E2E_DEPT_2 } from './accounts.mjs';
import { psql } from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.SUPABASE_DB_URL;
const PASSWORD = process.env.E2E_PASSWORD;
for (const [n, v] of [['VITE_SUPABASE_URL', URL_], ['SUPABASE_SERVICE_ROLE_KEY', KEY], ['SUPABASE_DB_URL', DB], ['E2E_PASSWORD', PASSWORD]]) {
  if (!v) { console.error(`Missing ${n} in .env`); process.exit(1); }
}

const sb = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const STATE = path.join(root, 'tests/e2e/.state');
fs.mkdirSync(STATE, { recursive: true });

async function ensureDepartment({ code, name }) {
  const found = await sb.schema('public').from('departments').select('id, code, name').eq('code', code).maybeSingle();
  if (found.error) throw new Error(`departments lookup: ${found.error.message}`);
  if (found.data) return found.data;
  const made = await sb.schema('public').from('departments').insert({ code, name }).select('id, code, name').single();
  if (made.error) throw new Error(`departments insert: ${made.error.message}`);
  console.log(`  + department ${code}`);
  return made.data;
}

async function findUserByEmail(email) {
  // listUsers has no email filter in this client version; the cast is small and
  // the project has fewer than 200 users, so one page is enough.
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureUser(acct, deptId) {
  let user = await findUserByEmail(acct.email);
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({
      email: acct.email, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: acct.name },
    });
    if (error) throw new Error(`createUser ${acct.email}: ${error.message}`);
    user = data.user;
    console.log(`  + auth user ${acct.email}`);
  }

  // ALWAYS a second write, never a create-time one. public.handle_new_user()
  // fires AFTER INSERT on auth.users and unconditionally ORs
  // {"role":"staff"} into raw_app_meta_data, so a role passed to createUser is
  // overwritten before the call returns. app_metadata.role is what every RLS
  // policy authorises off (gatepass.app_role()), so it has to be set after.
  const { error: uErr } = await sb.auth.admin.updateUserById(user.id, {
    password: PASSWORD, email_confirm: true,
    app_metadata: { role: acct.role }, user_metadata: { full_name: acct.name },
  });
  if (uErr) throw new Error(`updateUser ${acct.email}: ${uErr.message}`);

  const profile = { id: user.id, email: acct.email, full_name: acct.name, role: acct.role, must_change_password: false };
  if (deptId) profile.department_id = deptId;
  const { error: pErr } = await sb.schema('public').from('profiles').upsert(profile, { onConflict: 'id' });
  if (pErr) throw new Error(`profiles upsert ${acct.email}: ${pErr.message}`);

  // One department per person (032): replace rather than add.
  psql(`delete from gatepass.hod_departments where hod_id = '${user.id}';`);
  if (deptId) {
    psql(`insert into gatepass.hod_departments (hod_id, department_id) values ('${user.id}', '${deptId}') on conflict do nothing;`);
  }
  // An absent user_status row means active (040).
  psql(`delete from gatepass.user_status where user_id = '${user.id}';`);
  return user.id;
}

async function main() {
  console.log('E2E seed — departments');
  const d1 = await ensureDepartment(E2E_DEPT);
  const d2 = await ensureDepartment(E2E_DEPT_2);

  console.log('E2E seed — accounts');
  const ids = {};
  for (const a of ACCOUNTS) {
    const deptId = a.dept === E2E_DEPT.code ? d1.id : a.dept === E2E_DEPT_2.code ? d2.id : null;
    ids[a.key] = await ensureUser(a, deptId);
    console.log(`  · ${a.key.padEnd(8)} ${a.email}  role=${a.role}  office=${a.office ?? '-'}`);
  }

  console.log('E2E seed — approval ladder');
  const snapPath = path.join(STATE, 'approval_roles.snapshot.json');
  if (!fs.existsSync(snapPath)) {
    const rows = psql(`select role_key, user_id::text, coalesce(designated_by::text,'') from gatepass.approval_roles order by role_key;`);
    const parsed = rows ? rows.split('\n').map((l) => {
      const [role_key, user_id, designated_by] = l.split('\t');
      return { role_key, user_id, designated_by: designated_by || null };
    }) : [];
    fs.writeFileSync(snapPath, JSON.stringify(parsed, null, 2));
    console.log(`  snapshot written: ${parsed.length} seat(s) → ${path.relative(root, snapPath)}`);
  } else {
    console.log('  snapshot already exists — not overwriting (restore.mjs consumes it)');
  }

  if (process.env.E2E_TAKE_LADDER !== '1') {
    console.log('  E2E_TAKE_LADDER is not 1 — leaving the four offices with whoever holds them.');
    console.log('  The approver specs cannot run without them; set it only when the project is yours.');
  } else
  for (const a of ACCOUNTS.filter((x) => x.office)) {
    psql(`delete from gatepass.approval_roles where role_key = '${a.office}' or user_id = '${ids[a.key]}';`);
    psql(`insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at) values ('${a.office}', '${ids[a.key]}', '${ids.admin}', now());`);
    console.log(`  · ${a.office.padEnd(14)} → ${a.email}`);
  }

  fs.writeFileSync(path.join(STATE, 'ids.json'), JSON.stringify({ ...ids, deptId: d1.id, dept2Id: d2.id }, null, 2));
  console.log(`\nSeed complete. Password for every e2e account: E2E_PASSWORD in .env\n`);
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
