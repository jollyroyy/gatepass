// Live verification probe for migration 048 — an admin-set password must
// actually let the person SIGN IN.
//
// This one cannot be proved with psql at all, and not merely because postgres
// bypasses RLS: the thing under test is GoTrue's own sign-in decision, which
// happens outside Postgres entirely. So every step here runs over the anon-key
// REST path, as a real client.
//
// The bug: 036's admin_reset_user_password wrote the password hash but never
// touched `email_confirmed_at`, and GoTrue refuses an unconfirmed address
// BEFORE it looks at a password. Every unconfirmed account on this database had
// never once signed in.
//
// The probe builds the exact situation the client hit — an unconfirmed account
// — has an admin reset its password through the RPC, and then tries to sign in
// with that password and the address the Users tab prints. It cleans up after
// itself: the throwaway account is deleted whatever the outcome.
//
// Needs SUPABASE_DB_URL as well as the anon key, for two things the REST path
// deliberately cannot do: MAKING an account unconfirmed (nothing in this app
// un-confirms an address), and deleting the throwaway afterwards. Those go
// through `psql` on PATH rather than a node driver — this repo has no pg
// dependency and a verification probe is not a reason to add one.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!url || !anonKey || !dbUrl) {
  console.error('missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_DB_URL)');
  process.exit(1);
}

const ADMIN = { email: 'admin@demo.vms', password: 'demo123' };
const PROBE_EMAIL = `verify048-${Date.now()}@example.com`;
const FIRST_PASSWORD = 'probe-first-pw-1';
const RESET_PASSWORD = 'probe-reset-pw-2';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const fresh = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function signIn({ email, password }) {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

/** Attempts a sign-in and reports whether it worked, rather than throwing —
 *  the failing case is a result here, not an accident. */
async function trySignIn({ email, password }) {
  const { error } = await fresh().auth.signInWithPassword({ email, password });
  return { ok: !error, message: error?.message ?? null };
}

/** One scalar-or-row query through psql. Unaligned, tuples-only, so the value
 *  comes back as bare text; '' means SQL NULL. */
function sql(text, params = []) {
  // Params are interpolated as quoted literals rather than bound: psql has no
  // bind protocol on the command line. Every value here is a uuid or a literal
  // this file wrote, never user input.
  const filled = text.replace(/\$(\d+)/g, (_, i) => `'${String(params[Number(i) - 1]).replace(/'/g, "''")}'`);
  return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', filled], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split('|'));
}

let probeId = null;

try {
  const admin = await signIn(ADMIN);

  // ── 1. an account that exists and can sign in ────────────────────────────
  const { data: created, error: createErr } = await admin.schema('gatepass').rpc('admin_create_user', {
    p_email: PROBE_EMAIL,
    p_password: FIRST_PASSWORD,
    p_full_name: 'Reset Confirm Probe',
    p_role: 'guard',
    p_department_ids: null,
  });
  if (createErr) throw new Error(`admin_create_user: ${createErr.message}`);
  probeId = created.id;

  const before = await trySignIn({ email: PROBE_EMAIL, password: FIRST_PASSWORD });
  record('a portal-created account signs in straight away (021/034 confirm it on creation)', before.ok, before.message);

  // ── 2. make it unconfirmed — the state the 7 live accounts were in ───────
  sql('update auth.users set email_confirmed_at = null where id = $1', [probeId]);
  const unconfirmed = await trySignIn({ email: PROBE_EMAIL, password: FIRST_PASSWORD });
  record(
    'an UNCONFIRMED account is refused even with the right password — the bug the client hit',
    !unconfirmed.ok,
    unconfirmed.ok ? 'it signed in, so confirmation is not enforced on this project' : `refused: ${unconfirmed.message}`,
  );

  // ── 3. the admin resets the password, through the RPC the portal calls ───
  const { error: resetErr } = await admin.schema('gatepass').rpc('admin_reset_user_password', {
    p_user_id: probeId,
    p_password: RESET_PASSWORD,
  });
  record('an admin can reset it over the anon-key path', !resetErr, resetErr?.message);

  // ── 4. THE POINT OF 048 ──────────────────────────────────────────────────
  const after = await trySignIn({ email: PROBE_EMAIL, password: RESET_PASSWORD });
  record(
    'the person signs in with the new password and the address the portal shows',
    after.ok,
    after.message,
  );

  record('the reset confirmed the address',
    sql('select email_confirmed_at is not null from auth.users where id = $1', [probeId])[0]?.[0] === 't');

  // ── 5. the old password is dead, and the flag is up ──────────────────────
  const old = await trySignIn({ email: PROBE_EMAIL, password: FIRST_PASSWORD });
  record('the OLD password no longer works', !old.ok, old.ok ? 'it still signs in' : null);

  record('must_change_password is raised, so the app forces their own choice next',
    sql('select must_change_password from public.profiles where id = $1', [probeId])[0]?.[0] === 't');

  // ── 6. an already-confirmed address keeps its ORIGINAL timestamp ─────────
  // `coalesce`, not a bare assignment: a reset must not restate when the
  // person proved they owned the address.
  const stampBefore = sql('select email_confirmed_at from auth.users where id = $1', [probeId])[0][0];
  await new Promise((r) => setTimeout(r, 1100));
  const { error: reset2Err } = await admin.schema('gatepass').rpc('admin_reset_user_password', {
    p_user_id: probeId,
    p_password: 'probe-reset-pw-3',
  });
  if (reset2Err) throw new Error(`second reset: ${reset2Err.message}`);
  const stampAfter = sql('select email_confirmed_at from auth.users where id = $1', [probeId])[0][0];
  record(
    'a second reset does NOT move an existing confirmation timestamp',
    stampBefore === stampAfter,
    `${stampBefore} vs ${stampAfter}`,
  );
} catch (err) {
  record('probe ran to completion', false, err.message);
} finally {
  if (probeId) {
    // auth.users cascades into public.profiles, gatepass.user_status and the
    // rest, so this is the whole cleanup.
    try {
      sql('delete from auth.users where id = $1', [probeId]);
      console.log(`\ncleaned up ${PROBE_EMAIL}`);
    } catch (e) {
      console.error(`CLEANUP FAILED — delete auth.users id ${probeId} by hand:`, e.message);
    }
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
