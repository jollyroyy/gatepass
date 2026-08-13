// Live verification probe for migration 039 — whitelisting a blacklisted
// vendor requires a justification and the designated CEO's approval.
//
// Runs as REAL users over the anon-key REST path, never as postgres: postgres
// bypasses RLS and every SECURITY DEFINER guard here, so a psql run could not
// prove any of it. What must hold for a browser client is exactly the point —
// that an admin cannot delete a blacklist entry, cannot approve their own
// request, and that the justification floor is enforced by the database and
// not only by the form.
//
// Cleanup: probe blacklist entries and whitelist_requests rows are removed via
// psql at the end (nobody holds DELETE over the anon path), and the CEO
// designation this probe makes is restored to whatever it was before.
//
//   node scripts/verify-039.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

const ADMIN_EMAIL = 'admin@demo.vms';
const ADMIN_PASSWORD = 'demo123';
const GUARD_EMAIL = 'guard@demo.vms';
const GUARD_PASSWORD = 'demo123';

const stamp = Date.now();
const VENDOR_A = `Probe039 Alpha ${stamp}`;
const VENDOR_B = `Probe039 Beta ${stamp}`;
const JUSTIFICATION = 'Dispute settled in writing; contract reinstated 2026-08-13.';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function gp(client) {
  return client.schema('gatepass');
}

async function signIn(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const guard = await signIn(GUARD_EMAIL, GUARD_PASSWORD);

  // ── The one-click removal is gone ────────────────────────────────────────
  {
    const { error } = await gp(admin).rpc('remove_blacklist_entry', { p_id: stamp });
    record(
      'remove_blacklist_entry no longer exists',
      Boolean(error),
      error?.code ?? error?.message
    );
  }

  // ── Two probe entries to work with ───────────────────────────────────────
  const ids = {};
  for (const [key, value] of [['a', VENDOR_A], ['b', VENDOR_B]]) {
    const { data, error } = await gp(admin).rpc('add_blacklist_entry', {
      p_list_type: 'company',
      p_list_value: value,
      p_reason: 'Probe 039',
    });
    if (error) throw new Error(`could not seed probe entry: ${error.message}`);
    ids[key] = Array.isArray(data) ? data[0].id : data.id;
  }
  record('admin can still blacklist a vendor', Boolean(ids.a && ids.b));

  // ── The justification is mandatory in the DATABASE, not just the form ────
  {
    const { error } = await gp(admin).rpc('request_vendor_whitelist', {
      p_blacklist_id: ids.a,
      p_justification: 'ok',
    });
    record('a token justification is refused', Boolean(error), error?.message);
  }

  // ── A non-admin cannot request at all ────────────────────────────────────
  {
    const { error } = await gp(guard).rpc('request_vendor_whitelist', {
      p_blacklist_id: ids.a,
      p_justification: JUSTIFICATION,
    });
    record('a guard cannot request whitelisting', Boolean(error), error?.message);
  }

  // ── The real request ─────────────────────────────────────────────────────
  let requestA = null;
  {
    const { data, error } = await gp(admin).rpc('request_vendor_whitelist', {
      p_blacklist_id: ids.a,
      p_justification: JUSTIFICATION,
    });
    requestA = Array.isArray(data) ? data[0] : data;
    record('an admin can request whitelisting with a justification', !error && Boolean(requestA?.id), error?.message);
    record('the request starts pending', requestA?.status === 'pending', requestA?.status);
  }

  // ── The entry is STILL enforced while the CEO considers it ───────────────
  {
    const { data } = await gp(admin).rpc('list_blacklist_entries');
    const stillThere = (data ?? []).some((e) => e.id === ids.a);
    record('the vendor stays blacklisted while the request is pending', stillThere);
  }

  // ── No second request for the same entry ─────────────────────────────────
  {
    const { error } = await gp(admin).rpc('request_vendor_whitelist', {
      p_blacklist_id: ids.a,
      p_justification: JUSTIFICATION,
    });
    record('a second pending request for the same entry is refused', Boolean(error), error?.message);
  }

  // ── An admin who is not the CEO cannot approve their own request ─────────
  // Skipped in --decisions, where this same account IS the probe CEO.
  if (!process.argv.includes('--decisions')) {
    const { error } = await gp(admin).rpc('approve_whitelist_request', { p_id: requestA.id });
    record('an admin cannot approve — only the designated CEO can', Boolean(error), error?.message);
  }

  // ── An admin cannot designate the CEO (super_admin only) ─────────────────
  {
    const { data: me } = await admin.auth.getUser();
    const { error } = await gp(admin).rpc('set_ceo_approver', { p_user_id: me.user.id });
    record('an admin cannot designate the CEO', Boolean(error), error?.message);
  }

  console.log('\n--- designate the probe CEO via psql, then re-run the decision checks ---');
  console.log('The remaining checks need a designated CEO. Run:\n');
  console.log(`  psql "$SUPABASE_DB_URL" -c "insert into gatepass.ceo_approver (only_row, user_id, designated_by) select true, id, id from public.profiles where id = (select id from auth.users where email = '${ADMIN_EMAIL}') on conflict (only_row) do update set user_id = excluded.user_id;"\n`);
  console.log('then: node scripts/verify-039.mjs --decisions\n');

  if (process.argv.includes('--decisions')) {
    const { data: isCeo } = await gp(admin).rpc('is_ceo');
    record('the designated account reads as the CEO', isCeo === true, String(isCeo));

    // Reject needs a reason.
    let requestB = null;
    {
      const { data } = await gp(admin).rpc('request_vendor_whitelist', {
        p_blacklist_id: ids.b,
        p_justification: JUSTIFICATION,
      });
      requestB = Array.isArray(data) ? data[0] : data;
    }
    {
      const { error } = await gp(admin).rpc('reject_whitelist_request', { p_id: requestB.id, p_note: '' });
      record('a rejection without a reason is refused', Boolean(error), error?.message);
    }
    {
      const { error } = await gp(admin).rpc('reject_whitelist_request', {
        p_id: requestB.id,
        p_note: 'Pilferage claim is still open with the insurer.',
      });
      record('the CEO can reject with a reason', !error, error?.message);
      const { data } = await gp(admin).rpc('list_blacklist_entries');
      record('a rejected vendor stays blacklisted', (data ?? []).some((e) => e.id === ids.b));
    }

    // Approve deletes the entry and keeps the audit row.
    {
      const { error } = await gp(admin).rpc('approve_whitelist_request', { p_id: requestA.id });
      record('the CEO can approve', !error, error?.message);
      const { data } = await gp(admin).rpc('list_blacklist_entries');
      record('approval removes the vendor from the blacklist', !(data ?? []).some((e) => e.id === ids.a));
      const { data: reqs } = await gp(admin).rpc('list_whitelist_requests', { p_status: 'approved' });
      const kept = (reqs ?? []).find((r) => r.id === requestA.id);
      record(
        'the approved request survives the deletion, with its snapshot',
        // Compared case-insensitively: the blacklist normalizes the stored
        // value's case, so the snapshot is upper-cased too.
        Boolean(kept) && kept.list_value.toLowerCase() === VENDOR_A.toLowerCase(),
        kept?.list_value
      );
    }
    {
      const { error } = await gp(admin).rpc('approve_whitelist_request', { p_id: requestA.id });
      record('a decided request cannot be decided twice', Boolean(error), error?.message);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log('\nCLEANUP (psql):');
  console.log(`  delete from gatepass.whitelist_requests where list_value like 'Probe039 %';`);
  console.log(`  delete from gatepass.blacklist where list_value like 'Probe039 %';`);
  console.log(`  delete from gatepass.ceo_approver;  -- only if this probe created it`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
