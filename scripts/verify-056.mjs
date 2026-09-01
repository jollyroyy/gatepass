// Live verification probe for migration 056 — the Application settings card,
// and the one field on it that every signed-in user has to be able to read.
//
// RUNS AS REAL USERS OVER THE ANON-KEY REST PATH, NEVER AS POSTGRES. 056 is
// almost entirely an authorization shape — a table with RLS on, no policy and
// no grant, reachable only through three SECURITY DEFINER functions with
// different audiences — and postgres bypasses every one of those decisions. The
// psql apply proved the objects exist; only this proves they are gated.
//
// What has to hold for a browser client:
//
//   * `app_settings` is UNREACHABLE DIRECTLY. RLS is on with no policy and no
//     grant, so a signed-in user selecting from the table gets nothing, admin
//     included. That is 052's pattern and the reason the getters exist;
//   * `get_app_settings` / `set_app_settings` are ADMIN-ONLY. `require_approver_2fa`
//     is withheld from everyone else on purpose — "there is no second factor on
//     this deployment" is reconnaissance about a control, not decoration;
//   * ⚠ `get_session_timeout` IS GRANTED TO EVERY SIGNED-IN USER, and that
//     asymmetry is the single most important thing in this file. The idle timer
//     governs the guard at the barrier and the HOD at their desk, and THEIR OWN
//     BROWSER is what enforces it — gating it would leave a setting that only
//     changed the behaviour of the admin who set it. It returns that one
//     integer and no other field, which is what makes the wider grant safe;
//   * it returns NOTHING to a caller with no role at all (`app_role() is not
//     null` in the body), so signing out closes it;
//   * every CHECK is restated as a sentence, because a constraint violation
//     reaches the browser as 23514 and this app deliberately does not map that.
//
// STATE: this deployment's `app_settings` table is EMPTY, which is the state
// every deployment starts in and is not an error — `get_app_settings` returns a
// document of nulls rather than a null document, so the form renders the same
// either way. This probe writes a row and then blanks every field again, but it
// CANNOT remove the row: nobody holds DELETE on that table, by design. The psql
// to restore a truly-empty table is printed at the end.
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
const HOD = { email: 'hod.it@demo.vms', password: PW };
const STAFF = { email: 'staff.hr@demo.vms', password: PW };

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

const setSettings = (client, p) =>
  gp(client).rpc('set_app_settings', {
    p_app_name: p.app_name ?? null,
    p_brand_color: p.brand_color ?? null,
    p_require_approver_2fa: p.require_approver_2fa ?? false,
    p_session_timeout_minutes: p.session_timeout_minutes ?? null,
  });

const main = async () => {
  const admin = await signIn(ADMIN);
  const guard = await signIn(GUARD);
  const hod = await signIn(HOD);
  const staff = await signIn(STAFF);
  const anon = fresh();

  // What was there before. Restored at the end.
  const { data: before } = await gp(admin).rpc('get_app_settings');
  console.log(`\nsettings before the probe: ${JSON.stringify(before)}\n`);

  // ── 1. The table itself is unreachable, admin included ─────────────────────
  for (const [who, client] of [['an admin', admin], ['a guard', guard], ['an HOD', hod]]) {
    const { data, error } = await gp(client).from('app_settings').select('*');
    record(
      `${who} cannot read gatepass.app_settings directly`,
      !!error || (data ?? []).length === 0,
      error ? `refused: ${error.message}` : `rows=${(data ?? []).length}`,
    );
  }

  // ── 2. The admin-only pair ─────────────────────────────────────────────────
  for (const [who, client] of [['a guard', guard], ['an HOD', hod], ['a staff account', staff]]) {
    const { error } = await gp(client).rpc('get_app_settings');
    record(`${who} cannot READ the application settings`, !!error, error ? `refused: ${error.message}` : 'THE SETTINGS WERE READ BY A NON-ADMIN');
  }
  {
    const { error } = await setSettings(guard, { app_name: 'Hijacked' });
    record('a guard cannot WRITE the application settings', !!error, error ? `refused: ${error.message}` : 'A GUARD WROTE THE SETTINGS');
  }
  {
    const { data, error } = await gp(admin).rpc('get_app_settings');
    record('an admin CAN read them', !error && !!data, error?.message ?? JSON.stringify(data));
  }

  // ── 3. ⚠ THE ASYMMETRY: the timer is readable by everyone signed in ────────
  for (const [who, client] of [['a guard', guard], ['an HOD', hod], ['a staff account', staff], ['an admin', admin]]) {
    const { error } = await gp(client).rpc('get_session_timeout');
    record(`${who} CAN read get_session_timeout — their own browser enforces it`, !error, error ? `refused: ${error.message}` : undefined);
  }
  {
    const { data, error } = await gp(anon).rpc('get_session_timeout');
    record(
      'a caller with no session gets nothing back from get_session_timeout',
      !!error || data === null || data === undefined,
      error ? `refused: ${error.message}` : `value=${JSON.stringify(data)}`,
    );
  }

  // ── 4. The validations, each as a sentence rather than a 23514 ─────────────
  {
    const { error } = await setSettings(admin, { brand_color: 'goldish' });
    record('a brand colour that is not a six-digit hex is refused, in words', !!error && !/23514/.test(error.message), error ? `refused: ${error.message}` : 'AN INVALID COLOUR WAS STORED');
  }
  {
    const { error } = await setSettings(admin, { app_name: 'x'.repeat(41) });
    record('an application name over 40 characters is refused, in words', !!error && !/23514/.test(error.message), error ? `refused: ${error.message}` : 'A 41-CHARACTER NAME WAS STORED');
  }
  {
    const { error } = await setSettings(admin, { session_timeout_minutes: 4 });
    record('a sign-out timer under 5 minutes is refused', !!error, error ? `refused: ${error.message}` : 'A 4-MINUTE TIMER WAS STORED');
  }
  {
    const { error } = await setSettings(admin, { session_timeout_minutes: 1441 });
    record('a sign-out timer over 24 hours is refused', !!error, error ? `refused: ${error.message}` : 'A 1441-MINUTE TIMER WAS STORED');
  }

  // ── 5. A real write, read back by the right people ─────────────────────────
  {
    const { data, error } = await setSettings(admin, {
      app_name: 'Quest GatePass',
      brand_color: '#C6A15B',
      require_approver_2fa: true,
      session_timeout_minutes: 20,
    });
    record(
      'an admin writes every field and the setter returns the stored document',
      !error && data?.app_name === 'Quest GatePass' && data?.brand_color === '#C6A15B'
        && data?.require_approver_2fa === true && data?.session_timeout_minutes === 20,
      error?.message ?? JSON.stringify(data),
    );
  }
  {
    const { data } = await gp(admin).rpc('get_app_settings');
    record('…and the getter agrees, naming who changed it', data?.session_timeout_minutes === 20 && !!data?.updated_by_name, JSON.stringify(data));
  }
  {
    const { data, error } = await gp(guard).rpc('get_session_timeout');
    record('THE GUARD READS THE NEW TIMER — 20', !error && data === 20, error?.message ?? `value=${JSON.stringify(data)}`);
  }
  {
    // The narrow grant is only safe because it returns the ONE integer. If this
    // ever comes back as a document, the 2FA flag has leaked with it.
    const { data } = await gp(guard).rpc('get_session_timeout');
    record('get_session_timeout returns a bare integer, not a document', typeof data === 'number', `typeof=${typeof data} value=${JSON.stringify(data)}`);
  }
  {
    const { error } = await gp(guard).rpc('get_app_settings');
    record('…and the guard still cannot see the 2FA flag beside it', !!error, error ? `refused: ${error.message}` : 'THE 2FA FLAG LEAKED TO A GUARD');
  }

  // ── 6. The edges of the range are inside it ────────────────────────────────
  {
    const { error: lo } = await setSettings(admin, { session_timeout_minutes: 5 });
    const { error: hi } = await setSettings(admin, { session_timeout_minutes: 1440 });
    record('5 and 1440 are both accepted — the range is inclusive', !lo && !hi, `5=${lo?.message ?? 'ok'} 1440=${hi?.message ?? 'ok'}`);
  }
  {
    const { data } = await setSettings(admin, { session_timeout_minutes: null });
    record('clearing the timer returns null, which is the app’s own default', data?.session_timeout_minutes === null, JSON.stringify(data));
  }
  {
    const { data } = await gp(guard).rpc('get_session_timeout');
    record('…and the guard reads null for it, not a stale 1440', data === null, `value=${JSON.stringify(data)}`);
  }

  // ── 7. Blank every field again ─────────────────────────────────────────────
  await setSettings(admin, {
    app_name: before?.app_name ?? null,
    brand_color: before?.brand_color ?? null,
    require_approver_2fa: before?.require_approver_2fa ?? false,
    session_timeout_minutes: before?.session_timeout_minutes ?? null,
  });
  {
    const { data } = await gp(admin).rpc('get_app_settings');
    record(
      'every field is blanked back to what it was',
      (data?.app_name ?? null) === (before?.app_name ?? null)
        && (data?.brand_color ?? null) === (before?.brand_color ?? null)
        && (data?.session_timeout_minutes ?? null) === (before?.session_timeout_minutes ?? null),
      `now=${JSON.stringify(data)}\n        was=${JSON.stringify(before)}`,
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  console.log('\nThis probe wrote the single app_settings row. Nobody holds DELETE on that');
  console.log('table by design, so to leave it genuinely empty again, run in psql:');
  console.log('  delete from gatepass.app_settings;');
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
