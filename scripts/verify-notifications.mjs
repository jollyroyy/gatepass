// Live probe: when an HOD raises a pass, does the guard's realtime
// postgres_changes subscription actually receive the INSERT event?
//
// Runs as REAL users via the anon-key path (never postgres): guard subscribes
// to INSERTs on gatepass.gate_passes, hod.it raises a pass, and the script
// waits for the event to land on the guard's client. This is the only honest
// proof the notification bell will show a red badge — psql cannot subscribe.
//
// Probe rows cannot be deleted over the anon path (nobody holds DELETE on
// gate_passes); the script prints the psql cleanup at the end.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) { console.error('missing env'); process.exit(1); }

const PASSWORD = 'demo123';
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`); };

async function signIn(label, email) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${label}): ${error.message}`);
  return c;
}

const gp = (c) => c.schema('gatepass');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const hod = await signIn('hod', 'hod.it@demo.vms');
  const guard = await signIn('guard', 'guard@demo.vms');

  // --- Guard subscribes FIRST, before anything is raised ---
  const events = [];
  let subscribeError = null;
  let subscribed = false;
  const ch = guard.channel('notif-probe');
  ch.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'gatepass', table: 'gate_passes' },
    (payload) => {
      const rec = payload?.new;
      events.push({ passId: rec?.id, passNumber: rec?.pass_number, created_at: rec?.created_at });
    },
  );
  ch.subscribe((status) => {
    subscribed = status === 'SUBSCRIBED';
    if (status !== 'SUBSCRIBED' && status !== 'SUBSCRIBING') subscribeError = status;
  });

  // Wait for the channel to reach SUBSCRIBED (or fail).
  for (let i = 0; i < 30 && !subscribed && !subscribeError; i++) await wait(100);
  record('G1: guard channel reaches SUBSCRIBED', subscribed, subscribeError ? `status=${subscribeError}` : 'SUBSCRIBED');

  // --- HOD raises a pass ---
  const { data: depts, error: deptErr } = await gp(hod).from('hod_departments').select('department_id').limit(1);
  if (deptErr || !depts?.[0]) throw new Error(`dept lookup: ${deptErr?.message ?? 'none'}`);
  const expectedReturn = new Date(Date.now() + 3 * 24 * 3600e3).toISOString().slice(0, 10);
  const { data: raised, error: raiseErr } = await gp(hod).rpc('raise_pass', {
    p_type: 'NRGP',
    p_direction: 'out',
    p_department_id: depts[0].department_id,
    p_visitor_name: 'Notif Probe',
    p_visitor_company: null,
    p_vehicle_number: null,
    p_expected_return_date: null,
    p_items: [{ name: 'notif probe item', description: 'notif probe', purpose: 'verification', quantity: 1, unit: 'nos', approx_value: null, expected_return_date: null }],
  });
  if (raiseErr) throw new Error(`raise_pass: ${raiseErr.message}`);
  const passId = raised.id;
  record('H1: HOD raises a pass (status pending, waiting at the gate)',
    raised.status === 'pending' && !!raised.pass_number,
    `id=${passId} status=${raised.status} number=${raised.pass_number}`);

  // --- Wait for the INSERT event to arrive on the GUARD's client ---
  for (let i = 0; i < 100 && events.length === 0; i++) await wait(100);
  const hit = events.find((e) => e.passId === passId);
  record('G2: guard client receives the INSERT realtime event for that pass',
    !!hit, hit ? `pass_number=${hit.passNumber} created_at=${hit.created_at}` : `events=${JSON.stringify(events)}`);

  await guard.removeChannel(ch);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log('CLEANUP (run as postgres via psql — the anon path cannot delete):');
  console.log(`  delete from gatepass.verifications where gate_pass_id = '${passId}';`);
  console.log(`  delete from gatepass.gate_pass_items where gate_pass_id = '${passId}';`);
  console.log(`  delete from gatepass.gate_passes where id = '${passId}';`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
