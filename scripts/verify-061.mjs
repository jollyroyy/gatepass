// Live verification probe for migration 061 — AN APPROVER CANNOT SEE A PASS
// UNTIL IT IS THEIR TURN.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. 061 is
// nothing but an RLS predicate (`pass_routed_to_me`, the approver arm of
// `gate_passes_select`), and postgres bypasses every policy — so the psql apply
// that installed it could not prove a single line of it.
//
// What has to hold for a browser client, on a pass climbing Security Head (1)
// → COO (2) → Finance HOD (3) → CEO (4):
//
//   * on raise, ONLY the Security Head can see the pass, its material lines and
//     its ladder rows. The COO, the Finance HOD and the CEO see NOTHING —
//     not a filtered-out row, an absent one.
//   * each approval reveals the pass to exactly ONE more office, and to no
//     other.
//   * an office that has signed goes on seeing what it signed.
//   * a pass REJECTED below an office stays invisible to it for ever: the turn
//     never reached that desk.
//   * the guard is still blind until the ladder is finished (046, unchanged).
//
// IT BORROWS THE FOUR OFFICES AND HANDS THEM BACK, the rule verify-046 and
// verify-054 both follow: the live holders are real accounts this script has no
// password for. The four demo accounts it borrows to are neither the probe
// guard nor the raising HOD — an office holder can of course see what is routed
// to them, and lending an office to a probe subject makes checks pass for the
// wrong reason (the mistake verify-046's first run actually made).
//
// CLEANUP: a raised pass is permanent in this app (024) — no client holds
// DELETE — so this probe prints the exact psql at the end and names every pass
// it created.
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

const OFFICERS = {
  security_head: { email: 'staff.hr@demo.vms', password: PW },
  coo: { email: 'staff.fin@demo.vms', password: PW },
  finance_head: { email: 'hod2.it@demo.vms', password: PW },
  ceo: { email: 'hod2.hr@demo.vms', password: PW },
};

// The ladder's order since 057. Level numbers are the database's; this array is
// only what the probe walks in.
const ORDER = ['security_head', 'coo', 'finance_head', 'ceo'];

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

async function raise(hod, deptId, purpose) {
  const { data, error } = await gp(hod).rpc('raise_pass', {
    p_type: 'RGP',
    p_direction: 'out',
    p_department_id: deptId,
    p_visitor_name: 'Probe 061',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [
      {
        name: 'Probe item',
        description: 'verify-061 probe line',
        quantity: 1,
        unit: 'nos',
        purpose,
        expected_return_date: '2026-12-31',
      },
    ],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  const id = Array.isArray(data) ? (data[0]?.id ?? data[0]) : (data?.id ?? data);
  raised.push(id);
  return id;
}

/** Can this client see the pass at all — the row, its material lines and its
 *  ladder? All three follow one predicate (`can_see_pass` reaches the same
 *  policy), so a disagreement between them is itself a finding. */
async function visibility(client, passId) {
  const [pass, items, approvals] = await Promise.all([
    gp(client).from('v_gate_passes').select('id').eq('id', passId),
    gp(client).from('v_gate_pass_items').select('id').eq('gate_pass_id', passId),
    gp(client).from('pass_approvals').select('level_no').eq('gate_pass_id', passId),
  ]);
  return {
    pass: (pass.data ?? []).length > 0,
    items: (items.data ?? []).length > 0,
    approvals: (approvals.data ?? []).length > 0,
  };
}

async function restore(admin, original) {
  const want = new Map(original.map((o) => [o.role_key, o]));
  for (const key of ORDER) {
    const was = want.get(key);
    if (was?.user_id) await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: was.user_id });
    else await gp(admin).rpc('clear_approval_role', { p_role_key: key });
  }
  for (const key of ORDER) {
    const was = want.get(key);
    if (was?.deputy_id) await gp(admin).rpc('set_approval_deputy', { p_role_key: key, p_user_id: was.deputy_id });
  }
}

const snapshot = async (admin) => {
  const { data } = await gp(admin).rpc('get_approval_ladder');
  return (data ?? []).map((o) => ({ role_key: o.role_key, user_id: o.user_id, deputy_id: o.deputy_id ?? null }));
};

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);

  const idOf = async (client) => {
    const { data } = await gp(client).rpc('my_profile');
    return Array.isArray(data) ? data[0]?.id : data?.id;
  };

  const original = await snapshot(admin);
  console.log(`\nladder before the probe: ${original.map((o) => o.role_key).join(', ') || '(empty)'}\n`);

  const holders = {};
  for (const [key, creds] of Object.entries(OFFICERS)) {
    const client = await signIn(creds);
    holders[key] = { client, id: await idOf(client), email: creds.email };
  }

  // Clear any deputy first: a deputy is a second seat and would make an office
  // visible through a person this probe is not reasoning about.
  for (const key of ORDER) await gp(admin).rpc('clear_approval_deputy', { p_role_key: key });
  for (const key of ORDER) {
    const { error } = await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: holders[key].id });
    if (error) throw new Error(`could not borrow ${key}: ${error.message}`);
  }

  try {
    const { data: prof } = await gp(hod).rpc('my_profile');
    const deptId = (Array.isArray(prof) ? prof[0] : prof)?.department_id;
    if (!deptId) throw new Error('the probe HOD has no department');

    // ── 1. On raise, only the first office sees anything ─────────────────────
    const passId = await raise(hod, deptId, 'verify-061 linear visibility');

    for (const key of ORDER) {
      const v = await visibility(holders[key].client, passId);
      const expected = key === 'security_head';
      record(
        `on raise, the ${key} ${expected ? 'sees' : 'is blind to'} the pass`,
        v.pass === expected,
        `pass=${v.pass} items=${v.items} approvals=${v.approvals}`,
      );
      if (!expected) {
        record(
          `on raise, the ${key} is blind to its material lines and its ladder too`,
          !v.items && !v.approvals,
          `items=${v.items} approvals=${v.approvals}`,
        );
      }
    }

    {
      const v = await visibility(guard, passId);
      record('the gate is blind to a pass still climbing (046, unchanged)', !v.pass, `pass=${v.pass}`);
    }

    // ── 2. Each approval reveals the pass to exactly one more office ─────────
    for (let i = 0; i < ORDER.length; i += 1) {
      const key = ORDER[i];
      const { error } = await gp(holders[key].client).rpc('approve_pass_level', {
        p_pass_id: passId,
      });
      record(`the ${key} can approve when it is their turn`, !error, error?.message);
      if (error) break;

      for (let j = 0; j < ORDER.length; j += 1) {
        const other = ORDER[j];
        const v = await visibility(holders[other].client, passId);
        // Everybody up to and including the next office may see it now.
        const expected = j <= i + 1;
        record(
          `after ${key} signs, the ${other} ${expected ? 'sees' : 'is still blind to'} the pass`,
          v.pass === expected,
          `pass=${v.pass}`,
        );
      }
    }

    {
      const v = await visibility(guard, passId);
      record('the gate sees the pass once the ladder is finished', v.pass, `pass=${v.pass}`);
    }
    {
      const v = await visibility(holders.security_head.client, passId);
      record('an office goes on seeing what it signed', v.pass, `pass=${v.pass}`);
    }

    // ── 3. A rejection below an office keeps it invisible for ever ───────────
    {
      const rejectedId = await raise(hod, deptId, 'verify-061 rejected at level 1');
      const { error } = await gp(holders.security_head.client).rpc('reject_pass_level', {
        p_pass_id: rejectedId,
        p_reason: 'Probe rejection — verify-061',
      });
      record('the first office can reject', !error, error?.message);

      for (const key of ORDER.slice(1)) {
        const v = await visibility(holders[key].client, rejectedId);
        record(
          `a pass rejected at level 1 stays invisible to the ${key}`,
          !v.pass && !v.items && !v.approvals,
          `pass=${v.pass} items=${v.items} approvals=${v.approvals}`,
        );
      }
      const v = await visibility(holders.security_head.client, rejectedId);
      record('the office that rejected it still sees it', v.pass, `pass=${v.pass}`);
    }
  } finally {
    await restore(admin, original);
    const after = await snapshot(admin);
    const same =
      after.map((o) => `${o.role_key}:${o.user_id}`).sort().join('|') ===
      original.map((o) => `${o.role_key}:${o.user_id}`).sort().join('|');
    record('the ladder was left exactly as it was found', same);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (raised.length) {
    console.log('\nCLEANUP (a pass cannot be deleted by any client — run as postgres):');
    console.log(`  delete from gatepass.gate_passes where id in (${raised.map((id) => `'${id}'`).join(', ')});`);
  }
  process.exit(failed ? 1 : 0);
};

main().catch((err) => {
  console.error('\nprobe died:', err.message);
  process.exit(1);
});
