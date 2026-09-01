// Live verification probe for migration 069 — THE COO AND THE CEO MAY RAISE A
// GATE PASS FOR ANY DEPARTMENT, AND CAN THEN READ WHAT THEY RAISED.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. 069 is
// nothing but an authorization branch inside `raise_pass` plus one new arm on
// each of `gate_passes_select` / `gate_pass_items_select`, and postgres
// bypasses every policy and every `gatepass.app_role()` read — so the psql
// apply that installs this migration cannot prove a single line of it. What
// has to hold for a browser client:
//
//   a. the sitting COO or CEO (`holds_fallback_office()`, 067) raises a pass
//      for a department they do not head → it succeeds, the returned row
//      carries that department_id, and `pass_number`'s middle segment is that
//      department's code (064: TYPE-DEPTCODE-NNNN).
//   b. that same office holder can then read the pass back from
//      `v_gate_passes` and its lines from `v_gate_pass_items` — the whole
//      point of the two new policy arms (`raised_by = auth.uid()` and
//      `gatepass.raised_by_me()`), because they head no department and the
//      pass has not yet reached their own rung on the ladder (061).
//   c. an ordinary HOD is still refused when raising for a department they do
//      not head — 069 widens the door for exactly two offices, nobody else.
//   d. the guard stays blind to the freshly raised pass while it still owes
//      an approval — 046's rule, which the new arms must not have loosened.
//   e. a plain HOD who neither raised the pass nor heads its department, and
//      whose own department is a different one again, cannot see it either.
//   f. raising against a uuid that names no real department is refused with
//      the readable sentence 069 added ahead of the foreign key, not a bare
//      constraint violation.
//
// ⚠ THIS PROBE IS MEANINGLESS UNTIL 069 IS APPLIED, and it is also meaningless
// unless the office it signs in as is ACTUALLY SEATED: `holds_fallback_office`
// (067) is true only for a user_id sitting in `gatepass.approval_roles` under
// 'coo' or 'ceo' (a deputy or a delegate does not count, on purpose — see 067).
// If nobody currently holds either office on this deployment, every check
// below that expects a COO/CEO success will FAIL for a reason that has
// nothing to do with 069's own logic, and that failure is the correct signal
// to go seat one, not to suspect this script.
//
// THE ACCOUNT THIS PROBE SIGNS IN AS IS A GUESS, NOT A KNOWN LIVE ACCOUNT.
// Unlike verify-055's `superadmin@quest.vms`, this script was written without
// access to whichever real person currently holds the COO or CEO seat, so
// PROBE_COO_EMAIL / PROBE_COO_PASSWORD below are placeholders following this
// deployment's `role.dept@demo.vms` / `demo123` demo-account convention and
// MUST be overridden with the real holder's credentials via the environment
// (or `--coo-email` / `--coo-password`) before this probe means anything. A
// sign-in failure exits immediately with the constant named, rather than
// reporting a wall of misleading FAILs for every check downstream of it.
//
// CLEANUP: a raised pass is permanent in this app (024) — no client holds
// DELETE on gate_passes — so this probe prints the exact psql at the end and
// names every pass it created.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const PW = 'demo123';
const ADMIN = { email: 'admin@demo.quest', password: PW };
const GUARD = { email: 'guard@demo.vms', password: PW };
// The raising HOD's own department (IT) is the one the probe office holder
// asks to raise for instead — proving the widened branch, not the ordinary one.
const HOD = { email: 'hod.it@demo.vms', password: PW };
// A second, unrelated HOD: a different department, and no part in raising the
// probe pass. Stands in for check (e).
const OTHER_HOD = { email: 'hod.hr@demo.vms', password: PW };

// The live COO or CEO this probe borrows. Its email and password are NOT
// known facts about this deployment — see the header note above. Override
// both from the environment or the command line before trusting a single
// result out of this script.
const cooEmailArg = process.argv.indexOf('--coo-email');
const cooPwArg = process.argv.indexOf('--coo-password');
const PROBE_COO_EMAIL =
  (cooEmailArg > -1 ? process.argv[cooEmailArg + 1] : process.env.PROBE_COO_EMAIL) ?? 'coo@demo.vms';
const PROBE_COO_PASSWORD =
  (cooPwArg > -1 ? process.argv[cooPwArg + 1] : process.env.PROBE_COO_PASSWORD) ?? PW;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');
const pub = (c) => c.schema('public');

async function signIn({ email, password }) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

const raised = [];

async function raise(client, deptId, purpose) {
  return gp(client).rpc('raise_pass', {
    p_type: 'RGP',
    p_direction: 'out',
    p_department_id: deptId,
    p_visitor_name: 'Probe 069',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [
      {
        name: 'Probe item',
        description: 'verify-069 probe line',
        quantity: 1,
        unit: 'nos',
        purpose,
        expected_return_date: '2026-12-31',
      },
    ],
  });
}

/** Mirrors `gatepass.dept_code()` (064) exactly: `departments.code` uppercased
 *  and stripped to A-Z0-9, capped at 5; failing that the same treatment of
 *  `name`, capped at 4; failing that 'GEN'. Kept here rather than reusing an
 *  app import so this script has no build step and no dependency on `src/`. */
function deptCode(code, name) {
  const strip = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fromCode = strip(code).slice(0, 5);
  if (fromCode) return fromCode;
  const fromName = strip(name).slice(0, 4);
  if (fromName) return fromName;
  return 'GEN';
}

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);
  const otherHod = await signIn(OTHER_HOD);

  let coo;
  try {
    coo = await signIn({ email: PROBE_COO_EMAIL, password: PROBE_COO_PASSWORD });
  } catch (err) {
    console.error(`\nCould not sign in as the probe's COO/CEO account (${PROBE_COO_EMAIL}).`);
    console.error('This script guesses that email — it is not a known live credential.');
    console.error('Override it with PROBE_COO_EMAIL / PROBE_COO_PASSWORD in the environment,');
    console.error('or --coo-email <email> --coo-password <pw> on the command line, and rerun.');
    console.error(`\nsign-in error: ${err.message}`);
    process.exit(1);
  }

  {
    // If this account does not actually sit in `approval_roles` under 'coo'
    // or 'ceo' (067), every success check below will fail for a reason that
    // has nothing to do with 069 — see the header note.
    const { data, error } = await gp(coo).rpc('holds_fallback_office');
    record(
      'the probe account actually holds the COO or CEO office (067)',
      !error && data === true,
      error?.message ?? `holds_fallback_office()=${data}`,
    );
    if (error || data !== true) {
      console.error(`\n${PROBE_COO_EMAIL} does not hold the COO or CEO seat right now.`);
      console.error('Seat it in gatepass.approval_roles (or point PROBE_COO_EMAIL at whoever');
      console.error('currently does) before the checks below can mean anything.');
    }
  }

  // The HOD's own department — the one the COO/CEO is going to raise for
  // instead of their own, since an office holder heads no department at all.
  const { data: hodDepts } = await gp(hod).from('hod_departments').select('department_id');
  const deptId = hodDepts?.[0]?.department_id;
  if (!deptId) throw new Error('the probe HOD (hod.it@demo.vms) holds no department');

  const { data: deptRow } = await pub(admin).from('departments').select('code,name').eq('id', deptId).maybeSingle();
  const expectedCode = deptCode(deptRow?.code, deptRow?.name);

  // A second, unrelated department — the OTHER_HOD's own — used only to prove
  // an ordinary HOD is still refused a department they don't head (check c).
  const { data: otherDepts } = await gp(otherHod).from('hod_departments').select('department_id');
  const otherDeptId = otherDepts?.[0]?.department_id;
  if (!otherDeptId) throw new Error('the probe HOD (hod.hr@demo.vms) holds no department');

  let passId;
  let passNumber;

  // ── a. the office holder raises for a department they do not head ─────────
  {
    const { data, error } = await raise(coo, deptId, 'verify-069 COO/CEO raises for another department');
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id) raised.push(row.id);
    passId = row?.id;
    passNumber = row?.pass_number;
    record(
      'the COO/CEO raises a pass for a department they do not head',
      !error && !!row?.id && row?.department_id === deptId,
      error?.message ?? `department_id=${row?.department_id} expected=${deptId}`,
    );
    record(
      `pass_number's middle segment is the department's code (${expectedCode})`,
      typeof passNumber === 'string' && passNumber.split('-')[1] === expectedCode,
      `pass_number=${passNumber}`,
    );
  }

  if (passId) {
    // ── b. the raiser can read back what they raised ─────────────────────────
    {
      const { data } = await gp(coo).from('v_gate_passes').select('id').eq('id', passId);
      record('the COO/CEO can read the pass back from v_gate_passes', (data ?? []).length === 1, `rows=${(data ?? []).length}`);
    }
    {
      const { data } = await gp(coo).from('v_gate_pass_items').select('id').eq('gate_pass_id', passId);
      record('the COO/CEO can read its material lines from v_gate_pass_items', (data ?? []).length === 1, `rows=${(data ?? []).length}`);
    }

    // ── d. the guard is still blind while the pass owes an approval (046) ────
    {
      const { data } = await gp(guard).from('v_gate_passes').select('id').eq('id', passId);
      record('the guard cannot see the pass while it still owes an approval (046, unchanged)', (data ?? []).length === 0, `rows=${(data ?? []).length}`);
    }

    // ── e. an uninvolved HOD, elsewhere, cannot see it either ─────────────────
    {
      const { data } = await gp(otherHod).from('v_gate_passes').select('id').eq('id', passId);
      record('an HOD who neither raised it nor heads its department cannot see it', (data ?? []).length === 0, `rows=${(data ?? []).length}`);
    }
  }

  // ── c. an ordinary HOD is still refused a department they don't head ──────
  {
    const { error } = await raise(hod, otherDeptId, 'verify-069 an HOD must still be refused another department');
    record(
      'an HOD raising for a department they do not head is still refused',
      !!error && /can only raise a pass for a department you head/i.test(error.message ?? ''),
      error ? `refused: ${error.message}` : 'AN HOD RAISED FOR SOMEBODY ELSE’S DEPARTMENT',
    );
  }

  // ── f. a department id that names nothing real is refused, readably ───────
  {
    const { error } = await raise(coo, '00000000-0000-0000-0000-000000000000', 'verify-069 nonexistent department');
    record(
      "raising against a nonexistent department is refused with 'That department does not exist.'",
      !!error && /that department does not exist/i.test(error.message ?? ''),
      error ? `refused: ${error.message}` : 'A GHOST DEPARTMENT WAS ACCEPTED',
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (raised.length) {
    console.log('\nCLEANUP (no client holds DELETE on gate_passes — run as postgres):');
    console.log(`  delete from gatepass.gate_passes where id in (${raised.map((id) => `'${id}'`).join(', ')});`);
  }
  process.exit(failed ? 1 : 0);
};

main().catch((err) => {
  console.error('\nprobe died:', err.message);
  if (raised.length) {
    console.error('\ndelete from gatepass.gate_passes where id in (' + raised.map((id) => `'${id}'`).join(', ') + ');');
  }
  process.exit(1);
});
