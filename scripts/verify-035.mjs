// Live verification probe for migration 035 — HOD override = fresh pass and
// the timeline columns. Runs as REAL users via the anon-key REST path (never
// postgres): hod.it raises, the guard flags, the HOD overrides, and the gate
// must be able to MATCH the fresh pass — or RE-FLAG it, because the override
// judged the paper, not the material. Probe rows cannot be deleted over the
// anon path (nobody holds DELETE on gate_passes); the script prints the psql
// cleanup at the end.
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

/** End of the CURRENT day in Asia/Kolkata, mirroring migration 028/035:
 *  ((date_trunc('day', now at tz) + interval '1 day') at tz) - 1us. */
function istEndOfToday() {
  const istMs = Date.now() + 5.5 * 3600e3;
  const d = new Date(istMs);
  const tomorrowIstMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 5.5 * 3600e3;
  return new Date(tomorrowIstMidnight - 1);
}
const nearEndOfToday = (iso) => Math.abs(new Date(iso).getTime() - istEndOfToday().getTime()) <= 3000;

async function viewRow(client, id) {
  const { data, error } = await gp(client).from('v_gate_passes').select('*').eq('id', id).single();
  if (error) throw new Error(`view read: ${error.message}`);
  return data;
}

async function raise(client, name, type = 'RGP') {
  const { data: depts, error: deptErr } = await gp(client).from('hod_departments').select('department_id').limit(1);
  if (deptErr || !depts?.[0]) throw new Error(`dept lookup: ${deptErr?.message ?? 'none'}`);
  const expectedReturn = new Date(Date.now() + 3 * 24 * 3600e3).toISOString().slice(0, 10);
  const { data, error } = await gp(client).rpc('raise_pass', {
    p_type: type,
    p_direction: 'out',
    p_department_id: depts[0].department_id,
    p_visitor_name: '035 Probe',
    p_visitor_company: null,
    p_vehicle_number: null,
    p_expected_return_date: expectedReturn,
    p_items: [{ name, description: name, purpose: 'verification', quantity: 1, unit: 'nos', approx_value: null, expected_return_date: expectedReturn }],
  });
  if (error) throw new Error(`raise_pass: ${error.message}`);
  return data;
}

const flag = (c, id, reason) => gp(c).rpc('flag_pass', { p_pass_id: id, p_reason: reason });
const approve = (c, id) => gp(c).rpc('hod_review_flagged_pass', { p_pass_id: id, p_action: 'approve' });
const match = (c, id, itemId, qty = 1) => gp(c).rpc('match_pass', { p_pass_id: id, p_lines: [{ item_id: itemId, verified_qty: qty }], p_vehicle: null, p_remarks: null });

async function lineItem(client, passId) {
  const { data, error } = await gp(client).from('gate_pass_items').select('id').eq('gate_pass_id', passId).limit(1);
  if (error || !data?.[0]) throw new Error(`item lookup: ${error?.message ?? 'no lines'}`);
  return data[0].id;
}

async function main() {
  const hod = await signIn('hod', 'hod.it@demo.vms');
  const guard = await signIn('guard', 'guard@demo.vms');
  const probeIds = [];

  // --- Probe A: raise → flag → HOD override → gate MATCHES the fresh pass ---
  const a = await raise(hod, '035-probe drill A');
  probeIds.push(a.id);
  record('A1: raise succeeds as hod (status pending, same-day expiry)',
    a.status === 'pending' && nearEndOfToday(a.expires_at),
    `status=${a.status} expires_at=${a.expires_at}`);

  const f1 = await flag(guard, a.id, 'Qty short (probe)');
  record('A2: guard flags the pass', !f1.error, f1.error?.message ?? 'flagged');
  let row = await viewRow(guard, a.id);
  record('A3: flagged — status + reason + flagged_at timeline column',
    row.status === 'flagged' && row.flag_reason === 'Qty short (probe)' && !!row.flagged_at,
    `status=${row.status} flagged_at=${row.flagged_at ?? 'NULL'} hod_reviewed_at=${row.hod_reviewed_at ?? 'null'}`);

  const ov = await approve(hod, a.id);
  record('A4: HOD approves the override', !ov.error, ov.error?.message ?? 'approved');
  row = await viewRow(guard, a.id);
  record('A5: override = FRESH pass — hod_reviewed, reason kept, expiry = end of TODAY, timeline set',
    row.status === 'hod_reviewed' && row.flag_reason === 'Qty short (probe)' &&
      nearEndOfToday(row.expires_at) && !!row.hod_reviewed_at,
    `status=${row.status} expires_at=${row.expires_at} flagged_at=${row.flagged_at} hod_reviewed_at=${row.hod_reviewed_at}`);

  const itemA = await lineItem(guard, a.id);
  const m1 = await match(guard, a.id, itemA, 1);
  record('A6: the gate MATCHES the overridden pass (035 admits hod_reviewed in match_pass)', !m1.error, m1.error?.message ?? 'matched');
  row = await viewRow(guard, a.id);
  record('A7: final row matched, flag_reason intact, timeline columns both set',
    row.status === 'matched' && row.flag_reason === 'Qty short (probe)' && !!row.flagged_at && !!row.hod_reviewed_at,
    `status=${row.status} flagged_at=${row.flagged_at} hod_reviewed_at=${row.hod_reviewed_at}`);

  // --- Probe B: the gate may still RE-FLAG an overridden pass ---
  const b = await raise(hod, '035-probe coil');
  probeIds.push(b.id);
  await flag(guard, b.id, 'First flag (probe)');
  await approve(hod, b.id);
  const f2 = await flag(guard, b.id, 'Re-flag after override (probe)');
  record('B: after override, guard can still RE-FLAG (flag_pass admits hod_reviewed)', !f2.error, f2.error?.message ?? 're-flagged');
  row = await viewRow(guard, b.id);
  record('B2: the match is now flagged with the NEW reason (fresh mismatch)',
    row.status === 'flagged' && row.flag_reason === 'Re-flag after override (probe)' && !!row.flagged_at,
    `status=${row.status} flag_reason=${row.flag_reason}`);

  // A hod_reviewed pass that outlived its day is hidden from the queue but
  // still flaggable via lookup — the DB side of the queue's .gte filter.
  const c1 = await raise(hod, '035-probe static');
  probeIds.push(c1.id);
  await flag(guard, c1.id, 'stale probe');
  await approve(hod, c1.id);
  const stale = await viewRow(guard, c1.id);
  record('C: hod_reviewed pass still carries an expires_at (queue .gte has something to filter on)',
    !!stale.expires_at && stale.status === 'hod_reviewed', `status=${stale.status} expires_at=${stale.expires_at}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log('CLEANUP (run as postgres via psql — the anon path cannot delete):');
  console.log(`  delete from gatepass.verifications where gate_pass_id in (${probeIds.map((i) => `'${i}'`).join(', ')});`);
  console.log(`  delete from gatepass.gate_pass_items where gate_pass_id in (${probeIds.map((i) => `'${i}'`).join(', ')});`);
  console.log(`  delete from gatepass.gate_passes where id in (${probeIds.map((i) => `'${i}'`).join(', ')});`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });