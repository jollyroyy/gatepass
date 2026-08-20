// Live verification probe for migration 054 — an approval office may have ONE
// standing deputy, and that deputy inherits the office's whole workflow.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. That is
// the entire point of this file: 054's rules live in `is_admin()` guards,
// `my_approval_role()` and RLS, and postgres bypasses every one of them, so the
// psql apply that installed this migration could not prove a single line of it.
//
// What has to hold for a browser client:
//
//   * ONE PERSON, ONE SEAT, in BOTH directions — the office holder cannot be
//     made a deputy and the deputy cannot be made a holder, whichever way round
//     the admin tries it, and neither can somebody already seated elsewhere.
//     This is 049's uniqueness argument extended: `my_approval_role()` is a
//     scalar over a query that can yield several rows, and Postgres returns an
//     arbitrary one, so a dual-seated person would act on exactly one seat,
//     silently. The property that falls out is the load-bearing one: no human
//     can ever sign two rungs of the same pass.
//   * a deputy APPROVES a level their principal never touched, and the record
//     says they signed as the deputy (`decided_as_deputy`), because both seats
//     move and the seat is a fact about the moment of the decision;
//   * the SLIP ORDER binds a deputy exactly as it binds a holder — a deputy of
//     a later office is refused ahead of an earlier one;
//   * a deputy can SEE the pass routed to their office (046's
//     `gate_passes_select` reaches them through `my_approval_role()`), which is
//     the half a `set_approval_deputy` that merely wrote a row would not give;
//   * designating a deputy is ADMIN-ONLY, and an office nobody holds cannot
//     take one.
//
// IT BORROWS THE FOUR OFFICES AND HANDS THEM BACK, the rule verify-043 and
// verify-046 both follow: the live holders are real accounts this script has no
// password for, so the ladder is re-pointed at demo accounts for the length of
// the run and restored — on the happy path AND from the crash handler, because
// a probe that dies half way through must not leave a live gate pass system
// routing approvals to a demo account.
//
// CLEANUP: a raised pass is permanent in this app (024) — no client holds
// DELETE — so this probe cannot remove what it raises. It prints the exact psql
// at the end and names every pass it created.
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

// The four offices, borrowed. FOUR DISTINCT ACCOUNTS, none of them the guard or
// the raising HOD above — an office holder can see what is routed to them, so
// lending an office to a probe subject makes checks pass for the wrong reason
// (the mistake verify-046's first run actually made).
const OFFICERS = {
  security_head: { email: 'hod.hr@demo.vms', password: PW },
  coo: { email: 'hod.fin@demo.vms', password: PW },
  ceo: { email: 'ceo@demo.vms', password: PW },
  finance_head: { email: 'staff.it@demo.vms', password: PW },
};

// The stand-in, and a spare body for the seat-refusal checks. Neither holds any
// office at the start of the run.
const DEPUTY = { email: 'delegate.it@demo.vms', password: PW };
const SPARE = { email: 'staff.hr@demo.vms', password: PW };

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
    p_visitor_name: 'Probe 054',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [{ name: 'Probe item', description: 'verify-054 probe line', quantity: 1, unit: 'nos', purpose, expected_return_date: '2026-12-31' }],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  const id = Array.isArray(data) ? (data[0]?.id ?? data[0]) : (data?.id ?? data);
  raised.push(id);
  return id;
}

/** Put every borrowed office AND every deputy seat back exactly as found.
 *  Deputies are cleared FIRST: restoring a holder who is currently somebody's
 *  deputy would be refused by 054's own one-seat rule. */
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
  // Only after every holder is back can a deputy that was there before be
  // re-seated — the same ordering reason as above.
  for (const key of ['security_head', 'coo', 'ceo', 'finance_head']) {
    const was = want.get(key);
    if (was?.deputy_id) await gp(admin).rpc('set_approval_deputy', { p_role_key: key, p_user_id: was.deputy_id });
  }
}

const snapshot = async (admin) => {
  const { data } = await gp(admin).rpc('get_approval_ladder');
  return (data ?? []).map((o) => ({ role_key: o.role_key, user_id: o.user_id, deputy_id: o.deputy_id ?? null }));
};
const asKey = (rows) =>
  rows.map((o) => `${o.role_key}:${o.user_id}:${o.deputy_id ?? '-'}`).sort().join('|');

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);

  const idOf = async (client) => {
    const { data } = await gp(client).rpc('my_profile');
    return Array.isArray(data) ? data[0]?.id : data?.id;
  };

  const original = await snapshot(admin);
  console.log(`\nladder before the probe: ${original.map((o) => `${o.role_key}${o.deputy_id ? '(+deputy)' : ''}`).join(', ') || '(empty)'}\n`);

  const holders = {};
  for (const [key, creds] of Object.entries(OFFICERS)) {
    const client = await signIn(creds);
    holders[key] = { client, id: await idOf(client), email: creds.email };
  }
  const deputyClient = await signIn(DEPUTY);
  const deputyId = await idOf(deputyClient);
  const spareClient = await signIn(SPARE);
  const spareId = await idOf(spareClient);

  // Borrow. Any pre-existing deputy is cleared first, for the same one-seat
  // ordering reason restore() has.
  for (const key of Object.keys(OFFICERS)) {
    await gp(admin).rpc('clear_approval_deputy', { p_role_key: key });
  }
  for (const [key, h] of Object.entries(holders)) {
    const { error } = await gp(admin).rpc('set_approval_role', { p_role_key: key, p_user_id: h.id });
    if (error) throw new Error(`could not borrow ${key}: ${error.message}`);
  }

  // ── 1. Designating a deputy is admin-only ──────────────────────────────────
  {
    const { error } = await gp(hod).rpc('set_approval_deputy', { p_role_key: 'coo', p_user_id: deputyId });
    record(
      'an HOD cannot designate a deputy',
      !!error,
      error ? `refused: ${error.message}` : 'A NON-ADMIN SEATED A DEPUTY',
    );
  }
  {
    const { error } = await gp(guard).rpc('clear_approval_deputy', { p_role_key: 'coo' });
    record(
      'a guard cannot clear a deputy',
      !!error,
      error ? `refused: ${error.message}` : 'A NON-ADMIN CLEARED A DEPUTY SEAT',
    );
  }

  // ── 2. The office's own holder cannot be its deputy ────────────────────────
  {
    const { error } = await gp(admin).rpc('set_approval_deputy', { p_role_key: 'coo', p_user_id: holders.coo.id });
    record(
      "an office's own holder cannot be its deputy",
      !!error,
      error ? `refused: ${error.message}` : 'THE HOLDER WAS SEATED AS THEIR OWN STAND-IN',
    );
  }

  // ── 3. Somebody holding another office cannot be a deputy ──────────────────
  {
    const { error } = await gp(admin).rpc('set_approval_deputy', { p_role_key: 'coo', p_user_id: holders.ceo.id });
    record(
      'a person holding another office cannot be seated as a deputy',
      !!error,
      error ? `refused: ${error.message}` : 'ONE PERSON NOW HOLDS TWO SEATS',
    );
  }

  // ── 4. The deputy is seated ────────────────────────────────────────────────
  // On the COO — level 2 — deliberately, so the slip-order check below has an
  // earlier rung that must be signed first.
  {
    const { error } = await gp(admin).rpc('set_approval_deputy', { p_role_key: 'coo', p_user_id: deputyId });
    record('an admin seats a standing deputy on the COO office', !error, error?.message);
    if (error) throw new Error('cannot continue without the deputy seated');
  }

  // ── 5. …and now the refusal bites in the OTHER direction ───────────────────
  {
    const { error } = await gp(admin).rpc('set_approval_role', { p_role_key: 'ceo', p_user_id: deputyId });
    record(
      'a standing deputy cannot then be made an office HOLDER',
      !!error,
      error ? `refused: ${error.message}` : 'THE DEPUTY WAS ALSO SEATED AS A HOLDER — one person, two rungs',
    );
  }
  {
    const { error } = await gp(admin).rpc('set_approval_deputy', { p_role_key: 'ceo', p_user_id: deputyId });
    record(
      'a standing deputy cannot be deputy of a SECOND office',
      !!error,
      error ? `refused: ${error.message}` : 'ONE PERSON IS NOW DEPUTY OF TWO OFFICES',
    );
  }

  // ── 6. get_approval_ladder reports the seat ────────────────────────────────
  {
    const rows = await snapshot(admin);
    const coo = rows.find((r) => r.role_key === 'coo');
    record(
      'the ladder reports the deputy against the office',
      coo?.deputy_id === deputyId,
      `coo.deputy_id=${coo?.deputy_id} expected=${deputyId}`,
    );
  }

  const { data: depts } = await gp(hod).from('hod_departments').select('department_id');
  const deptId = depts?.[0]?.department_id;
  if (!deptId) throw new Error('the probe HOD holds no department');

  const passId = await raise(hod, deptId, 'verify-054 deputy probe');

  // ── 7. A deputy can SEE what is routed to their office ─────────────────────
  {
    const { data, error } = await gp(deputyClient).from('v_gate_passes').select('id').eq('id', passId);
    record(
      'the deputy can READ the pass routed to their office',
      !error && (data ?? []).length === 1,
      error?.message ?? `rows=${(data ?? []).length}`,
    );
  }
  {
    // The spare holds no seat at all, so the same read must come back empty.
    const { data, error } = await gp(spareClient).from('v_gate_passes').select('id').eq('id', passId);
    record(
      '…and somebody holding no seat cannot',
      !error && (data ?? []).length === 0,
      error?.message ?? `rows=${(data ?? []).length}`,
    );
  }

  // ── 8. THE SLIP ORDER BINDS A DEPUTY EXACTLY AS IT BINDS A HOLDER ──────────
  {
    const { error } = await gp(deputyClient).rpc('approve_pass_level', { p_pass_id: passId });
    record(
      'the COO deputy is REFUSED ahead of the Security Head',
      !!error,
      error ? `refused: ${error.message}` : 'A DEPUTY JUMPED THE LADDER',
    );
  }

  // ── 9. The core: the deputy signs a rung the principal never touched ───────
  {
    const { error } = await gp(holders.security_head.client).rpc('approve_pass_level', { p_pass_id: passId });
    if (error) throw new Error(`the Security Head could not sign level 1: ${error.message}`);
  }
  {
    const { error } = await gp(deputyClient).rpc('approve_pass_level', { p_pass_id: passId });
    record(
      'THE DEPUTY APPROVES THE COO RUNG — a level their principal never touched',
      !error,
      error?.message,
    );
  }
  {
    const { data, error } = await gp(hod).from('pass_approvals')
      .select('role_key,status,decided_by,decided_as_deputy')
      .eq('gate_pass_id', passId).eq('role_key', 'coo');
    const row = (data ?? [])[0];
    record(
      'the record says it was signed AS THE DEPUTY, and names them',
      !error && row?.status === 'approved' && row?.decided_as_deputy === true && row?.decided_by === deputyId,
      error?.message ?? `status=${row?.status} decided_as_deputy=${row?.decided_as_deputy} decided_by=${row?.decided_by} (deputy=${deputyId}, principal=${holders.coo.id})`,
    );
  }
  {
    // The holder's own rung is untouched by their deputy having signed it —
    // there is one row per office, not one per person.
    const { data } = await gp(hod).from('pass_approvals')
      .select('role_key,status,decided_as_deputy').eq('gate_pass_id', passId).order('level_no');
    const secHead = (data ?? []).find((r) => r.role_key === 'security_head');
    record(
      'the Security Head rung is still marked signed by the HOLDER, not a deputy',
      secHead?.status === 'approved' && secHead?.decided_as_deputy === false,
      `security_head status=${secHead?.status} decided_as_deputy=${secHead?.decided_as_deputy}`,
    );
  }

  // ── 10. The principal cannot sign the rung their deputy already signed ─────
  {
    const { error } = await gp(holders.coo.client).rpc('approve_pass_level', { p_pass_id: passId });
    record(
      'the COO cannot re-sign the rung their deputy already signed',
      !!error,
      error ? `refused: ${error.message}` : 'THE SAME RUNG WAS SIGNED TWICE',
    );
  }

  // ── 11. Clearing the seat takes the authority away ─────────────────────────
  {
    await gp(admin).rpc('clear_approval_deputy', { p_role_key: 'coo' });
    const { data } = await gp(deputyClient).from('v_gate_passes').select('id').eq('id', passId);
    record(
      'clearing the deputy seat takes the pass out of their sight again',
      (data ?? []).length === 0,
      `rows=${(data ?? []).length}`,
    );
  }

  // ── 12. Hand everything back ───────────────────────────────────────────────
  await restore(admin, original);
  {
    const now = await snapshot(admin);
    record(
      'the ladder and every deputy seat are left exactly as they were found',
      asKey(now) === asKey(original),
      `now=${asKey(now)}\n        was=${asKey(original)}`,
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (raised.length) {
    console.log('\nPROBE PASSES RAISED — a raised pass is permanent (024), so remove them with psql:');
    console.log(`  delete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  }
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error(e);
  try {
    const admin = await signIn(ADMIN);
    const { data } = await gp(admin).rpc('get_approval_ladder');
    console.error('\nLADDER NOW:', JSON.stringify(data));
    console.error('If it names demo accounts, restore it in Admin -> Users -> Gate pass approval ladder.');
  } catch {
    /* nothing more this script can do */
  }
  if (raised.length) {
    console.error(`\ndelete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  }
  process.exit(1);
});
