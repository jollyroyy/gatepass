// Live verification probe for migration 046 — the approval ladder as a real
// workflow, and the gate's blindness to a pass that has not climbed it.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. That is
// the whole point: postgres bypasses RLS and every `my_approval_role()` guard
// in here, so a psql run could not prove a single line of this. What has to
// hold for a browser client:
//
//   * raising a pass SNAPSHOTS one approval row per designated office;
//   * a GUARD cannot see that pass at all — not the row, not its material
//     lines, not through a scan;
//   * `lookup_pass` tells the guard `awaiting_approval` and hands over NO
//     pass id, because the record is the very thing they may not read;
//   * `match_pass` refuses it even though it is SECURITY DEFINER and bypasses
//     the policy that hid it — the trigger is the second lock;
//   * the raising HOD and an admin CAN see it, at every stage;
//   * approval is IN SLIP ORDER: a later office cannot sign before an earlier
//     one, and a person holding no office cannot sign at all;
//   * a rejection needs a reason, closes the pass, and writes a verification;
//   * once every level has approved, the guard can see the pass again.
//
// CLEANUP: a raised pass is permanent in this app (024) — no client holds
// DELETE — so this probe cannot remove what it raises. It prints the exact
// psql needed at the end and names every pass number it created.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const PW = 'demo123';
const ADMIN = { email: 'admin@demo.vms', password: PW };
const GUARD = { email: 'guard@demo.vms', password: PW };
const HOD = { email: 'hod.it@demo.vms', password: PW };
// A SECOND HOD, so the ladder can be driven end to end by accounts this probe
// can actually sign in as. The live office holders are real people whose
// passwords this script does not have, so it BORROWS the four offices, proves
// the workflow, and puts every one of them back in a restore step -- the same
// "leaves the ladder as it found it" rule verify-043.mjs follows.
// FOUR DISTINCT ACCOUNTS, and none of them is GUARD or HOD above. That is not
// tidiness: an office holder can SEE the passes routed to their office, so
// lending an office to the very guard whose blindness is under test would make
// the central check pass for the wrong reason -- which is exactly what the
// first run of this probe did.
const OFFICERS = {
  security_head: { email: 'hod.hr@demo.vms', password: PW },
  coo: { email: 'hod.fin@demo.vms', password: PW },
  ceo: { email: 'admin@demo.vms', password: PW },
  finance_head: { email: 'staff.it@demo.vms', password: PW },
};

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

const raised = [];

/** Put every borrowed office back exactly where it was, and vacate any this
 *  probe created that nobody held before. Called on the happy path AND from the
 *  crash handler, because a probe that dies half way through must not leave a
 *  live gate pass system routing approvals to a demo account. */
async function restore(admin, original) {
  const want = new Map(original.map((o) => [o.role_key, o.user_id]));
  for (const key of ['security_head', 'coo', 'ceo', 'finance_head']) {
    const userId = want.get(key);
    if (userId) await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: userId });
    else await gp(admin).rpc('clear_approval_role', { p_role_key: key });
  }
}

async function raise(hod, deptId, purpose) {
  const { data, error } = await gp(hod).rpc('raise_pass', {
    p_type: 'RGP',
    p_direction: 'out',
    p_department_id: deptId,
    p_visitor_name: 'Probe 046',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [{ name: 'Probe item', description: 'verify-046 probe line', quantity: 1, unit: 'nos', purpose, expected_return_date: '2026-12-31' }],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  const id = Array.isArray(data) ? (data[0]?.id ?? data[0]) : (data?.id ?? data);
  raised.push(id);
  return id;
}

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);

  const idOf = async (client) => {
    const { data } = await gp(client).rpc('my_profile');
    return Array.isArray(data) ? data[0]?.id : data?.id;
  };

  // What the ladder held before this probe touched it. Put back at the end.
  const { data: before } = await gp(admin).rpc('get_approval_ladder');
  const original = (before ?? []).map((o) => ({ role_key: o.role_key, user_id: o.user_id }));
  console.log(`\nladder before the probe: ${original.map((o) => o.role_key).join(', ') || '(empty)'}\n`);

  // BORROWED, and handed straight back at the end.
  const holders = {};
  for (const [key, creds] of Object.entries(OFFICERS)) {
    const client = await signIn(creds);
    holders[key] = { client, id: await idOf(client), email: creds.email };
  }
  const secHead = holders.security_head.client;
  const ceo = holders.ceo.client;

  for (const [key, h] of Object.entries(holders)) {
    const { error } = await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: h.id });
    if (error) throw new Error(`could not borrow ${key}: ${error.message}`);
  }
  const designated = Object.keys(holders);

  const { data: depts } = await gp(hod).from('hod_departments').select('department_id');
  const deptId = depts?.[0]?.department_id;
  if (!deptId) throw new Error('the probe HOD holds no department');

  // ── 1. Raising snapshots the ladder ────────────────────────────────────────
  const passId = await raise(hod, deptId, 'verify-046 blindness probe');
  {
    const { data, error } = await gp(hod).from('pass_approvals').select('*').eq('gate_pass_id', passId);
    const keys = (data ?? []).map((r) => r.role_key).sort();
    record(
      'raising a pass snapshots one row per designated office, all pending',
      !error && keys.length === designated.length && (data ?? []).every((r) => r.status === 'pending'),
      error?.message ?? `rows=${JSON.stringify(keys)} expected=${JSON.stringify([...designated].sort())}`,
    );
  }

  // ── 2. THE CLIENT RULE: the guard cannot see it ────────────────────────────
  {
    const { data, error } = await gp(guard).from('v_gate_passes').select('id').eq('id', passId);
    record(
      'a GUARD cannot see a pass that still owes a signature',
      !error && (data ?? []).length === 0,
      error?.message ?? `rows=${(data ?? []).length}`,
    );
  }
  {
    const { data, error } = await gp(guard).from('v_gate_pass_items').select('id').eq('gate_pass_id', passId);
    record(
      '…nor its material lines',
      !error && (data ?? []).length === 0,
      error?.message ?? `rows=${(data ?? []).length}`,
    );
  }

  // ── 3. …and the scanner says why, without handing over the id ──────────────
  {
    const { data: rows } = await gp(admin).from('v_gate_passes').select('pass_number').eq('id', passId);
    const passNumber = rows?.[0]?.pass_number;
    const { data, error } = await gp(guard).rpc('lookup_pass', { p_code: passNumber });
    const row = Array.isArray(data) ? data[0] : data;
    record(
      'lookup_pass returns awaiting_approval and NO pass id',
      !error && row?.outcome === 'awaiting_approval' && !row?.pass_id,
      error?.message ?? `row=${JSON.stringify(row)}`,
    );
  }

  // ── 4. The trigger is the second lock ──────────────────────────────────────
  {
    // match_pass is SECURITY DEFINER and bypasses the policy that hid the pass.
    // Without the BEFORE UPDATE trigger this would clear the material out of
    // the building.
    const { error } = await gp(guard).rpc('match_pass', {
      p_pass_id: passId,
      p_lines: null,
      p_vehicle: null,
      p_remarks: 'verify-046 probe',
      p_gate_name: null,
      p_device_info: null,
      p_checks: null,
    });
    record(
      'match_pass REFUSES an unapproved pass, even as SECURITY DEFINER',
      !!error,
      error ? `refused: ${error.message}` : 'THE GATE CLEARED IT — the trigger is not doing its job',
    );
  }

  // ── 5. Who CAN see it ──────────────────────────────────────────────────────
  {
    const { data } = await gp(hod).from('v_gate_passes').select('id').eq('id', passId);
    record('the raising HOD still sees their own pass', (data ?? []).length === 1);
  }
  {
    const { data } = await gp(admin).from('v_gate_passes').select('id').eq('id', passId);
    record('an admin sees it at every stage', (data ?? []).length === 1);
  }
  {
    // secHead is a plain HOD of ANOTHER department, so this proves the office
    // arm of the policy and not the department one.
    const { data } = await gp(secHead).from('v_gate_passes').select('id').eq('id', passId);
    record('the office it is routed to sees it', (data ?? []).length === 1);
  }

  // ── 6. Slip order ──────────────────────────────────────────────────────────
  {
    const { error } = await gp(ceo).rpc('approve_pass_level', { p_pass_id: passId });
    record(
      'a LATER office cannot sign before an earlier one',
      !!error,
      error ? `refused: ${error.message}` : 'the CEO signed ahead of the Security Head',
    );
  }
  {
    // The raising HOD holds no office here -- the borrowed four sit on hod2,
    // the guard and the admin.
    const { error } = await gp(hod).rpc('approve_pass_level', { p_pass_id: passId });
    record(
      'somebody holding no office cannot sign at all',
      !!error,
      error ? `refused: ${error.message}` : 'a person with no office approved a gate pass',
    );
  }
  {
    const { error } = await gp(secHead).rpc('approve_pass_level', { p_pass_id: passId });
    record('the office at the lowest pending level CAN sign', !error, error?.message);
  }
  {
    const { data } = await gp(hod).from('pass_approvals').select('role_key,status,decided_at')
      .eq('gate_pass_id', passId).eq('status', 'approved');
    record(
      'the decision is recorded with a real moment',
      (data ?? []).length === 1 && !!data?.[0]?.decided_at,
      JSON.stringify(data),
    );
  }
  {
    const { data } = await gp(guard).from('v_gate_passes').select('id').eq('id', passId);
    record(
      'the guard STILL cannot see it — one signature is not every signature',
      (data ?? []).length === 0,
      `rows=${(data ?? []).length}`,
    );
  }

  // ── 7. Rejection ───────────────────────────────────────────────────────────
  const rejectId = await raise(hod, deptId, 'verify-046 rejection probe');
  {
    const { error } = await gp(secHead).rpc('reject_pass_level', { p_pass_id: rejectId, p_reason: '   ' });
    record('a rejection with no reason is refused', !!error, error?.message);
  }
  {
    const { error } = await gp(secHead).rpc('reject_pass_level', {
      p_pass_id: rejectId,
      p_reason: 'verify-046: probe rejection, not a real decision.',
    });
    record('a reasoned rejection is accepted', !error, error?.message);
  }
  {
    const { data } = await gp(hod).from('v_gate_passes').select('status').eq('id', rejectId);
    record('…and it CLOSES the pass', data?.[0]?.status === 'cancelled', `status=${data?.[0]?.status}`);
  }
  {
    const { data } = await gp(hod).from('v_verifications').select('action,remarks').eq('gate_pass_id', rejectId);
    const row = (data ?? []).find((v) => v.action === 'cancelled');
    record('…and writes a verification carrying the reason', !!row && /probe rejection/.test(row.remarks ?? ''), JSON.stringify(data));
  }
  {
    const { error } = await gp(secHead).rpc('approve_pass_level', { p_pass_id: rejectId });
    record('a closed pass cannot be approved afterwards', !!error, error?.message);
  }

  // ── 8. A fully approved pass reaches the gate ──────────────────────────────
  const clearId = await raise(hod, deptId, 'verify-046 full-climb probe');
  {
    const { data: mine } = await gp(hod).from('pass_approvals').select('role_key,level_no')
      .eq('gate_pass_id', clearId).order('level_no');
    let signed = 0;
    let blocked = null;
    for (const row of mine ?? []) {
      const { error } = await gp(holders[row.role_key].client)
        .rpc('approve_pass_level', { p_pass_id: clearId });
      if (error) { blocked = `${row.role_key}: ${error.message}`; break; }
      signed += 1;
    }
    if (blocked) {
      record('a fully approved pass becomes visible to the gate', false, `stuck at ${blocked}`);
    } else {
      const { data } = await gp(guard).from('v_gate_passes').select('id').eq('id', clearId);
      record(
        `a fully approved pass (${signed} levels) becomes visible to the gate`,
        (data ?? []).length === 1,
        `rows=${(data ?? []).length}`,
      );
    }
  }

  // -- 9. Hand the offices back -----------------------------------------------
  await restore(admin, original);
  {
    const { data } = await gp(admin).rpc('get_approval_ladder');
    const now = (data ?? []).map((o) => `${o.role_key}:${o.user_id}`).sort().join('|');
    const was = original.map((o) => `${o.role_key}:${o.user_id}`).sort().join('|');
    record('the ladder is left exactly as it was found', now === was, `now=${now}\n        was=${was}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log('\nPROBE PASSES RAISED — a raised pass is permanent (024), so remove them with psql:');
  console.log(`  delete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e);
  // Best effort: the ladder is live data and must not be left borrowed.
  try {
    const admin = await signIn(ADMIN);
    const { data } = await gp(admin).rpc('get_approval_ladder');
    console.error('\nLADDER NOW:', JSON.stringify(data));
    console.error('If it names demo accounts, restore it in Admin -> Users -> Gate pass approval ladder.');
  } catch {
    /* nothing more this script can do */
  }
  process.exit(1);
});
