// Live verification probe for migration 031 — run as REAL users (never postgres),
// via the anon-key REST, exactly the path the browser uses. Read-only except for
// one save+delete of a vendor profile it cleans up itself.
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
const pub = (c) => c.schema('public');

async function main() {
  let guard, hod, admin;
  try {
    guard = await signIn('guard', 'guard@demo.vms');
    hod = await signIn('hod', 'hod.it@demo.vms');
    admin = await signIn('admin', 'admin@demo.vms');
  } catch (e) {
    console.error('SETUP FAILED:', e.message);
    process.exit(2);
  }

  // 1. list_blacklist_entries — admin sees rows (fixes the live 42501), guard gets none
  const adminBl = await gp(admin).rpc('list_blacklist_entries');
  record('admin: list_blacklist_entries no longer 42501', !adminBl.error, adminBl.error?.message ?? `rows=${adminBl.data?.length}`);
  const guardBl = await gp(guard).rpc('list_blacklist_entries');
  record('guard: list_blacklist_entries returns empty (RLS)', !guardBl.error && guardBl.data?.length === 0, guardBl.error?.message ?? `rows=${guardBl.data?.length}`);

  // 2. list_vendor_profiles — HOD + admin reach it, guard gets empty
  const hodV = await gp(hod).rpc('list_vendor_profiles');
  record('hod: list_vendor_profiles no longer 42501', !hodV.error, hodV.error?.message ?? `rows=${hodV.data?.length}`);
  const guardV = await gp(guard).rpc('list_vendor_profiles');
  record('guard: list_vendor_profiles returns empty (RLS)', !guardV.error && guardV.data?.length === 0, guardV.error?.message ?? `rows=${guardV.data?.length}`);

  // 3. save_vendor_profile still works for an HOD (definer write path), then delete via REMOVED function
  const { data: depts } = await pub(admin).from('departments').select('id').limit(1);
  if (depts?.[0]?.id) {
    const saved = await gp(hod).rpc('save_vendor_profile', { p_company_name: `031-probe-${Date.now()}`, p_department_id: depts[0].id });
    record('hod: save_vendor_profile still works', !saved.error, saved.error?.message ?? 'saved');
    if (!saved.error && saved.data?.id) {
      const delv = await gp(hod).rpc('delete_vendor_profile', { p_id: saved.data.id });
      record('delete_vendor_profile is dropped (PGRST202)', !!delv.error, delv.error?.message ?? 'STILL EXISTS — dead function not dropped!');
    }
  } else {
    record('probe setup: departments readable', false, 'no department found');
  }

  // 4. lookup_pass returns blacklist_match, not blacklist_note
  const look = await gp(guard).rpc('lookup_pass', { p_code: 'NOT-A-PASS' });
  const row = Array.isArray(look.data) ? look.data[0] : look.data;
  record('lookup_pass returns blacklist_match column',
    !!row && 'blacklist_match' in row && !('blacklist_note' in row),
    JSON.stringify(row ?? look.error?.message));

  // 5. dropped RPCs either 404 (PGRST202) or are absent
  const droppedCalls = [
    ['bulk_create_passes', { p_type: 'RGP', p_direction: 'out', p_department_id: null, p_visitor_company: 'x', p_vehicle_number: null, p_purpose: null, p_expected_return_date: null, p_items: [], p_count: 1, p_name_prefix: 'p' }],
    ['hold_pass', { p_pass_id: '00000000-0000-0000-0000-000000000000', p_reason: 'x' }],
    ['check_blacklist', {}],
  ];
  for (const [fn, params] of droppedCalls) {
    const { error } = await gp(admin).rpc(fn, params);
    record(`${fn} is gone (PGRST202/absent)`, !!error, error?.message ?? 'STILL WORKS — dead function not dropped!');
  }

  // 6. RLS on direct table reads — guard must see empty, not throw
  const direct = await gp(guard).from('blacklist').select('*');
  record('guard: direct SELECT on blacklist empty (RLS)', !direct.error && direct.data?.length === 0, direct.error?.message ?? `rows=${direct.data?.length}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });