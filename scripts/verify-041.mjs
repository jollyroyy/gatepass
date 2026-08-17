// Live verification probe for migration 041 — the HOD's decision on an expired
// gate pass.
//
// Runs as REAL users over the anon-key REST path, never as postgres: postgres
// bypasses RLS and every SECURITY DEFINER guard in this function, so a psql run
// could not prove a single thing below. What has to hold for a browser client:
//
//   * a LIVE pass cannot be voided this way — otherwise the HOD cancellation
//     that 024 removed is back through the RPC, whatever the screen draws;
//   * an EXPIRED pass can be voided by the HOD who raised it, and lands as
//     'cancelled' with a `verifications` row naming that HOD;
//   * somebody else's expired pass cannot be voided;
//   * a pass that has already been decided cannot be voided again.
//
// EXPIRY CANNOT BE FAKED FROM THE CLIENT — nobody holds UPDATE on gate_passes —
// so the probe raises a real pass and then ages it with psql, which is the only
// honest way to produce the state this function exists for. Probe rows are
// deleted afterwards through psql for the same reason (no DELETE grant).
//
//   node scripts/verify-041.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!url || !anonKey) { console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)'); process.exit(1); }
if (!dbUrl) { console.error('missing SUPABASE_DB_URL — needed to age a pass and to clean up'); process.exit(1); }

const PSQL = process.env.PSQL_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

const HOD_EMAIL = 'hod.it@demo.vms';
const OTHER_EMAIL = 'hod.fin@demo.vms';
const GUARD_EMAIL = 'guard@demo.vms';
const PW = 'demo123';
const MARK = `041 Probe ${Date.now()}`;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });
const gp = (c) => c.schema('gatepass');

function psql(sql) {
  return execFileSync(PSQL, [dbUrl, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
}

async function signIn(email) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

async function raise(client, departmentId) {
  const { data, error } = await gp(client).rpc('raise_pass', {
    p_type: 'NRGP',
    p_direction: 'out',
    p_department_id: departmentId,
    p_visitor_name: MARK,
    p_visitor_company: null,
    p_vehicle_number: null,
    p_expected_return_date: null,
    p_items: [{ name: 'Probe Item', description: 'Probe line', purpose: 'probe', quantity: 1, unit: 'nos', approx_value: null, expected_return_date: null }],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  return data;
}

async function myDepartment(client) {
  const { data, error } = await gp(client).from('hod_departments').select('department_id');
  if (error) throw new Error(`hod_departments: ${error.message}`);
  if (!data?.length) throw new Error('probe HOD has no department');
  return data[0].department_id;
}

async function statusOf(id) {
  return psql(`select status from gatepass.gate_passes where id = '${id}';`);
}

async function main() {
  const hod = await signIn(HOD_EMAIL);
  const other = await signIn(OTHER_EMAIL);
  const guard = await signIn(GUARD_EMAIL);
  const dept = await myDepartment(hod);

  // ─── A live pass is not voidable ─────────────────────────────────────────
  const live = await raise(hod, dept);
  const liveVoid = await gp(hod).rpc('hod_void_expired_pass', { p_pass_id: live.id, p_reason: 'probe' });
  record(
    'a LIVE pass cannot be voided — 024 stays closed',
    !!liveVoid.error && /has not expired/i.test(liveVoid.error.message),
    liveVoid.error?.message ?? 'NO ERROR — the RPC voided a live pass',
  );
  record('and it is still pending afterwards', (await statusOf(live.id)) === 'pending');

  // ─── Age it, then the guards that matter ─────────────────────────────────
  // `gate_passes_timeline_sane` (012) also refuses an expiry before the raise, so
  // created_at moves back with it — this is a pass raised three days ago that
  // nobody ever presented, which is exactly the situation being probed.
  //
  // `touch_updated_at` (001/008/010) PINS expires_at on every UPDATE — it is
  // immutable once written, whatever the caller sends, and postgres is no
  // exception. So the trigger is disabled for exactly one statement, inside one
  // transaction, which is the only way to produce an aged pass on demand.
  psql(
    `begin;
     alter table gatepass.gate_passes disable trigger touch_updated_at;
     update gatepass.gate_passes
        set created_at = now() - interval '3 days', expires_at = now() - interval '2 days'
      where id = '${live.id}';
     alter table gatepass.gate_passes enable trigger touch_updated_at;
     commit;`,
  );
  const expiredId = live.id;

  const isExpired = psql(`select is_expired from gatepass.v_gate_passes where id = '${expiredId}';`);
  record('the view now derives is_expired for it', isExpired === 't', `is_expired = ${isExpired}`);

  const strangerVoid = await gp(other).rpc('hod_void_expired_pass', { p_pass_id: expiredId, p_reason: 'probe' });
  record(
    'another HOD cannot void it',
    !!strangerVoid.error,
    strangerVoid.error?.message ?? 'NO ERROR — a stranger voided it',
  );

  const guardVoid = await gp(guard).rpc('hod_void_expired_pass', { p_pass_id: expiredId, p_reason: 'probe' });
  record('a guard cannot void it', !!guardVoid.error, guardVoid.error?.message ?? 'NO ERROR — the guard voided it');

  const matched = await gp(guard).rpc('match_pass', { p_pass_id: expiredId, p_gate_name: 'Probe Gate' });
  record(
    'the gate itself refuses it — this is what "null and void" already means',
    !!matched.error,
    matched.error?.message ?? 'NO ERROR — an expired pass was matched at the gate',
  );

  // ─── The raising HOD's decision ──────────────────────────────────────────
  const done = await gp(hod).rpc('hod_void_expired_pass', { p_pass_id: expiredId, p_reason: 'Probe: voided by the HOD' });
  record('the raising HOD CAN void it', !done.error, done.error?.message ?? '');
  record('and it lands as cancelled', (await statusOf(expiredId)) === 'cancelled');

  const audit = psql(
    `select action || ' by ' || (v.security_user_id = p.raised_by) || ' :: ' || coalesce(remarks,'')
       from gatepass.verifications v join gatepass.gate_passes p on p.id = v.gate_pass_id
      where v.gate_pass_id = '${expiredId}' order by v.created_at desc limit 1;`,
  );
  record(
    'the void is recorded in verifications, authored by the raising HOD',
    audit.startsWith('cancelled by t'),
    audit,
  );

  const twice = await gp(hod).rpc('hod_void_expired_pass', { p_pass_id: expiredId, p_reason: 'again' });
  record(
    'a decided pass cannot be voided twice',
    !!twice.error && /waiting at the gate/i.test(twice.error.message),
    twice.error?.message ?? 'NO ERROR — it was voided a second time',
  );

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  psql(`delete from gatepass.verifications where gate_pass_id in (select id from gatepass.gate_passes where visitor_name = '${MARK}');`);
  psql(`delete from gatepass.gate_pass_items where gate_pass_id in (select id from gatepass.gate_passes where visitor_name = '${MARK}');`);
  psql(`delete from gatepass.gate_passes where visitor_name = '${MARK}';`);
  const left = psql(`select count(*) from gatepass.gate_passes where visitor_name = '${MARK}';`);
  record('probe rows cleaned up', left === '0', `${left} left`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
