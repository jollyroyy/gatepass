// Live verification probe for migration 055 — a super admin can release a pass
// past a stuck approval ladder, in writing, and a DIFFERENT admin has to review
// it afterwards.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. Every rule
// worth proving here is an authorization rule — `app_role() <> 'super_admin'`,
// `is_admin()`, the four-eyes refusal, and 046's RLS — and postgres bypasses
// all of them, so the psql apply that installed this migration proved none of
// it. What has to hold for a browser client:
//
//   * an HOD, a guard and an ORDINARY ADMIN are all refused the release. That
//     third one is the point of 039's inline `super_admin` form: an ordinary
//     admin can already create users and reset passwords, so gating on
//     `is_admin()` would hand the ladder to the same group that administers it;
//   * a reason under ten characters is refused — that column is the entire
//     defence if the release is ever questioned;
//   * the release clears EVERY still-pending level at once, marks each one
//     `emergency`, and names the super admin as the decider — not as an
//     approver of offices they do not hold, which is why the flag exists;
//   * ⚠ THE PASS'S OWN STATUS DOES NOT MOVE. It stays `pending`. That is the
//     whole trick: clearing the rows makes `pass_awaits_approval()` false, so
//     the guard can see it and `match_pass` works normally, WITHOUT an UPDATE
//     grant on `gate_passes`, without tripping `block_unapproved_gate_move`,
//     and without a new enum label. This probe checks the status is untouched
//     and then actually clears the pass through the gate, which is the only way
//     to prove the trigger is not tripped;
//   * THE RELEASER IS REFUSED THEIR OWN REVIEW, and a different admin is not.
//     That one refusal is what makes this an override rather than a bypass;
//   * a review happens once.
//
// ⚠ UNTIL 2026-08-20 THIS DEPLOYMENT HAD NO super_admin ACCOUNT AT ALL, so
// `emergency_release_pass` was invokable by NOBODY and the whole of 055 was
// dead on arrival. `superadmin@quest.vms` was created for the client that day
// and is what this probe signs in as. If that account is ever removed, this
// migration silently stops being reachable again — there is no other holder of
// the privilege.
//
// THIS SCRIPT CREATES AND DELETES NO ACCOUNT. It signs in as an existing super
// admin, and never touches that account's password: a verification script that
// rotates a live credential is a verification script that locks somebody out.
//
// USAGE
//   node scripts/verify-055.mjs [--super-password <pw>]
//
// The password may also come from SUPER_ADMIN_PASSWORD in the environment. It
// is deliberately NOT defaulted to the demo password in source — the highest
// privilege in this app should not have its credential written down in the
// repository.
//
// CLEANUP is one psql line, printed at the end. `emergency_releases` is
// `on delete cascade` from the pass, so deleting the probe pass takes its
// override record with it.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const PW = 'demo123';
const ADMIN = { email: 'admin@demo.vms', password: PW };
const GUARD = { email: 'guard@demo.vms', password: PW };
const HOD = { email: 'hod.it@demo.vms', password: PW };

// The live super admin this probe borrows. Its password is supplied by the
// caller, never stored here.
const SUPER_EMAIL = 'superadmin@quest.vms';
const pwArg = process.argv.indexOf('--super-password');
const SUPER_PW = (pwArg > -1 ? process.argv[pwArg + 1] : process.env.SUPER_ADMIN_PASSWORD) ?? '';
if (!SUPER_PW) {
  console.error(`This probe has to sign in as ${SUPER_EMAIL}.`);
  console.error('Pass its password with --super-password <pw>, or set SUPER_ADMIN_PASSWORD.');
  process.exit(1);
}

const OFFICERS = {
  security_head: { email: 'hod.hr@demo.vms', password: PW },
  coo: { email: 'hod.fin@demo.vms', password: PW },
  ceo: { email: 'ceo@demo.vms', password: PW },
  finance_head: { email: 'staff.it@demo.vms', password: PW },
};

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');
const svc = () => createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function signIn({ email, password }) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

const raised = [];

async function raise(hod, deptId, purpose) {
  const { data, error } = await gp(hod).rpc('raise_pass', {
    p_type: 'RGP',
    p_direction: 'out',
    p_department_id: deptId,
    p_visitor_name: 'Probe 055',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [{ name: 'Probe item', description: 'verify-055 probe line', quantity: 1, unit: 'nos', purpose, expected_return_date: '2026-12-31' }],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  const id = Array.isArray(data) ? (data[0]?.id ?? data[0]) : (data?.id ?? data);
  raised.push(id);
  return id;
}

async function restore(admin, original) {
  for (const key of ['security_head', 'coo', 'ceo', 'finance_head']) {
    await gp(admin).rpc('clear_approval_deputy', { p_role_key: key });
  }
  const want = new Map(original.map((o) => [o.role_key, o]));
  for (const key of ['security_head', 'coo', 'ceo', 'finance_head']) {
    const was = want.get(key);
    if (was?.user_id) await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: was.user_id });
    else await gp(admin).rpc('clear_approval_role', { p_role_key: key });
  }
  for (const key of ['security_head', 'coo', 'ceo', 'finance_head']) {
    const was = want.get(key);
    if (was?.deputy_id) await gp(admin).rpc('set_approval_deputy', { p_role_key: key, p_user_id: was.deputy_id });
  }
}

const snapshot = async (admin) => {
  const { data } = await gp(admin).rpc('get_approval_ladder');
  return (data ?? []).map((o) => ({ role_key: o.role_key, user_id: o.user_id }));
};
const asKey = (rows) => rows.map((o) => `${o.role_key}:${o.user_id}`).sort().join('|');

const REASON = 'Night shift, all four approvers unreachable, perishable stock waiting at the barrier.';

const main = async () => {
  const service = svc();
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);

  const idOf = async (client) => {
    const { data } = await gp(client).rpc('my_profile');
    return Array.isArray(data) ? data[0]?.id : data?.id;
  };

  // ── 0. THE STATE OF THE DEPLOYMENT ─────────────────────────────────────────
  {
    const { data } = await service.schema('public').from('profiles').select('email').eq('role', 'super_admin');
    console.log(`\nsuper admins on this deployment before the probe: ${(data ?? []).length === 0 ? 'NONE — emergency release is invokable by nobody' : (data ?? []).map((r) => r.email).join(', ')}`);
  }

  const superAdmin = await signIn({ email: SUPER_EMAIL, password: SUPER_PW });
  const superId = await idOf(superAdmin);
  const adminId = await idOf(admin);
  console.log(`signed in as the super admin: ${SUPER_EMAIL} (${superId})`);
  {
    // The privilege has to come from the JWT, not from a profiles fallback a
    // stale token would miss. If this is not super_admin, the release below
    // would fail for a reason that has nothing to do with 055.
    const { data } = await gp(superAdmin).rpc('app_role');
    record('the super admin resolves as super_admin through app_role()', data === 'super_admin', `app_role()=${data}`);
  }

  const original = await snapshot(admin);
  const holders = {};
  for (const [key, creds] of Object.entries(OFFICERS)) {
    const client = await signIn(creds);
    holders[key] = { client, id: await idOf(client) };
  }
  for (const key of Object.keys(OFFICERS)) await gp(admin).rpc('clear_approval_deputy', { p_role_key: key });
  for (const [key, h] of Object.entries(holders)) {
    const { error } = await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: h.id });
    if (error) throw new Error(`could not borrow ${key}: ${error.message}`);
  }

  const { data: depts } = await gp(hod).from('hod_departments').select('department_id');
  const deptId = depts?.[0]?.department_id;
  if (!deptId) throw new Error('the probe HOD holds no department');

  const passId = await raise(hod, deptId, 'verify-055 emergency release probe');

  // ── 1. The pass is genuinely stuck, and the guard cannot see it ────────────
  {
    const { data } = await gp(guard).from('v_gate_passes').select('id').eq('id', passId);
    record(
      'before release, the GUARD cannot see the stuck pass',
      (data ?? []).length === 0,
      `rows=${(data ?? []).length}`,
    );
  }

  // ── 2. THE POOL: everybody below super_admin is refused ───────────────────
  {
    const { error } = await gp(hod).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record('an HOD cannot emergency-release a pass', !!error, error ? `refused: ${error.message}` : 'AN HOD RELEASED IT');
  }
  {
    const { error } = await gp(guard).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record('a guard cannot emergency-release a pass', !!error, error ? `refused: ${error.message}` : 'A GUARD RELEASED IT');
  }
  {
    const { error } = await gp(admin).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record(
      'an ORDINARY ADMIN cannot emergency-release a pass (039’s inline super_admin form)',
      !!error,
      error ? `refused: ${error.message}` : 'AN ORDINARY ADMIN RELEASED IT — is_admin() has crept in',
    );
  }
  {
    const { error } = await gp(holders.coo.client).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record('an office holder cannot emergency-release a pass', !!error, error ? `refused: ${error.message}` : 'AN APPROVER RELEASED IT');
  }

  // ── 3. THE REASON is not optional ──────────────────────────────────────────
  {
    const { error } = await gp(superAdmin).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: 'urgent' });
    record('a reason under ten characters is refused', !!error, error ? `refused: ${error.message}` : 'A SIX-CHARACTER REASON WAS ACCEPTED');
  }
  {
    const { error } = await gp(superAdmin).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: '              ' });
    record('a reason of pure whitespace is refused', !!error, error ? `refused: ${error.message}` : 'WHITESPACE WAS ACCEPTED AS A REASON');
  }

  // ── 4. The release ─────────────────────────────────────────────────────────
  {
    const { error } = await gp(superAdmin).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record('THE SUPER ADMIN RELEASES THE PASS', !error, error?.message);
    if (error) throw new Error('cannot continue — the release itself failed');
  }
  {
    const { data, error } = await gp(admin).from('pass_approvals')
      .select('role_key,status,emergency,decided_by,reason').eq('gate_pass_id', passId);
    const rows = data ?? [];
    const allCleared = rows.length === 4 && rows.every((r) => r.status === 'approved');
    const allMarked = rows.every((r) => r.emergency === true && r.decided_by === superId && r.reason === REASON);
    record(
      'every still-pending level is cleared at once, marked `emergency`, and carries the reason',
      !error && allCleared && allMarked,
      error?.message ?? `rows=${rows.length} cleared=${allCleared} marked=${allMarked} :: ${JSON.stringify(rows.map((r) => [r.role_key, r.status, r.emergency]))}`,
    );
  }

  // ── 5. ⚠ THE PASS'S OWN STATUS DID NOT MOVE ────────────────────────────────
  {
    const { data } = await gp(admin).from('v_gate_passes').select('status').eq('id', passId);
    record(
      'the pass is STILL `pending` — the release moves no status (055’s whole trick)',
      data?.[0]?.status === 'pending',
      `status=${data?.[0]?.status}`,
    );
  }

  // ── 6. The record of the override, and who can read it ─────────────────────
  {
    const { data, error } = await gp(admin).from('emergency_releases').select('*').eq('gate_pass_id', passId);
    const row = (data ?? [])[0];
    record(
      'an emergency_releases row is written, naming the releaser and the reason',
      !error && row?.released_by === superId && row?.reason === REASON && !row?.reviewed_at,
      error?.message ?? `row=${JSON.stringify(row)}`,
    );
  }
  {
    // can_see_pass inherits gate_passes_select, and the guard can now see the
    // pass — so the guard can see WHY it reached them.
    const { data } = await gp(guard).from('emergency_releases').select('gate_pass_id').eq('gate_pass_id', passId);
    record('the guard can read the override that put the pass in front of them', (data ?? []).length === 1, `rows=${(data ?? []).length}`);
  }

  // ── 7. The gate can now see it, scan it, and CLEAR it ──────────────────────
  {
    const { data } = await gp(guard).from('v_gate_passes').select('id,pass_number').eq('id', passId);
    record('THE GUARD CAN NOW SEE THE RELEASED PASS', (data ?? []).length === 1, `rows=${(data ?? []).length}`);
  }
  {
    const { data: rows } = await gp(admin).from('v_gate_passes').select('pass_number').eq('id', passId);
    const { data, error } = await gp(guard).rpc('lookup_pass', { p_code: rows?.[0]?.pass_number });
    const row = Array.isArray(data) ? data[0] : data;
    record(
      'lookup_pass no longer answers awaiting_approval, and hands over the id',
      !error && row?.outcome !== 'awaiting_approval' && !!row?.pass_id,
      error?.message ?? `row=${JSON.stringify(row)}`,
    );
  }
  {
    // The real proof that `block_unapproved_gate_move` is not tripped: no
    // status was moved by the release, so the trigger has nothing to object to.
    const { error } = await gp(guard).rpc('match_pass', {
      p_pass_id: passId,
      p_lines: null,
      p_vehicle: null,
      p_remarks: 'verify-055 probe',
      p_gate_name: null,
      p_device_info: null,
      p_checks: null,
    });
    record(
      'match_pass CLEARS the released pass — the unapproved-move trigger is not tripped',
      !error,
      error?.message,
    );
  }

  // ── 8. A pass owing nothing cannot be released again ───────────────────────
  {
    const { error } = await gp(superAdmin).rpc('emergency_release_pass', { p_pass_id: passId, p_reason: REASON });
    record('the same pass cannot be released twice', !!error, error ? `refused: ${error.message}` : 'A SECOND OVERRIDE WAS WRITTEN');
  }

  // ── 9. THE FOUR-EYES CONTROL ───────────────────────────────────────────────
  {
    const { error } = await gp(hod).rpc('review_emergency_release', { p_pass_id: passId, p_note: 'looks fine' });
    record('an HOD cannot review an emergency release', !!error, error ? `refused: ${error.message}` : 'A NON-ADMIN REVIEWED IT');
  }
  {
    const { error } = await gp(superAdmin).rpc('review_emergency_release', { p_pass_id: passId, p_note: 'I stand by it' });
    record(
      'THE RELEASER IS REFUSED THEIR OWN REVIEW — the control this migration exists for',
      !!error,
      error ? `refused: ${error.message}` : 'THE RELEASER REVIEWED THEMSELVES — this is a bypass, not an override',
    );
  }
  {
    const { error } = await gp(admin).rpc('review_emergency_release', { p_pass_id: passId, p_note: 'Checked against the shift log; the escalation was genuine.' });
    record('a DIFFERENT admin can review it', !error, error?.message);
  }
  {
    const { data } = await gp(admin).from('emergency_releases').select('reviewed_by,reviewed_at,review_note').eq('gate_pass_id', passId);
    const row = (data ?? [])[0];
    record(
      'the review names the reviewer and the moment',
      row?.reviewed_by === adminId && !!row?.reviewed_at && !!row?.review_note,
      `row=${JSON.stringify(row)}`,
    );
  }
  {
    const { error } = await gp(admin).rpc('review_emergency_release', { p_pass_id: passId, p_note: 'second thoughts' });
    record('a release is reviewed once and cannot be re-reviewed', !!error, error ? `refused: ${error.message}` : 'A LATER NOTE REPLACED THE FIRST');
  }

  // ── 10. The review queue ───────────────────────────────────────────────────
  {
    const { error } = await gp(hod).rpc('list_emergency_releases');
    record('an HOD cannot read the emergency release log', !!error, error ? `refused: ${error.message}` : 'A NON-ADMIN READ THE OVERRIDE LOG');
  }
  {
    const { data, error } = await gp(admin).rpc('list_emergency_releases');
    const mine = (data ?? []).find((r) => r.gate_pass_id === passId);
    record(
      'an admin reads it back with both names on it',
      !error && !!mine && !!mine.released_name && !!mine.reviewed_name,
      error?.message ?? `row=${JSON.stringify(mine)}`,
    );
  }

  // ── 11. A pass that owes nothing at all ────────────────────────────────────
  {
    const { error } = await gp(superAdmin).rpc('emergency_release_pass', {
      p_pass_id: '00000000-0000-0000-0000-000000000000',
      p_reason: REASON,
    });
    record('releasing a pass that does not exist is refused', !!error, error ? `refused: ${error.message}` : 'A GHOST PASS WAS RELEASED');
  }

  await restore(admin, original);
  {
    const now = await snapshot(admin);
    record('the ladder is left exactly as it was found', asKey(now) === asKey(original), `now=${asKey(now)}\n        was=${asKey(original)}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log('\nPROBE PASSES RAISED — a raised pass is permanent (024), so remove them with psql.');
  console.log('Their emergency_releases rows cascade away with them:');
  console.log(`  delete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e);
  try {
    const admin = await signIn(ADMIN);
    const { data } = await gp(admin).rpc('get_approval_ladder');
    console.error('\nLADDER NOW:', JSON.stringify(data));
  } catch {
    /* nothing more this script can do */
  }
  if (raised.length) console.error(`\ndelete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  process.exit(1);
});
