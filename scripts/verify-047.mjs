// Live verification probe for the approval EMAIL path — migration 047's
// payload function plus the deployed `notify-approval` Edge Function.
//
// RUNS AS A REAL SIGNED-IN HOD OVER THE ANON-KEY PATH. That matters twice
// over: the function authorises by asking the CALLER's own client "can you see
// this pass?" (RLS answering, which is the authority 046 established), and the
// addresses it then reads are behind a function granted to `service_role`
// alone. A `postgres` run would prove neither.
//
// WHAT IT PROVES, END TO END:
//   * raising a pass snapshots the ladder and the function mails the FIRST
//     office only — one letter, not four;
//   * NOTHING is addressed to the raising HOD (client, 2026-08-19);
//   * `gatepass.email_log` records the attempt, with the provider's own
//     refusal verbatim when it refused;
//   * MAIL_OVERRIDE_TO redirects the letter to the one inbox an unverified
//     Resend account may write to, and the log says where it actually went.
//
// WHAT IT DOES NOT PROVE: the second, third and fourth rungs. Driving those
// needs the four office holders' passwords — they are real people — and
// borrowing their offices is what verify-046.mjs does at some length. Approve
// the probe pass in the browser to watch the next letter arrive.
//
// WHAT ITS FIRST RUN FOUND: the mail sent and the log stayed empty. 047 granted
// `service_role` nothing at all on `email_log` and relied on RLS-bypass, which
// is not a table privilege. Migration 050 is that grant, and the log assertion
// below is what fails without it.
//
// CLEANUP: a raised pass is permanent in this app (024) — no client holds
// DELETE — so the probe prints the psql that removes what it raised.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const PW = 'demo123';
const HOD = { email: 'hod.it@demo.vms', password: PW };
const ADMIN = { email: 'admin@demo.vms', password: PW };

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

const main = async () => {
  const hod = await signIn(HOD);
  const admin = await signIn(ADMIN);

  const { data: ladder } = await gp(admin).rpc('get_approval_ladder');
  const filled = (ladder ?? []).filter((r) => r.user_id);
  console.log(`ladder: ${filled.map((r) => `${r.role_key}=${r.full_name}`).join(', ') || '(empty)'}\n`);

  const { data: me } = await gp(hod).rpc('my_profile');
  const deptId = Array.isArray(me) ? me[0]?.department_id : me?.department_id;
  if (!deptId) throw new Error('the probe HOD has no department');

  const purpose = 'verify-047 email probe';
  const { data, error } = await gp(hod).rpc('raise_pass', {
    p_type: 'RGP',
    p_direction: 'out',
    p_department_id: deptId,
    p_visitor_name: 'Probe 047',
    p_visitor_company: JSON.stringify({ n: 'Probe Vendor', a: 'Nowhere', v: '9000000000' }),
    p_vehicle_number: null,
    p_purpose: purpose,
    p_expected_return_date: '2026-12-31',
    p_items: [
      { name: 'Probe item', description: 'verify-047 probe line', quantity: 1, unit: 'nos', purpose, expected_return_date: '2026-12-31' },
    ],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  const passId = Array.isArray(data) ? (data[0]?.id ?? data[0]) : (data?.id ?? data);
  raised.push(passId);

  const { data: rows } = await gp(hod).from('pass_approvals').select('role_key, level_no, status').eq('gate_pass_id', passId).order('level_no');
  record('raising snapshots one approval row per designated office', (rows ?? []).length === filled.length,
    `rows=${JSON.stringify(rows)}`);

  // The call the app makes, fire-and-forget, right after raise_pass commits.
  const { data: sent, error: fnErr } = await hod.functions.invoke('notify-approval', { body: { pass_id: passId } });
  record('the Edge Function is deployed and answers a signed-in caller', !fnErr,
    fnErr ? fnErr.message : JSON.stringify(sent));

  const list = sent?.results ?? [];
  record('exactly ONE letter comes out of a raise', list.length === 1, JSON.stringify(list));
  record('and it is the approval request, not a receipt', list[0]?.kind === 'awaiting_you', JSON.stringify(list[0] ?? null));
  record('the provider accepted it', list[0]?.ok === true, JSON.stringify(list[0] ?? null));

  const { data: log } = await gp(admin)
    .from('email_log')
    .select('kind, recipient, subject, ok, provider_id, error')
    .eq('gate_pass_id', passId)
    .order('created_at', { ascending: false });

  record('every attempt is in email_log', (log ?? []).length === list.length, JSON.stringify(log));
  const first = (log ?? [])[0];
  record('nothing was addressed to the raising HOD',
    !(log ?? []).some((r) => (r.recipient ?? '').includes(HOD.email)), JSON.stringify(log));
  if (first) {
    console.log(`\n  subject:   ${first.subject}`);
    console.log(`  recipient: ${first.recipient}`);
    console.log(`  ok:        ${first.ok}${first.error ? `\n  error:     ${first.error}` : ''}`);
    console.log(`  provider:  ${first.provider_id ?? '(none)'}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log('\nPROBE PASS RAISED — a raised pass is permanent (024), so remove it with psql:');
  console.log(`  delete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  if (raised.length) {
    console.error('\nPROBE PASS RAISED BEFORE THE FAILURE — remove it with psql:');
    console.error(`  delete from gatepass.gate_passes where id in (${raised.map((i) => `'${i}'`).join(', ')});`);
  }
  process.exit(1);
});
