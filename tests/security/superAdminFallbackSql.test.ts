// Static checks on migration 067 — the pair delegation and the super admin
// fallback.
//
// WHY STATIC AND NOT LIVE. `psql` connects as `postgres` and bypasses RLS
// entirely, so nothing run from this repo can PROVE a policy admits or refuses
// a real reader — only a `scripts/verify-0NN.mjs` run with real anon-key JWTs
// can. What these checks can do is catch the ways this particular change goes
// silently wrong: an arm dropped out of a policy that gets rewritten later, a
// refusal edited out of the delegation RPC, or the fallback pool quietly
// widening back to every authenticated caller.
//
// They read the LAST definition of each object across every migration, because
// that is the one a fresh `APPLY_ALL.sql` paste leaves behind.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');

function migrations(): { name: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8') }));
}

/** The last `create or replace function gatepass.<name>(` … up to the closing
 *  dollar-quote, across every migration in filename order. */
function lastFunction(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const { name: file, sql } of migrations()) {
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+gatepass\\.${name}\\s*\\(`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      // The body runs to the dollar-quote that closes it, whatever tag it uses.
      const rest = sql.slice(m.index);
      const tag = /as\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      if (!tag) continue;
      const start = rest.indexOf(tag[1]) + tag[1].length;
      const end = rest.indexOf(tag[1], start);
      found = { file, body: rest.slice(0, end < 0 ? rest.length : end + tag[1].length) };
    }
  }
  if (!found) throw new Error(`no migration defines gatepass.${name}`);
  return found;
}

/** The last `create policy <name> on <table>` statement. */
function lastPolicy(name: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const { name: file, sql } of migrations()) {
    const re = new RegExp(`create\\s+policy\\s+${name}\\s+on\\s+[^;]+;`, 'gi');
    const all = sql.match(re);
    if (all && all.length > 0) found = { file, body: all[all.length - 1] };
  }
  if (!found) throw new Error(`no migration creates policy ${name}`);
  return found;
}

describe('067 — the COO and the CEO cover each other', () => {
  it('refuses a delegation of a shared rung to anybody but its counterpart', () => {
    const fn = lastFunction('create_approval_delegation');
    expect(
      /approval_office_pair\s*\(\s*v_office\s*\)/i.test(fn.body),
      `gatepass.create_approval_delegation (in ${fn.file}) no longer asks which office shares its ` +
        `rung. Without it the COO could hand level 3 to any department head, which is what the ` +
        `client removed on 2026-08-24.`,
    ).toBe(true);

    expect(
      /can only be delegated to the/i.test(fn.body),
      `gatepass.create_approval_delegation (in ${fn.file}) has lost the refusal that names the ` +
        `counterpart office. The dropdown is not a control — this RPC is reachable over PostgREST ` +
        `with any user id the caller types.`,
    ).toBe(true);
  });

  it('keeps 066’s department-head rule for every office that shares no rung', () => {
    const fn = lastFunction('create_approval_delegation');
    expect(
      /can only be delegated to a department head/i.test(fn.body),
      `gatepass.create_approval_delegation (in ${fn.file}) has lost 066's rule. The Security Head ` +
        `and the Finance HOD would then be able to delegate their office to a guard or to staff.`,
    ).toBe(true);
  });

  it('narrows the candidate list the same way the write does', () => {
    const fn = lastFunction('list_delegation_candidates');
    expect(
      /approval_office_pair/i.test(fn.body) && /role::text\s*=\s*'hod'/i.test(fn.body),
      `gatepass.list_delegation_candidates (in ${fn.file}) must carry BOTH rules — the pair for a ` +
        `shared rung and the HOD bench for everybody else — or a name is offered that the write ` +
        `then refuses.`,
    ).toBe(true);
  });
});

describe('067 — the super admin fallback', () => {
  it('is the VMS role OR the sitting COO/CEO, and nothing wider', () => {
    const fn = lastFunction('is_super_admin');
    expect(/app_role\(\)\s*=\s*'super_admin'/i.test(fn.body)).toBe(true);
    expect(/holds_fallback_office\(\)/i.test(fn.body)).toBe(true);

    const holder = lastFunction('holds_fallback_office');
    expect(
      /role_key\s+in\s*\(\s*'coo'\s*,\s*'ceo'\s*\)/i.test(holder.body),
      `gatepass.holds_fallback_office (in ${holder.file}) no longer names the two offices.`,
    ).toBe(true);
    expect(
      /r\.user_id\s*=\s*auth\.uid\(\)/i.test(holder.body) && !/deputy_id/i.test(holder.body),
      `gatepass.holds_fallback_office (in ${holder.file}) must match the HOLDER only. Emergency ` +
        `release is the last door in the system and does not travel to a deputy or a delegate.`,
    ).toBe(true);
    expect(
      /is_user_active\s*\(\s*auth\.uid\(\)\s*\)/i.test(holder.body),
      `gatepass.holds_fallback_office (in ${holder.file}) does not check that the caller is active. ` +
        `A suspended account would keep the one power nobody else has.`,
    ).toBe(true);
  });

  it('is NOT is_admin — it opens no admin screen', () => {
    const fn = lastFunction('is_super_admin');
    expect(
      /is_admin\s*\(\s*\)/i.test(fn.body),
      `gatepass.is_super_admin (in ${fn.file}) calls is_admin(). The fallback is a power on a pass ` +
        `record, not a portal: an office holder still gets only their queue and their delegation.`,
    ).toBe(false);
  });

  it('makes an office holder wait out the escalation window before releasing', () => {
    const fn = lastFunction('emergency_release_pass');
    expect(
      /is_super_admin\s*\(\s*\)/i.test(fn.body),
      `gatepass.emergency_release_pass (in ${fn.file}) no longer asks is_super_admin(). With the ` +
        `standing super admin account deleted, gating on the VMS role alone shuts the door for good.`,
    ).toBe(true);
    expect(
      /pass_is_stuck\s*\(\s*p_pass_id\s*\)/i.test(fn.body),
      `gatepass.emergency_release_pass (in ${fn.file}) lets an office holder release a pass without ` +
        `it being stuck. Colleagues still reading a pass are not colleagues who cannot be reached.`,
    ).toBe(true);
  });

  it('lets those two offices SEE a stuck pass, on both select policies', () => {
    for (const policy of ['gate_passes_select', 'gate_pass_items_select']) {
      const p = lastPolicy(policy);
      expect(
        /holds_fallback_office\(\)\s*and\s*gatepass\.pass_is_stuck/i.test(p.body),
        `policy ${policy} (last written in ${p.file}) has no fallback arm. 061 hides a pass from ` +
          `an approver until every rung below theirs is signed — which is exactly the pass this ` +
          `fallback exists for, so the power would have no reachable subject.`,
      ).toBe(true);

      // 061's own rule must survive alongside it: the arm is an addition, and a
      // rewrite that dropped the linear check would open every pending pass to
      // every office.
      expect(
        /pass_routed_to_me/i.test(p.body),
        `policy ${policy} (last written in ${p.file}) has lost pass_routed_to_me — 061's linear ` +
          `visibility rule.`,
      ).toBe(true);
    }
  });

  it('defines "stuck" as the admin’s own escalation window, not a constant', () => {
    const fn = lastFunction('pass_is_stuck');
    expect(
      /get_escalation_hours\(\)/i.test(fn.body),
      `gatepass.pass_is_stuck (in ${fn.file}) hardcodes a wait. It must read ` +
        `app_settings.coo_escalation_hours, so "waited too long" has one definition and not two.`,
    ).toBe(true);
    expect(
      /g\.status\s*=\s*'pending'/i.test(fn.body),
      `gatepass.pass_is_stuck (in ${fn.file}) does not require the pass to be pending. A cancelled ` +
        `pass was REJECTED in writing, and overturning that is a power this system does not have.`,
    ).toBe(true);
  });
});
