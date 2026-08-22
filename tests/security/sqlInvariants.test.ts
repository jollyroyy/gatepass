// Static checks on supabase/migrations/*.sql against the invariants CLAUDE.md
// calls out as "easy to break silently" — the kind of thing a future
// migration can violate without any error until an HOD reads another
// department's passes in production.
import { describe, expect, it } from 'vitest';
import { sqlMigrations, stripSqlComments } from './sourceScan';

/**
 * The only view in `gatepass` allowed to omit `security_invoker = true`.
 *
 * Adding to this list requires a security review: every other gatepass view
 * runs as the CALLER by design, so RLS on its base tables is enforced. This
 * one view is an intentional exception — it runs as its OWNER so that VMS's
 * (sometimes-recursive) policies on public.profiles are never evaluated. See
 * migration 006's header for the incident that made this necessary.
 */
const OWNER_RIGHTS_VIEWS = ['gatepass.profile_names'];

function allMigrationsText(): { name: string; sql: string }[] {
  return sqlMigrations().map((m) => ({ name: m.name, sql: stripSqlComments(m.sql) }));
}

/** Every `create (or replace) view gatepass.X ... ;` statement, across all migrations. */
function extractViews(migrations: { name: string; sql: string }[]) {
  const re = /create\s+(?:or replace\s+)?view\s+(gatepass\.\w+)([\s\S]*?);/gi;
  const views: { name: string; file: string; body: string }[] = [];
  for (const { name, sql } of migrations) {
    for (const m of sql.matchAll(re)) {
      views.push({ name: m[1], file: name, body: m[0] });
    }
  }
  return views;
}

/** Every `create (or replace) function gatepass.X` statement, up to the next such statement. */
function extractFunctions(migrations: { name: string; sql: string }[]) {
  const re = /create\s+(?:or replace\s+)?function\s+(gatepass\.\w+)/gi;
  const fns: { name: string; file: string; body: string }[] = [];
  for (const { name, sql } of migrations) {
    const matches = [...sql.matchAll(re)];
    matches.forEach((m, i) => {
      const start = m.index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : sql.length;
      fns.push({ name: m[1], file: name, body: sql.slice(start, end) });
    });
  }
  return fns;
}

/**
 * Every `check (...)` table constraint, across all migrations — NOT an RLS
 * policy's `with check (...)` clause, which is a query-time expression rather
 * than something Postgres validates at DDL time. Paren-matched rather than a
 * non-greedy regex because constraint bodies routinely contain nested parens,
 * e.g. `check ((type = 'RGP') = (expected_return_date is not null))`.
 */
function extractCheckConstraints(sql: string): string[] {
  const constraints: string[] = [];
  const re = /check\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const precedingText = sql.slice(Math.max(0, m.index - 10), m.index);
    if (/with\s*$/i.test(precedingText)) continue; // RLS "... with check (...)" — not a table constraint
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    constraints.push(sql.slice(start, i - 1));
  }
  return constraints;
}

describe('SQL invariants', () => {
  it('every gatepass view sets security_invoker = true, except the documented owner-rights exception', () => {
    const migrations = allMigrationsText();
    const views = extractViews(migrations);
    expect(views.length, 'no `create view gatepass.*` statements were found at all — extraction regex is broken').toBeGreaterThan(0);

    const missingInvoker = views
      .filter((v) => !OWNER_RIGHTS_VIEWS.includes(v.name))
      .filter((v) => !/security_invoker\s*=\s*true/i.test(v.body))
      .map((v) => `${v.file}: ${v.name}`);
    expect(
      missingInvoker,
      `these views omit security_invoker = true — without it a view runs as its OWNER and ` +
        `bypasses the RLS on its base tables entirely:\n${missingInvoker.join('\n')}`
    ).toEqual([]);

    const ownerViewsFound = views.filter((v) => OWNER_RIGHTS_VIEWS.includes(v.name));
    expect(
      ownerViewsFound.length,
      `OWNER_RIGHTS_VIEWS lists ${OWNER_RIGHTS_VIEWS.join(', ')} but no migration defines it`
    ).toBeGreaterThan(0);

    const wronglyInvoked = ownerViewsFound
      .filter((v) => /security_invoker\s*=\s*true/i.test(v.body))
      .map((v) => `${v.file}: ${v.name}`);
    expect(
      wronglyInvoked,
      `${OWNER_RIGHTS_VIEWS.join(', ')} is the one deliberate owner-rights view (it must NOT ` +
        `evaluate public.profiles' policies) — it has grown security_invoker = true and is no ` +
        `longer immune to VMS's recursive policy:\n${wronglyInvoked.join('\n')}`
    ).toEqual([]);
  });

  it('every security definer function pins set search_path = \'\'', () => {
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);
    expect(fns.length, 'no `create function gatepass.*` statements were found at all — extraction regex is broken').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const fn of fns) {
      const asIdx = fn.body.search(/as\s*\$\$/i);
      const signature = asIdx >= 0 ? fn.body.slice(0, asIdx) : fn.body;
      const isSecurityDefiner = /security\s+definer/i.test(signature);
      if (isSecurityDefiner && !/set\s+search_path\s*=\s*''/i.test(fn.body)) {
        offenders.push(`${fn.file}: ${fn.name}`);
      }
    }
    expect(
      offenders,
      `these SECURITY DEFINER functions do not pin search_path = '' — a mutable search_path ` +
        `on a security definer function is a privilege-escalation vector:\n${offenders.join('\n')}`
    ).toEqual([]);

    // The loop above only fails on a function it actually SAW. If the extraction
    // regex ever stops matching lookup_pass or cancel_pass (renamed, reformatted
    // signature, moved to a differently-named migration), the offenders list stays
    // empty and this whole test passes without having checked them at all — a
    // false green. Pin that both were found, not just that neither is an offender.
    for (const required of ['gatepass.lookup_pass', 'gatepass.cancel_pass']) {
      expect(
        fns.some((fn) => fn.name === required),
        `${required} (migration 008, SECURITY DEFINER) was not found by the function-extraction ` +
          `regex — this test would otherwise pass vacuously without ever checking its search_path`
      ).toBe(true);
    }
  });

  it('gatepass.normalize_material and gatepass.site_tz are declared immutable', () => {
    // gate_passes_one_pending_per_material_idx (migration 008) is a unique index
    // built on normalize_material's output; Postgres trusts an IMMUTABLE
    // function's result to never change for the same input. site_tz feeds the
    // expiry window computation that depends on the same trust. If either loses
    // IMMUTABLE, Postgres either stops letting the index use it, or — worse —
    // keeps trusting a stale answer without complaint.
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);

    for (const name of ['gatepass.normalize_material', 'gatepass.site_tz']) {
      const definitions = fns.filter((fn) => fn.name === name);
      expect(definitions.length, `no migration defines ${name}`).toBeGreaterThan(0);
      const final = definitions[definitions.length - 1]; // highest-numbered migration wins

      expect(
        /\bimmutable\b/i.test(final.body),
        `${name}'s final definition (in ${final.file}) is not declared IMMUTABLE. ` +
          `gate_passes_one_pending_per_material_idx depends on normalize_material, and site_tz feeds ` +
          `expires_at — a non-immutable function backing either is a correctness risk Postgres will not ` +
          `catch for you: the index (or the expiry window) can silently disagree with a re-evaluated result.`
      ).toBe(true);
    }
  });

  it("no migration references the enum value 'cancelled' where Postgres evaluates it at DDL time " +
    "(a `language sql` function body or a CHECK constraint)", () => {
    // See migration 008's header: `alter type gatepass.pass_status add value 'cancelled'` cannot be
    // USED in the same transaction that adds it, and APPLY_ALL.sql pastes every migration into ONE
    // transaction. A `language sql` function body is parse-validated at CREATE time, and a CHECK
    // constraint is validated when it's added — either one naming 'cancelled' aborts the entire paste
    // with "unsafe use of new value ... of enum type gatepass.pass_status". plpgsql bodies are exempt
    // (stored as text, only syntax-checked at CREATE time) — that's exactly why cancel_pass is plpgsql
    // and why gatepass.kpis() (language sql) was deliberately NOT extended with a cancelled counter in
    // migration 008. This is the single easiest thing for a future migration to break silently: it
    // would type-check and lint clean, and only fail the instant someone pastes APPLY_ALL.sql fresh.
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);
    const offenders: string[] = [];

    for (const fn of fns) {
      const asIdx = fn.body.search(/as\s*\$\$/i);
      const signature = asIdx >= 0 ? fn.body.slice(0, asIdx) : fn.body;
      const isSqlLanguage = /language\s+sql\b/i.test(signature) && !/language\s+plpgsql\b/i.test(signature);
      if (!isSqlLanguage) continue;

      const bodyMatch = fn.body.match(/as\s*\$\$([\s\S]*?)\$\$/i);
      const dollarBody = bodyMatch ? bodyMatch[1] : fn.body;
      if (/'cancelled'/i.test(dollarBody)) {
        offenders.push(`${fn.file}: language sql function ${fn.name}`);
      }
    }

    let checkConstraintsFound = 0;
    for (const { name, sql } of migrations) {
      for (const body of extractCheckConstraints(sql)) {
        checkConstraintsFound++;
        if (/'cancelled'/i.test(body)) {
          offenders.push(`${name}: check (${body.trim()})`);
        }
      }
    }

    // Sanity: both extraction paths must actually see real examples somewhere in
    // this migration set, or a silent regex break would make this test vacuous.
    const sqlLanguageFnsFound = fns.filter((fn) => {
      const asIdx = fn.body.search(/as\s*\$\$/i);
      const signature = asIdx >= 0 ? fn.body.slice(0, asIdx) : fn.body;
      return /language\s+sql\b/i.test(signature) && !/language\s+plpgsql\b/i.test(signature);
    });
    expect(
      sqlLanguageFnsFound.length,
      'no `language sql` functions were found at all — extraction regex is broken'
    ).toBeGreaterThan(0);
    expect(
      checkConstraintsFound,
      'no `check (...)` table constraints were found at all — extraction is broken'
    ).toBeGreaterThan(0);

    expect(
      offenders,
      `found a reference to the enum value 'cancelled' somewhere Postgres evaluates at DDL time ` +
        `(a \`language sql\` function body or a CHECK constraint) — see migration 008's header for why ` +
        `this aborts the whole APPLY_ALL.sql paste:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('no migration performs DDL on the public schema (VMS owns it)', () => {
    const migrations = allMigrationsText();
    const forbidden: { label: string; re: RegExp }[] = [
      { label: 'alter table public.', re: /alter\s+table\s+public\./i },
      { label: 'create table public.', re: /create\s+table\s+(?:if not exists\s+)?public\./i },
      { label: 'drop table public.', re: /drop\s+table\s+(?:if exists\s+)?public\./i },
      { label: 'create policy ... on public.', re: /create\s+policy[\s\S]{0,200}?\bon\s+public\./i },
      { label: 'drop policy ... on public.', re: /drop\s+policy[\s\S]{0,200}?\bon\s+public\./i },
      { label: 'alter policy ... on public.', re: /alter\s+policy[\s\S]{0,200}?\bon\s+public\./i },
      { label: 'create trigger ... on public.', re: /create\s+trigger[\s\S]{0,200}?\bon\s+public\./i },
    ];

    const offenders: string[] = [];
    for (const { name, sql } of migrations) {
      for (const { label, re } of forbidden) {
        if (re.test(sql)) offenders.push(`${name}: ${label}`);
      }
    }
    expect(
      offenders,
      `a migration performs DDL on the public schema — that schema belongs to VMS; new objects ` +
        `must go in gatepass and reference public.* only by foreign key/join/select:\n` +
        `${offenders.join('\n')}`
    ).toEqual([]);
  });

  // UPDATE stays absolutely forbidden (the RPC-only state machine depends on
  // it). DELETE has exactly one approved exception as of migration 010: an
  // HOD may delete their OWN pass while it is still 'pending' — a deliberate,
  // user-approved trade (see 010's header) so a genuine mistake needn't live
  // forever. Policy `gate_passes_delete` (010) scopes it to own+pending+hod;
  // security/admin get no delete grant. So this allows exactly that one grant
  // statement in 010_direction_and_hod_delete.sql and still fails a delete
  // grant/policy anywhere else, or any looser one there.
  it('no migration grants or allows update on gatepass.gate_passes, and delete is confined to the one approved HOD-delete grant', () => {
    const APPROVED_DELETE_GRANT_FILE = '010_direction_and_hod_delete.sql';
    const migrations = allMigrationsText();
    const offenders: string[] = [];
    let approvedDeleteGrantFound = false;

    const grantRe = /grant\s+([^;]*?)\s+on\s+gatepass\.gate_passes\b/gi;
    const policyRe = /create\s+policy[\s\S]{0,200}?\bon\s+gatepass\.gate_passes\s+for\s+(update|delete)\b/gi;

    for (const { name, sql } of migrations) {
      for (const m of sql.matchAll(grantRe)) {
        const privileges = m[1].toLowerCase();
        if (/\bupdate\b/.test(privileges)) {
          offenders.push(`${name}: grants "${m[1].trim()}" on gatepass.gate_passes`);
        } else if (/\bdelete\b/.test(privileges)) {
          if (name === APPROVED_DELETE_GRANT_FILE) approvedDeleteGrantFound = true;
          else offenders.push(`${name}: grants "${m[1].trim()}" on gatepass.gate_passes`);
        }
      }
      for (const m of sql.matchAll(policyRe)) {
        const kind = m[1].toLowerCase();
        if (kind === 'update' || name !== APPROVED_DELETE_GRANT_FILE) {
          offenders.push(`${name}: a "for ${kind}" policy exists on gatepass.gate_passes`);
        }
      }
    }

    expect(
      approvedDeleteGrantFound,
      `expected the one approved delete grant in ${APPROVED_DELETE_GRANT_FILE} — not found, so the ` +
        `migration was renamed/reworded, or this test would pass vacuously without checking it`
    ).toBe(true);

    expect(
      offenders,
      `state changes on gatepass.gate_passes must go exclusively through match_pass/flag_pass/` +
        `mark_returned (003) — UPDATE is never permitted, and DELETE only via the single own+pending+hod ` +
        `grant in ${APPROVED_DELETE_GRANT_FILE}:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('the final definitions of v_gate_passes and v_verifications join gatepass.profile_names, not public.profiles', () => {
    const migrations = allMigrationsText(); // sorted by filename => later migrations come last
    const views = extractViews(migrations);

    for (const viewName of ['gatepass.v_gate_passes', 'gatepass.v_verifications']) {
      const definitions = views.filter((v) => v.name === viewName);
      expect(definitions.length, `no migration defines ${viewName}`).toBeGreaterThan(0);
      const final = definitions[definitions.length - 1]; // last in filename order = highest-numbered

      expect(
        /join\s+public\.profiles/i.test(final.body),
        `${viewName}'s final definition (in ${final.file}) still joins public.profiles directly — ` +
          `migration 006 repointed this to gatepass.profile_names so a recursive VMS policy can't ` +
          `abort the query`
      ).toBe(false);

      expect(
        /join\s+gatepass\.profile_names/i.test(final.body),
        `${viewName}'s final definition (in ${final.file}) does not join gatepass.profile_names — ` +
          `it should, per migration 006`
      ).toBe(true);
    }
  });

  it('the material-uniqueness index blocks a second pass while an earlier one is still OUT, not merely while it is pending', () => {
    // Migration 008 keyed this index on `where status = 'pending'` alone, which
    // covers only the window between raising a pass and the guard verifying it.
    // The moment a guard MATCHES an RGP the row becomes matched/awaiting_return,
    // drops out of that predicate, and a second pass could be raised for material
    // that is still physically outside the mall. Since migration 020 the index
    // uses `is_open` (trigger-maintained — true for pending, awaiting_return, and
    // partially_returned), which is the canonical condition. The migration 013/020
    // DDL must mention `awaiting_return` either in the index body or as a comment
    // on the index so that a reader (and this test) can verify the "still out" case
    // is covered.
    const migrations = allMigrationsText();

    const re =
      /create\s+unique\s+index\s+(?:if not exists\s+)?(\w+)\s+on\s+gatepass\.gate_passes([\s\S]*?);/gi;
    const indexes: { name: string; file: string; body: string }[] = [];
    // Also scan the items table index (moved there in 013, scoped per-pass in 020).
    const reItems =
      /create\s+unique\s+index\s+(?:if not exists\s+)?(\w+)\s+on\s+gatepass\.gate_pass_items([\s\S]*?);/gi;
    for (const { name, sql } of migrations) {
      for (const m of sql.matchAll(re)) {
        indexes.push({ name: m[1], file: name, body: m[0] });
      }
      for (const m of sql.matchAll(reItems)) {
        indexes.push({ name: m[1], file: name, body: m[0] });
      }
    }

    const materialIndexes = indexes.filter((i) => /normalize_material/i.test(i.body));
    expect(
      materialIndexes.length,
      'no unique index on gatepass.gate_passes or gate_pass_items is built over ' +
        'normalize_material — the one-pass-per-item rule has no enforcement at all, or ' +
        'the extraction regex is broken'
    ).toBeGreaterThan(0);

    const live = materialIndexes[materialIndexes.length - 1]; // highest-numbered migration wins

    // Migration 020 uses `is_open` (trigger-maintained, true for pending +
    // awaiting_return + partially_returned) as the WHERE predicate. The test
    // accepts either the literal string 'awaiting_return' or 'is_open' — both
    // prove the index covers the "still out" case and not just 'pending'.
    const mentionsAwaiting = /awaiting_return/i.test(live.body);
    const usesIsOpen = /\bis_open\b/i.test(live.body);
    expect(
      mentionsAwaiting || usesIsOpen,
      `the live material-uniqueness index (${live.name}, in ${live.file}) neither mentions ` +
        `awaiting_return nor uses is_open (trigger-maintained). Without one of these its predicate ` +
        `stops applying the instant a guard matches the pass — a second RGP could then be raised for ` +
        `material that has not come back yet.`
    ).toBe(true);

    // A dropped index is not enforcement. If 012 retired the pending-only index,
    // no migration may leave it live afterwards.
    const droppedPendingIdx = migrations.some(({ sql }) =>
      /drop\s+index\s+(?:if exists\s+)?gatepass\.gate_passes_one_pending_per_material_idx/i.test(sql)
    );
    const pendingIdxCreated = materialIndexes.some(
      (i) => i.name === 'gate_passes_one_pending_per_material_idx'
    );
    if (pendingIdxCreated) {
      expect(
        droppedPendingIdx,
        'gate_passes_one_pending_per_material_idx (008) is still created and never dropped, but a ' +
          'wider replacement exists — two overlapping unique indexes on the same key means the ' +
          'narrow one still rejects inserts the wide one was rewritten to allow'
      ).toBe(true);
    }
  });

  it('gatepass.validate_pass is plpgsql, because it necessarily names the enum value \'cancelled\'', () => {
    // The rule "a cancelled pass must carry a reason" could not be a CHECK
    // constraint in 008 — 'cancelled' was added by that same migration, and
    // APPLY_ALL.sql is one transaction (TRAP 1). It still cannot be one in 012,
    // for the identical reason: a fresh paste runs 008 and 012 in the SAME
    // transaction. So the rule lives in a trigger, and that trigger MUST be
    // plpgsql — a `language sql` body is parse-validated at CREATE time and would
    // abort the whole paste.
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);
    const definitions = fns.filter((fn) => fn.name === 'gatepass.validate_pass');

    expect(
      definitions.length,
      'no migration defines gatepass.validate_pass — migration 012 should, as the home for every ' +
        'rule that needs now() or the cancelled label and therefore cannot be a CHECK constraint'
    ).toBeGreaterThan(0);

    const final = definitions[definitions.length - 1];
    const asIdx = final.body.search(/as\s*\$\$/i);
    const signature = asIdx >= 0 ? final.body.slice(0, asIdx) : final.body;

    expect(
      /language\s+plpgsql\b/i.test(signature),
      `gatepass.validate_pass (in ${final.file}) is not declared language plpgsql. It references ` +
        `the 'cancelled' enum value, which Postgres evaluates at CREATE time for a language sql ` +
        `body — that aborts the entire APPLY_ALL.sql paste with "unsafe use of new value".`
    ).toBe(true);

    expect(
      /security\s+definer/i.test(signature) ? /set\s+search_path\s*=\s*''/i.test(final.body) : true,
      `gatepass.validate_pass is SECURITY DEFINER but does not pin search_path = ''`
    ).toBe(true);
  });

  it('is_overdue is computed exactly once, in the final gatepass.v_gate_passes definition', () => {
    // NOTE: a raw grep of "as is_overdue" across every migration file finds
    // it TWICE (004 defines it, 006's `create or replace view` legitimately
    // restates the same view — its own header says so: "Repoint the views
    // away from public.profiles ... Supersedes the profiles joins in 004").
    // That is ordinary migration history, not a duplicate computation, so
    // this check looks at the FINAL definition only — the same "highest-
    // numbered migration wins" rule used for the profile_names join above —
    // and asserts the computation appears exactly once there.
    const migrations = allMigrationsText();
    const views = extractViews(migrations);
    const definitions = views.filter((v) => v.name === 'gatepass.v_gate_passes');
    expect(definitions.length, 'no migration defines gatepass.v_gate_passes').toBeGreaterThan(0);
    const final = definitions[definitions.length - 1];

    const occurrences = (final.body.match(/as\s+is_overdue/gi) ?? []).length;
    expect(
      occurrences,
      `gatepass.v_gate_passes' final definition (in ${final.file}) computes is_overdue ` +
        `${occurrences} times — it must be defined exactly once so no caller can ever see two ` +
        `disagreeing answers for the same pass`
    ).toBe(1);
  });

  it('one department per person: the unique index on hod_departments (hod_id) exists and is never dropped', () => {
    // Migration 032: a person belongs to AT MOST ONE department. VMS models
    // this structurally (public.profiles.department_id is a single column);
    // gatepass.hod_departments was a join table, so this unique index is the
    // one enforcement that closes both apps' gap. Admin RPCs validate too,
    // but the index is the backstop — any writer, past or future, hits a
    // 23505 instead of silently creating a two-department person.
    const migrations = allMigrationsText();

    const created = migrations.some((m) =>
      /create\s+unique\s+index\s+(?:if not exists\s+)?hod_departments_one_department_per_person\s+on\s+gatepass\.hod_departments\s*\(\s*hod_id\s*\)/i.test(m.sql)
    );
    expect(
      created,
      'no migration creates a unique index on gatepass.hod_departments (hod_id) — the ' +
        'one-department-per-person rule has no database enforcement at all'
    ).toBe(true);

    const dropped = migrations.some((m) =>
      /drop\s+index\s+(?:if exists\s+)?(?:gatepass\.)?hod_departments_one_department_per_person/i.test(m.sql)
    );
    expect(
      dropped,
      'hod_departments_one_department_per_person is dropped by a later migration — that would ' +
        'silently reopen the many-to-many; if the rule changes, delete this test in the same change'
    ).toBe(false);
  });

  it('admin_create_user and admin_update_user refuse >1 department and mirror it into public.profiles.department_id', () => {
    // The RPCs themselves must not be a second source of truth: they REJECT
    // a multi-department array (so the UI cannot even produce a doomed
    // insert), and they write the sole department into VMS's single-column
    // authority so both apps read the same fact for the same person (032).
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);

    for (const name of ['gatepass.admin_create_user', 'gatepass.admin_update_user']) {
      const definitions = fns.filter((fn) => fn.name === name);
      expect(definitions.length, `no migration defines ${name}`).toBeGreaterThan(0);
      const final = definitions[definitions.length - 1]; // highest-numbered migration wins

      const hasGuard = /array_length\s*\(\s*p_department_ids\s*,\s*1\s*\)\s*>\s*1/i.test(final.body);
      expect(
        hasGuard,
        `${name}'s final definition (in ${final.file}) does not reject a p_department_ids array ` +
          `longer than one — the UI could then build a two-department person that only the unique ` +
          `index would catch (after a 23505 surfacing as a confusing "already exists" error)`
      ).toBe(true);

      const mirrors =
        /update\s+public\.profiles[\s\S]*?department_id/i.test(final.body) &&
        /\bv_dept\b/i.test(final.body);
      expect(
        mirrors,
        `${name}'s final definition (in ${final.file}) does not write the chosen department into ` +
          `public.profiles.department_id — GatePass and VMS would then disagree about which ` +
          `department this person belongs to`
      ).toBe(true);
    }
  });

  // 034. GoTrue scans auth.users' token columns into Go `string`, which cannot
  // hold NULL. Those columns are nullable with NO default, so an INSERT that
  // omits them leaves NULLs behind and every later sign-in for that account
  // dies inside the auth server with "converting NULL to string is
  // unsupported" — a 500, not "invalid credentials". The account looks
  // perfectly healthy in the dashboard; only the login fails, and only for
  // users this RPC created.
  it('admin_create_user writes empty strings, never NULL, into auth.users token columns', () => {
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);

    const definitions = fns.filter((fn) => fn.name === 'gatepass.admin_create_user');
    expect(definitions.length, 'no migration defines gatepass.admin_create_user').toBeGreaterThan(0);
    const final = definitions[definitions.length - 1]; // highest-numbered migration wins

    // Only these four are nullable AND default-less on auth.users (verified live
    // 2026-08-08). phone_change / phone_change_token / email_change_token_current /
    // reauthentication_token all default to '' and so are safe to omit.
    for (const column of [
      'confirmation_token',
      'recovery_token',
      'email_change',
      'email_change_token_new',
    ]) {
      expect(
        new RegExp(`\\b${column}\\b`, 'i').test(final.body),
        `admin_create_user's final definition (in ${final.file}) does not set auth.users.${column}. ` +
          `It has no column default, so the row is written with NULL and GoTrue fails every ` +
          `sign-in for that user with "converting NULL to string is unsupported" (HTTP 500)`
      ).toBe(true);
    }
  });

  it('a migration repairs the auth.users rows admin_create_user already wrote with NULL tokens', () => {
    // Fixing the function only helps users created from now on. Accounts made
    // before 034 are already broken in the live database and cannot sign in at
    // all, so the migration must backfill them too.
    const migrations = allMigrationsText();
    const repaired = migrations.some(
      (m) =>
        /update\s+auth\.users/i.test(m.sql) &&
        /confirmation_token\s*=\s*coalesce\s*\(\s*confirmation_token\s*,\s*''\s*\)/i.test(m.sql)
    );
    expect(
      repaired,
      "no migration backfills auth.users.confirmation_token (and its siblings) from NULL to '' — " +
        'every user the admin panel created before this fix stays permanently unable to sign in'
    ).toBe(true);
  });

  // 035 — an override approval makes the pass FRESH at the gate.
  // - hod_review_flagged_pass (approve) must refresh expires_at to the end of
  //   the current day, or an old flagged pass that the HOD clears today would
  //   still be refused by match_pass's expiry check and the whole override
  //   flow would be a dead end.
  // - flag_pass must accept hod_reviewed, so a guard can re-flag a pass whose
  //   HOD override did not fix the mismatch — the gate keeps both options.
  // - v_gate_passes must expose flagged_at and hod_reviewed_at so every card
  //   can show the full timeline (raised → mismatch → override) from ONE row.
  it('035: the HOD override refreshes expiry, flag_pass accepts hod_reviewed, and the view carries the audit timestamps', () => {
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);

    const review = fns.filter((fn) => fn.name === 'gatepass.hod_review_flagged_pass').pop();
    expect(review, 'no migration defines gatepass.hod_review_flagged_pass (015/024/027)').toBeDefined();
    expect(
      /update\s+gatepass\.gate_passes[\s\S]*?set\s+[\s\S]*?expires_at\s*=/i.test(review!.body),
      `hod_review_flagged_pass's final definition (in ${review!.file}) no longer refreshes ` +
        `expires_at on approve — an override-approved pass keeps its original expiry and is refused ` +
        `by match_pass the moment it has passed, making the HOD's clearance a dead end`
    ).toBe(true);

    const flag = fns.filter((fn) => fn.name === 'gatepass.flag_pass').pop();
    expect(flag, 'no migration defines gatepass.flag_pass (003/014?)').toBeDefined();
    expect(
      /'\s*hod_reviewed\s*'/i.test(flag!.body),
      `flag_pass's final definition (in ${flag!.file}) no longer admits 'hod_reviewed'. The gate ` +
        `must keep the mismatch option open on an override-approved pass — approving is HOD's ` +
        `judgement, not a fact about the material.`
    ).toBe(true);

    const view = extractViews(migrations)
      .filter((v) => v.name === 'gatepass.v_gate_passes')
      .pop();
    expect(view, 'no migration defines gatepass.v_gate_passes').toBeDefined();
    expect(
      /\bas\s+flagged_at\b/i.test(view!.body) && /\bas\s+hod_reviewed_at\b/i.test(view!.body),
      `v_gate_passes' final definition (in ${view!.file}) does not expose flagged_at and ` +
        `hod_reviewed_at. The card timeline (raised → mismatched → override-approved) needs them ` +
        `on the one row every list already reads.`
    ).toBe(true);
  });

  // Migration 033 closed two live defects: (a) a company name stored under the
  // WRONG list_type was never matched by the raise-time trigger, and (b) the
  // 'vehicle' type accepted any text ('thar') instead of a real Indian plate.
  // These checks pin the final definitions so neither regression can return
  // silently: the trigger must compare the company name against every entry
  // regardless of type, and vehicle entries must pass is_indian_vehicle and be
  // stored normalized.
  it('033: the raise-time blacklist trigger matches a company name against ANY entry type, and vehicle entries are Indian-format-checked and normalized', () => {
    const migrations = allMigrationsText();
    const fns = extractFunctions(migrations);

    const trigger = fns.filter((fn) => fn.name === 'gatepass.enforce_blacklist').pop();
    expect(trigger, 'no migration defines gatepass.enforce_blacklist (027/033) — the raise-time blacklist is unenforced').toBeDefined();

    // The company-name arm must NOT be restricted to list_type = 'company':
    // 'Yadav Infotech' filed under 'vehicle' blocked nothing in 027. A
    // regression to a typed comparison would re-open the hole.
    expect(
      /company_name_of/i.test(trigger!.body),
      `gatepass.enforce_blacklist (${trigger!.file}) no longer reads the company via company_name_of — ` +
        `the JSON-wrapped visitor_company would never match a blacklist value`
    ).toBe(true);
    expect(
      /lower\s*\(\s*trim\s*\(\s*b\.list_value\s*\)\s*\)\s*=\s*lower\s*\(\s*trim\s*\(\s*v_company\s*\)\s*\)/i.test(trigger!.body),
      `gatepass.enforce_blacklist (${trigger!.file}) no longer compares the company name case-insensitively ` +
        `against ANY list entry — a vendor blacklisted under the wrong type can slip through again`
    ).toBe(true);
    expect(
      /normalize_vehicle/i.test(trigger!.body),
      `gatepass.enforce_blacklist (${trigger!.file}) no longer normalizes the vehicle number — ` +
        `WB 09 AB 1234 and wb-09-ab-1234 would stop matching each other`
    ).toBe(true);
    expect(
      /security\s+definer/i.test(trigger!.body) &&
        /set\s+search_path\s*=\s*''/i.test(trigger!.body),
      `gatepass.enforce_blacklist (${trigger!.file}) must stay SECURITY DEFINER with search_path pinned`
    ).toBe(true);

    const addEntry = fns.filter((fn) => fn.name === 'gatepass.add_blacklist_entry').pop();
    expect(addEntry, 'no migration defines gatepass.add_blacklist_entry').toBeDefined();
    expect(
      /is_indian_vehicle/i.test(addEntry!.body),
      `gatepass.add_blacklist_entry (${addEntry!.file}) no longer validates the Indian plate format on 'vehicle' entries — random alphanumerics can enter the blacklist again`
    ).toBe(true);
    expect(
      /normalize_vehicle/i.test(addEntry!.body),
      `gatepass.add_blacklist_entry (${addEntry!.file}) no longer stores the plate in normalized form — ` +
        `the same car can be blacklisted under two spellings`
    ).toBe(true);
    expect(
      /security\s+definer/i.test(addEntry!.body) &&
        /set\s+search_path\s*=\s*''/i.test(addEntry!.body),
      `gatepass.add_blacklist_entry (${addEntry!.file}) must stay SECURITY DEFINER with search_path pinned`
    ).toBe(true);

    // The gate-side warning must agree with the raise-time refusal.
    const lookup = fns.filter((fn) => fn.name === 'gatepass.lookup_pass').pop();
    expect(lookup, 'no migration defines gatepass.lookup_pass').toBeDefined();
    expect(
      /company_name_of/i.test(lookup!.body) && /normalize_vehicle/i.test(lookup!.body),
      `gatepass.lookup_pass (${lookup!.file}) no longer applies the 033 matching rules — the guard's ` +
        `blacklist warning would disagree with the HOD's raise-time refusal`
    ).toBe(true);
  });
});

// 038: v_gate_passes must carry total_value, and rebuilding the view must not
// silently drop security_invoker. That flag is the whole reason the view is
// safe: without it the view runs as its OWNER and bypasses RLS entirely, so
// every HOD would read every department's passes. A view rebuild is exactly
// when it gets forgotten, because `create or replace` cannot add a column and
// the drop+create is written by hand.
describe('038 — pass total_value', () => {
  const sql = sqlMigrations().find((m) => m.name.startsWith('038'))!.sql;

  it('adds total_value to the view', () => {
    expect(sql).toMatch(/AS total_value/);
  });

  it('sums approx_value, matching 016 overdue_value', () => {
    // If this ever becomes sum(quantity * approx_value), a pass's card and the
    // overdue KPI will report different money for the same pass.
    expect(sql).toMatch(/sum\(i\.approx_value\)/);
  });

  it('rebuilds the view WITH security_invoker', () => {
    expect(sql).toMatch(/create view gatepass\.v_gate_passes with \(security_invoker = true\)/i);
  });

  it('re-applies the select grant the drop took away', () => {
    expect(sql).toMatch(/grant select on gatepass\.v_gate_passes to authenticated/i);
  });
});

// 039: a blacklisted vendor comes off the list ONLY via a justified request the
// designated CEO approves. Every test here guards a way the chain could be
// made optional again without any error appearing — the dangerous failure
// mode, because the screens would keep working and the control would be gone.
describe('039 — whitelisting needs a justification and the CEO', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('039'))!.sql;
  const bare = stripSqlComments(sql);

  it('drops the one-click removal, so no path deletes an entry without approval', () => {
    expect(bare).toMatch(/drop function if exists gatepass\.remove_blacklist_entry\(uuid\)/i);
  });

  it('no later migration brings remove_blacklist_entry back', () => {
    const later = migrations.filter((m) => m.name > '039').map((m) => stripSqlComments(m.sql));
    for (const s of later) {
      expect(
        /create\s+(?:or replace\s+)?function\s+gatepass\.remove_blacklist_entry/i.test(s),
        'remove_blacklist_entry was re-created — the CEO approval chain is bypassable again'
      ).toBe(false);
    }
  });

  it('the request RPC refuses a blank or token justification', () => {
    const body = bare.slice(bare.indexOf('function gatepass.request_vendor_whitelist'));
    expect(body).toMatch(/length\(trim\(coalesce\(p_justification, ''\)\)\) < 10/i);
    expect(body).toMatch(/raise exception/i);
  });

  it('the database refuses an unjustified request even if the RPC is bypassed', () => {
    expect(bare).toMatch(/whitelist_requests_justification_substantive/i);
  });

  it('only the designated CEO can approve or reject', () => {
    for (const fn of ['approve_whitelist_request', 'reject_whitelist_request']) {
      const start = bare.indexOf(`function gatepass.${fn}`);
      expect(start, `${fn} is not defined`).toBeGreaterThan(-1);
      const body = bare.slice(start, start + 1600);
      expect(body, `${fn} must gate on gatepass.is_ceo()`).toMatch(/if not gatepass\.is_ceo\(\)/i);
    }
  });

  it('approval — and only approval — deletes the blacklist entry', () => {
    const start = bare.indexOf('function gatepass.approve_whitelist_request');
    const body = bare.slice(start, start + 1600);
    expect(body).toMatch(/delete from gatepass\.blacklist/i);
    // The request RPC must never delete anything: the entry stays enforced
    // while the CEO considers it.
    const reqStart = bare.indexOf('function gatepass.request_vendor_whitelist');
    const reqBody = bare.slice(reqStart, bare.indexOf('function gatepass.list_whitelist_requests'));
    expect(reqBody).not.toMatch(/delete from gatepass\.blacklist/i);
  });

  it('only a super_admin designates the CEO, and only an admin account can be designated', () => {
    const start = bare.indexOf('function gatepass.set_ceo_approver');
    const body = bare.slice(start, start + 1600);
    expect(
      /gatepass\.app_role\(\)\s*<>\s*'super_admin'/i.test(body),
      'an admin who can nominate the CEO can nominate themselves and self-approve'
    ).toBe(true);
    expect(body).toMatch(/not in \('admin', 'super_admin'\)/i);
  });

  it('there can only ever be one CEO', () => {
    expect(bare).toMatch(/only_row\s+boolean primary key/i);
    expect(bare).toMatch(/ceo_approver_single_row check \(only_row\)/i);
  });

  it('an approved request survives the deletion of the entry it unblocked', () => {
    // ON DELETE CASCADE here would erase the audit trail at the exact moment
    // it becomes the only record that the vendor was ever blocked.
    expect(bare).toMatch(/blacklist_id\s+uuid references gatepass\.blacklist\(id\) on delete set null/i);
    expect(bare).toMatch(/list_value\s+text not null/i);
    expect(bare).toMatch(/blocked_reason\s+text not null/i);
  });

  it('one open request per entry, but a rejected vendor can be asked about again', () => {
    expect(bare).toMatch(
      /create unique index if not exists whitelist_requests_one_pending_per_entry[\s\S]*?where status = 'pending'/i
    );
  });

  it('neither new table hands the client a write grant — the RPCs are the only writers', () => {
    for (const table of ['gatepass.ceo_approver', 'gatepass.whitelist_requests']) {
      expect(bare).toMatch(new RegExp(`enable row level security`, 'i'));
      expect(
        new RegExp(`grant\\s+(?:insert|update|delete|all)[^;]*on\\s+${table.replace('.', '\\.')}`, 'i').test(bare),
        `${table} must be RPC-only`
      ).toBe(false);
    }
  });
});

// 040: "inactive" became a status instead of a role. The dangerous failure mode
// is not a compile error — it is a suspended guard whose JWT still says `guard`
// walking back into the console because one policy path never learned to ask.
describe('040 — deactivation is a status, enforced in Postgres', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('040'))!.sql;
  const bare = stripSqlComments(sql);

  /** The final deployed body of a gatepass function, across all migrations. */
  function finalBody(fn: string): string {
    const all = extractFunctions(allMigrationsText()).filter((f) => f.name === `gatepass.${fn}`);
    expect(all.length, `${fn} is not defined in any migration`).toBeGreaterThan(0);
    return all[all.length - 1].body;
  }

  it('app_role() returns nothing for a deactivated caller', () => {
    // is_security() and is_admin() both read app_role(), so this one wrapper
    // closes every policy and RPC gated on either.
    expect(finalBody('app_role')).toMatch(/gatepass\.is_user_active\(auth\.uid\(\)\)/i);
  });

  it('my_department_ids() returns nothing for a deactivated HOD', () => {
    // gate_passes_select admits `department_id in (select my_department_ids())`
    // — the ONE path in that does not consult app_role(). Miss it and a
    // suspended HOD keeps reading and raising their department's passes.
    expect(finalBody('my_department_ids')).toMatch(/gatepass\.is_user_active\(auth\.uid\(\)\)/i);
  });

  it('is_user_active() calls no other gate, so the status policy cannot recurse', () => {
    const body = finalBody('is_user_active');
    expect(body).toMatch(/security definer/i);
    for (const gate of ['app_role', 'is_admin', 'is_security']) {
      expect(
        new RegExp(`gatepass\\.${gate}\\(`).test(body),
        `is_user_active must not call ${gate}() — user_status_select reads is_admin()`
      ).toBe(false);
    }
  });

  it('an absent status row means active, so no backfill can lock anyone out', () => {
    expect(finalBody('is_user_active')).toMatch(/coalesce\([\s\S]*?,\s*true\s*\)/i);
  });

  it('user_status is RLS-enabled and RPC-only', () => {
    expect(bare).toMatch(/alter table gatepass\.user_status enable row level security/i);
    expect(
      /grant\s+(?:insert|update|delete|all)[^;]*on\s+gatepass\.user_status/i.test(bare),
      'user_status must be written only by admin_soft_delete_user / admin_reactivate_user'
    ).toBe(false);
  });

  it('deactivation no longer rewrites the person\'s role in VMS\'s table', () => {
    const body = finalBody('admin_soft_delete_user');
    expect(
      /update public\.profiles/i.test(body),
      'suspending someone must not touch public.profiles — the role has to survive it'
    ).toBe(false);
    expect(body).toMatch(/insert into gatepass\.user_status/i);
    expect(body).toMatch(/is_active\s*=\s*false/i);
  });

  it('deactivation kills the live session, so a valid JWT cannot outlast it', () => {
    expect(finalBody('admin_soft_delete_user')).toMatch(/delete from auth\.sessions where user_id = p_user_id/i);
  });

  it('deactivation keeps the HOD\'s department, so reactivating restores their exact scope', () => {
    expect(
      /delete from gatepass\.hod_departments/i.test(finalBody('admin_soft_delete_user')),
      'the assignment is inert while inactive (my_department_ids checks the flag) — deleting it ' +
        'means an admin has to re-derive which department the person held'
    ).toBe(false);
  });

  it('neither deactivation nor reactivation can target an admin', () => {
    expect(finalBody('admin_soft_delete_user')).toMatch(/in \('admin', 'super_admin'\)/i);
    // Reactivation is gated the other way round: only a real app role qualifies.
    expect(finalBody('admin_reactivate_user')).toMatch(/not in \('guard', 'hod'\)/i);
  });

  it('you cannot deactivate yourself', () => {
    expect(finalBody('admin_soft_delete_user')).toMatch(/p_user_id = auth\.uid\(\)/i);
  });

  it('the admin portal can no longer write the role staff', () => {
    for (const fn of ['admin_create_user', 'admin_update_user']) {
      const body = finalBody(fn);
      expect(body, `${fn} must allow guard and hod only`).toMatch(
        /not in \('guard', 'hod'\)/i
      );
      expect(
        /'guard', 'hod', 'staff'/i.test(body),
        `${fn} still admits 'staff' — deactivation would go back to demoting people`
      ).toBe(false);
    }
  });

  it('040 keeps every earlier fix to the two admin user functions', () => {
    const create = finalBody('admin_create_user');
    // 034 — GoTrue cannot scan a NULL into a Go string.
    for (const col of ['confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new']) {
      expect(create, `034's ${col} fix was dropped`).toMatch(new RegExp(col, 'i'));
    }
    // 023 — VMS's handle_new_user() trigger already inserted the profile row.
    expect(
      /insert into public\.profiles/i.test(create),
      "023's fix was dropped: VMS's trigger already created the row, so an insert collides"
    ).toBe(false);
    // 032 — one department per person, mirrored into VMS's own column.
    for (const fn of [create, finalBody('admin_update_user')]) {
      expect(fn).toMatch(/at most one department/i);
      expect(fn).toMatch(/department_id\s*=/i);
    }
  });

  it('both client-facing profile readers carry the flag', () => {
    expect(bare).toMatch(/drop function if exists gatepass\.my_profile\(\)/i);
    expect(bare).toMatch(/drop function if exists gatepass\.admin_list_profiles\(text\)/i);
    // The drop takes the grant with it.
    expect(bare).toMatch(/grant execute on function gatepass\.my_profile\(\) to authenticated/i);
    expect(bare).toMatch(/grant execute on function gatepass\.admin_list_profiles\(text\) to authenticated/i);
    for (const fn of ['my_profile', 'admin_list_profiles']) {
      expect(finalBody(fn), `${fn} must return is_active`).toMatch(/is_active/i);
    }
  });

  it('the status table cannot hold an undated suspension', () => {
    expect(bare).toMatch(/user_status_inactive_is_dated check \(is_active or deactivated_at is not null\)/i);
  });
});

describe('041 — the HOD decides what happens to an expired pass', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('041'))!.sql;
  const bare = stripSqlComments(sql);

  /** The final deployed body of a gatepass function, across all migrations. */
  function finalBody(fn: string): string {
    const all = extractFunctions(allMigrationsText()).filter((f) => f.name === `gatepass.${fn}`);
    expect(all.length, `${fn} is not defined in any migration`).toBeGreaterThan(0);
    return all[all.length - 1].body;
  }

  it('only the HOD who raised the pass may void it', () => {
    expect(finalBody('hod_void_expired_pass')).toMatch(/raised_by <> v_user_id/i);
  });

  it('EXPIRY IS RE-CHECKED ON THE SERVER, never taken from the caller', () => {
    // Without this, the browser could void a perfectly live pass by calling the
    // RPC directly — which is the HOD cancellation 024 removed, restored by the
    // back door. The screen decides which button to draw; the database decides
    // what is true.
    const body = finalBody('hod_void_expired_pass');
    expect(body).toMatch(/expires_at is null or v_pass\.expires_at >= now\(\)/i);
    expect(body).toMatch(/has not expired/i);
  });

  it('it refuses a pass that already reached an outcome', () => {
    // matched / flagged / held / hod_reviewed / cancelled are all decisions
    // somebody already took, and expiry does not reopen any of them.
    expect(finalBody('hod_void_expired_pass')).toMatch(/status::text <> 'pending'/i);
  });

  it('there is NO approve branch, so an HOD cannot un-expire their own paperwork', () => {
    // 035 made `hod_review_flagged_pass(approve)` refresh `expires_at` to the end
    // of the current day. A function that admitted an expired pass AND carried an
    // approve branch would hand every HOD a way to revive dead paperwork with no
    // security involvement at all.
    const body = finalBody('hod_void_expired_pass');
    expect(/p_action/i.test(body), 'this RPC has exactly one outcome — void').toBe(false);
    expect(/expires_at\s*=/i.test(body), 'nothing here may WRITE expires_at').toBe(false);
  });

  it('the void is recorded in verifications, with the HOD as its author', () => {
    // A pass that changed state with no row there is a state change for no
    // recorded reason.
    const body = finalBody('hod_void_expired_pass');
    expect(body).toMatch(/insert into gatepass\.verifications/i);
    expect(body).toMatch(/'cancelled'::gatepass\.verify_action/i);
    expect(body).toMatch(/v_user_id/);
  });

  it('it reuses existing enum labels only', () => {
    // APPLY_ALL.sql is pasted as ONE transaction, and a label added in the same
    // transaction cannot be referenced by anything Postgres evaluates at DDL
    // time. 'cancelled' exists since 008 in both enums.
    expect(/alter type/i.test(bare), '041 must not add an enum label').toBe(false);
  });

  it('it grants execute to authenticated and to nobody else', () => {
    expect(bare).toMatch(/revoke all on function gatepass\.hod_void_expired_pass\(uuid, text\) from public/i);
    expect(bare).toMatch(/grant execute on function gatepass\.hod_void_expired_pass\(uuid, text\) to authenticated/i);
  });

  it('adds no UPDATE or DELETE grant — the state machine stays RPC-only', () => {
    expect(/grant\s+[^;]*\b(update|delete)\b[^;]*on\s+gatepass\.gate_passes/i.test(bare)).toBe(false);
  });

  it('it is SECURITY DEFINER with a pinned search_path', () => {
    expect(bare).toMatch(/security definer/i);
    expect(bare).toMatch(/set search_path = ''/i);
  });
});

describe('042 — the pass number drops the direction', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('042'))!.sql;
  const bare = stripSqlComments(sql);

  /** The final deployed body of a gatepass function, across all migrations. */
  function finalBody(fn: string): string {
    const all = extractFunctions(allMigrationsText()).filter((f) => f.name === `gatepass.${fn}`);
    expect(all.length, `${fn} is not defined in any migration`).toBeGreaterThan(0);
    return all[all.length - 1].body;
  }

  it('the deployed generator builds TYPE-YYYYMMDD, with no direction in it', () => {
    const body = finalBody('set_pass_number');
    expect(body).toMatch(/prefix\s*:=\s*new\.type::text \|\| '-' \|\| date_str/i);
    expect(/upper\(new\.direction/i.test(body), 'the direction is out of the label').toBe(false);
  });

  it('keeps the advisory lock — a plain max()+1 collides under concurrency', () => {
    const body = finalBody('set_pass_number');
    expect(body).toMatch(/pg_advisory_xact_lock/i);
    expect(body).toMatch(/pass_number like prefix \|\| '-%'/i);
  });

  it('still owns the columns a client must never choose', () => {
    const body = finalBody('set_pass_number');
    for (const col of ['created_at', 'updated_at', 'qr_token', 'expires_at']) {
      expect(body).toContain(`new.${col}`);
    }
  });

  it('renames no existing row — a pass number is an audit anchor', () => {
    expect(/update\s+gatepass\.gate_passes/i.test(bare)).toBe(false);
  });

  it('touches no column, constraint or enum', () => {
    expect(/alter table/i.test(bare)).toBe(false);
    expect(/alter type/i.test(bare)).toBe(false);
  });

  it('is SECURITY DEFINER with a pinned search_path, and grants nothing new', () => {
    expect(bare).toMatch(/security definer/i);
    expect(bare).toMatch(/set search_path = ''/i);
    expect(/^\s*grant\b/im.test(bare)).toBe(false);
  });
});

describe('043 — the gate pass approval ladder', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('043'))!.sql;
  const bare = stripSqlComments(sql);

  it('touches nothing in `public` — the two-schema rule', () => {
    // References into public by foreign key and by read are fine; altering it
    // is not, and neither is creating anything there.
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('keys the four offices with a CHECK, never a new enum', () => {
    // A new enum VALUE cannot be used in the transaction that adds it, and
    // APPLY_ALL.sql is pasted as one transaction — a `check (role_key in
    // (...))` naming fresh enum labels would abort the whole paste.
    expect(/create\s+type/i.test(bare)).toBe(false);
    expect(bare).toMatch(/role_key\s+text\s+primary key/i);
    expect(bare).toMatch(/check\s*\(\s*role_key in \('security_head', 'coo', 'ceo', 'finance_head'\)\s*\)/i);
  });

  it('turns RLS on and hands out no write privilege at all', () => {
    expect(bare).toMatch(/alter table gatepass\.approval_roles enable row level security/i);
    expect(bare).toMatch(/grant select on gatepass\.approval_roles to authenticated/i);
    expect(/grant\s+(insert|update|delete|all)[^;]*approval_roles/i.test(bare)).toBe(false);
  });

  it('has exactly one SELECT policy, and it is deliberately open to every app user', () => {
    // The four names are printed on the face of every pass that leaves the
    // building, so a guard holding the paper already has them.
    const policies = [...bare.matchAll(/create policy\s+(\w+)\s+on gatepass\.approval_roles for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe('select');
  });

  it('both writers are admin-gated, SECURITY DEFINER, with a pinned search_path', () => {
    for (const fn of ['set_approval_role', 'clear_approval_role']) {
      const body = extractFunctions(allMigrationsText()).find((f) => f.name === `gatepass.${fn}`)!.body;
      expect(body, fn).toMatch(/security definer/i);
      expect(body, fn).toMatch(/set search_path = ''/i);
      expect(body, fn).toMatch(/gatepass\.is_admin\(\)/i);
    }
  });

  it('does not touch the CEO whitelist designation — that row is a PERMISSION', () => {
    // Folding the two together would mean naming the CEO on a gate pass
    // silently hands them the blacklist override that 039 exists to protect.
    expect(/ceo_approver/i.test(bare)).toBe(false);
  });

  it('reads names and departments through its own SECURITY DEFINER function', () => {
    const body = extractFunctions(allMigrationsText())
      .find((f) => f.name === 'gatepass.get_approval_ladder')!.body;
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
    // LEFT JOIN on purpose: a narrowed VMS policy must degrade to a missing
    // name, never to a missing office.
    expect(body).toMatch(/left join\s+public\.profiles/i);
    expect(body).toMatch(/left join\s+public\.departments/i);
    // And it is gated on being an app user at all.
    expect(body).toMatch(/gatepass\.app_role\(\) is not null/i);
  });
});

describe('046 — the approval ladder becomes a workflow, and the gate stops seeing unapproved passes', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('046'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(allMigrationsText());
  const bodyOf = (name: string): string => fns.filter((f) => f.name === `gatepass.${name}`).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('adds no enum and no enum label — APPLY_ALL.sql is pasted as ONE transaction', () => {
    expect(/create\s+type/i.test(bare)).toBe(false);
    expect(/alter\s+type[^;]*add value/i.test(bare)).toBe(false);
  });

  it('hands out SELECT on pass_approvals and nothing else', () => {
    expect(bare).toMatch(/alter table gatepass\.pass_approvals enable row level security/i);
    expect(bare).toMatch(/grant select on gatepass\.pass_approvals to authenticated/i);
    expect(/grant\s+(insert|update|delete|all)[^;]*pass_approvals/i.test(bare)).toBe(false);
  });

  it('has exactly one policy on pass_approvals, and it defers to the pass', () => {
    // Restating gate_passes_select here in a second form is how the two drift
    // apart — `can_see_pass` (044) is SECURITY INVOKER, so the pass's own
    // policy decides.
    const policies = [...bare.matchAll(/create policy\s+(\w+)\s+on gatepass\.pass_approvals for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe('select');
    expect(bare).toMatch(/using \(gatepass\.can_see_pass\(gate_pass_id\)\)/i);
  });

  it('THE CLIENT RULE: a guard cannot select a pass that still owes a signature', () => {
    // Not a screen filter. Without this arm, the Pending OUT queue, the search,
    // a scanned QR code and a hand-typed /pass/<uuid> would all still resolve.
    const policy = bare.match(/create policy\s+gate_passes_select[\s\S]*?;/i)![0];
    expect(policy).toMatch(/gatepass\.app_role\(\) = 'guard' and not gatepass\.pass_awaits_approval\(id\)/i);
    // …and an admin is deliberately NOT subject to it: somebody has to be able
    // to see a pass stuck at level 2, and it is not the guard.
    expect(policy).toMatch(/gatepass\.is_admin\(\)/i);
    // `is_security()` means guard-or-admin and those two now differ, so it must
    // not be what decides this policy any more.
    expect(/is_security\(\)/i.test(policy)).toBe(false);
  });

  it('says the same thing on the material lines, or an approver could not read what they are signing', () => {
    const policy = bare.match(/create policy\s+gate_pass_items_select[\s\S]*?;/i)![0];
    expect(policy).toMatch(/gatepass\.app_role\(\) = 'guard' and not gatepass\.pass_awaits_approval\(gate_pass_id\)/i);
    expect(policy).toMatch(/gatepass\.pass_routed_to_me\(gate_pass_id\)/i);
  });

  it('backs the policy with a trigger, because every state transition is SECURITY DEFINER', () => {
    // match_pass bypasses RLS entirely. The policy hides the pass; this refuses
    // the move.
    expect(bare).toMatch(/create trigger gate_passes_block_unapproved[\s\S]*?before update on gatepass\.gate_passes/i);
    const body = bodyOf('block_unapproved_gate_move');
    expect(body).toMatch(/new\.status in \('matched', 'flagged', 'held'\)/i);
    expect(body).toMatch(/gatepass\.pass_awaits_approval\(old\.id\)/i);
    // 'cancelled' must NOT be refused — rejection moves a still-climbing pass
    // to exactly that state.
    expect(/new\.status in \([^)]*'cancelled'/i.test(body)).toBe(false);
  });

  it('snapshots the ladder on INSERT, so a later designation cannot reopen a cleared pass', () => {
    expect(bare).toMatch(/create trigger gate_passes_snapshot_approvals[\s\S]*?after insert on gatepass\.gate_passes/i);
    const body = bodyOf('snapshot_pass_approvals');
    expect(body).toMatch(/from gatepass\.approval_roles/i);
    expect(body).toMatch(/security definer/i);
  });

  it('every new function is SECURITY DEFINER with a pinned search_path', () => {
    for (const fn of [
      'my_approval_role',
      'pass_awaits_approval',
      'pass_routed_to_me',
      'snapshot_pass_approvals',
      'block_unapproved_gate_move',
      'get_pass_approvals',
      'approve_pass_level',
      'reject_pass_level',
    ]) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/security definer/i);
      expect(body, fn).toMatch(/set search_path = ''/i);
    }
  });

  it('a suspended office holder holds no office (040)', () => {
    // Otherwise deactivating an approver would leave passes addressed to
    // somebody who cannot sign in.
    expect(bodyOf('my_approval_role')).toMatch(/gatepass\.is_user_active\(auth\.uid\(\)\)/i);
  });

  it('both decisions are the caller`s own office, and in slip order', () => {
    for (const fn of ['approve_pass_level', 'reject_pass_level']) {
      const body = bodyOf(fn);
      expect(body, fn).toMatch(/gatepass\.my_approval_role\(\)/i);
      // The caller's level must be the LOWEST still-pending one.
      expect(body, fn).toMatch(/min\(a\.level_no\)/i);
      expect(body, fn).toMatch(/v_mine <> v_lowest/i);
      // And the pass must still be waiting.
      expect(body, fn).toMatch(/v_status <> 'pending'/i);
    }
  });

  it('a rejection is closed, reasoned and recorded — never deleted', () => {
    const body = bodyOf('reject_pass_level');
    expect(body).toMatch(/status = 'cancelled'::gatepass\.pass_status/i);
    expect(body).toMatch(/insert into gatepass\.verifications/i);
    expect(body).toMatch(/'cancelled'::gatepass\.verify_action/i);
    expect(body).toMatch(/A rejection needs a reason/i);
    // The reason is required by the TABLE too, not only by the RPC.
    expect(bare).toMatch(/status = 'rejected'[\s\S]*?length\(btrim\(coalesce\(reason, ''\)\)\) between 1 and 500/i);
    // A raised pass is permanent (024): nothing here deletes one.
    expect(/delete from gatepass\.gate_passes/i.test(bare)).toBe(false);
  });

  it('the scanner tells the guard the truth rather than "not_found", and hands over no id', () => {
    const body = bodyOf('lookup_pass');
    expect(body).toMatch(/awaiting_approval/i);
    // pass_id is withheld on that outcome: the screen opens the record for any
    // outcome carrying an id, and this is precisely the pass a guard may not read.
    expect(body).toMatch(/case when v_outcome = 'awaiting_approval' then null else v_pass\.id end/i);
  });

  it('an approver account is VMS `staff`, in the profile AND in the JWT', () => {
    // A value VMS has never seen appearing in a field VMS also reads is exactly
    // the drift the two-schema rule exists to prevent.
    const body = bodyOf('admin_create_user');
    expect(body).toMatch(/v_profile_role text := p_role/i);
    expect(body).toMatch(/v_profile_role := 'staff'/i);
    expect(body).toMatch(/'role', v_profile_role/i);
    expect(body).toMatch(/insert into gatepass\.approval_roles/i);
    // It still refuses to mint an admin.
    expect(body).toMatch(/Cannot create an admin user/i);
  });
});

describe('048 — an admin-set password must actually let the person sign in', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('048'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(allMigrationsText());
  const bodyOf = (name: string): string => fns.filter((f) => f.name === `gatepass.${name}`).slice(-1)[0].body;

  it('the LAST definition of admin_reset_user_password confirms the address', () => {
    // GoTrue refuses an unconfirmed address before it ever checks the password,
    // so 036's reset set a credential the account could not use. `slice(-1)`
    // matters here: 036 still defines the function earlier in the paste, and
    // the one that survives the transaction is the one that must carry this.
    const body = bodyOf('admin_reset_user_password');
    expect(body).toMatch(/email_confirmed_at\s*=\s*coalesce\(email_confirmed_at,/i);
  });

  it('it coalesces rather than assigns — a reset never restates when ownership was proved', () => {
    const body = bodyOf('admin_reset_user_password');
    // `v_now` is the FUNCTION's timestamp variable, so this is a test about the
    // function and not about the one-off backfill at the foot of the file —
    // that one assigns `now()` outright, correctly, to addresses that have no
    // confirmation timestamp at all to preserve.
    expect(/email_confirmed_at\s*=\s*v_now/i.test(bare)).toBe(false);
  });

  it('everything 034 and 036 hard-won is still in the body', () => {
    const body = bodyOf('admin_reset_user_password');
    // The four GoTrue token columns: omit one and sign-in 500s (034). Written
    // out rather than built from a loop — a regex assembled in a template
    // literal loses its own backslashes, and the weakened pattern still passes.
    expect(body).toMatch(/confirmation_token\s*=\s*coalesce\(confirmation_token, ''\)/i);
    expect(body).toMatch(/recovery_token\s*=\s*coalesce\(recovery_token, ''\)/i);
    expect(body).toMatch(/email_change\s*=\s*coalesce\(email_change, ''\)/i);
    expect(body).toMatch(/email_change_token_new\s*=\s*coalesce\(email_change_token_new, ''\)/i);
    expect(body).toMatch(/Only an admin can reset a password/i);
    expect(body).toMatch(/Admin passwords cannot be reset from the panel/i);
    expect(body).toMatch(/must_change_password = true/i);
    expect(body).toMatch(/delete from auth\.sessions/i);
    expect(body).toMatch(/delete from auth\.refresh_tokens/i);
  });

  it('the backfill is narrow, idempotent, and never touches an admin', () => {
    // "accounts an admin has ALREADY reset", not "every unconfirmed address in
    // a directory this app shares with VMS".
    expect(bare).toMatch(/update auth\.users[\s\S]*?email_confirmed_at is null/i);
    expect(bare).toMatch(/p\.must_change_password/i);
    expect(bare).toMatch(/p\.role not in \('admin', 'super_admin'\)/i);
  });

  it('touches nothing in `public` — the two-schema rule', () => {
    // It writes auth.users, which is the same allowance admin_create_user has
    // had since 021; it adds and alters nothing anybody else owns.
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+(public|auth)\./i.test(bare)).toBe(false);
  });
});

describe('049 — one approval office per person', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('049'))!.sql;
  const bare = stripSqlComments(sql);

  it('makes the designation UNIQUE BY PERSON, not just by office', () => {
    // `my_approval_role()` is a scalar `returns text` over this table. Postgres
    // does not error when such a query yields two rows — it hands back an
    // arbitrary one — so a dual-hatted approver could act on exactly one of
    // their offices, silently. Found by the live probe for 046, not by reading.
    expect(bare).toMatch(/create unique index[\s\S]*?on gatepass\.approval_roles \(user_id\)/i);
  });

  it('refuses the designation with a sentence, rather than leaking a constraint name', () => {
    const body = extractFunctions(allMigrationsText())
      .filter((f) => f.name === 'gatepass.set_approval_role')
      .slice(-1)[0].body;
    expect(body).toMatch(/One person holds one approval office/i);
    // …and re-designating somebody to the office they ALREADY hold stays a
    // no-op, which is what this exclusion is for.
    expect(body).toMatch(/r\.role_key <> p_role_key/i);
    // The 043 guards are still all there.
    expect(body).toMatch(/gatepass\.is_admin\(\)/i);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
  });
});

describe('051 — the approval letter is addressed to the office s current holder', () => {
  const body = extractFunctions(allMigrationsText())
    .filter((f) => f.name === 'gatepass.approval_notice_payload')
    .slice(-1)[0].body;

  it('resolves the address through approval_roles, not through the raise-time snapshot', () => {
    // 046 gives AUTHORITY to whoever holds the office at the moment of the
    // press (`my_approval_role()`), so a letter posted to the person the pass
    // was routed to months ago asks somebody the database would refuse. Found
    // by moving the Security Head while a pass sat at level 1.
    expect(body).toMatch(/join gatepass\.approval_roles r on r\.role_key = a\.role_key/i);
    expect(body).toMatch(/coalesce\(cur\.email,\s*ap\.email\)/i);
    expect(body).toMatch(/coalesce\(cur\.full_name,\s*ap\.full_name\)/i);
  });

  it('keeps routed_to as the fallback, for an office nobody holds today', () => {
    expect(body).toMatch(/a\.routed_to/i);
  });

  it('still reaches VMS by LEFT JOIN only, and stays service_role-only', () => {
    // A narrowed VMS policy must degrade a level to "no address" (one dropped
    // message), never to a different person's address.
    const joins = (body.match(/join public\./gi) ?? []).length;
    const lefts = (body.match(/left join\s+public\./gi) ?? []).length;
    expect(joins).toBeGreaterThan(0);
    expect(lefts).toBe(joins);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
  });
});

describe('052 — the mail settings are editable, and the credential is not readable', () => {
  const sql = allMigrationsText().find((m) => m.name.startsWith('052'))!.sql;
  const fns = extractFunctions(allMigrationsText());
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('gives no signed-in role any privilege on gatepass.mail_settings', () => {
    // The table holds an SMTP password. An admin reads it through
    // get_mail_settings(), which never returns that column; a PostgREST select
    // on the table would return every column there is.
    expect(sql).toMatch(/alter table gatepass\.mail_settings enable row level security/i);
    expect(sql).not.toMatch(/grant\s+[\w, ()]*on\s+(table\s+)?gatepass\.mail_settings\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/create policy[\s\S]*?on gatepass\.mail_settings/i);
  });

  it('never lets get_mail_settings return the stored password', () => {
    const body = fnBody('gatepass.get_mail_settings');
    expect(body).toMatch(/'smtp_password_set',\s*s\.smtp_password is not null/i);
    expect(body).not.toMatch(/'smtp_password',/i);
  });

  it('keeps mail_config — which DOES return the password — to service_role alone', () => {
    expect(sql).toMatch(/grant execute on function gatepass\.mail_config\(\) to service_role/i);
    expect(sql).not.toMatch(/grant execute on function gatepass\.mail_config\(\)[^;]*authenticated/i);
  });

  it('checks that both reader and writer are admins', () => {
    for (const name of ['gatepass.get_mail_settings', 'gatepass.set_mail_settings']) {
      const body = fnBody(name);
      expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('accepts ONE redirect address, never a list', () => {
    // Client, 2026-08-20: one email at a time. The regex bans the separators
    // as well as whitespace and angle brackets, so a second recipient cannot
    // be smuggled through a display name.
    expect(sql).toMatch(/constraint mail_settings_override_is_one_address/i);
    expect(sql).toMatch(/\[\^@\[:space:\],;<>\]/);
  });

  it('leaves the stored password alone when the form did not send one', () => {
    // A write-only field cannot be round-tripped through a form, so null means
    // "unchanged" and '' means "clear" — the update must say so explicitly.
    expect(fnBody('gatepass.set_mail_settings'))
      .toMatch(/when p_smtp_password is null then m\.smtp_password/i);
  });
});

describe('053 — the CEO office decides whitelist requests', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('053'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  /** The LAST definition wins — 053 replaces both of these. */
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('makes `is_ceo()` true for the ladder CEO as well as the designated one', () => {
    // The client's own decision (2026-08-20), and it reverses 043's separation
    // of the org chart from the blacklist override — the migration header says
    // so out loud. Both halves must be present: dropping `ceo_approver` would
    // silently unseat whoever a super_admin designated.
    const body = fnBody('gatepass.is_ceo');
    expect(body).toMatch(/gatepass\.ceo_approver/i);
    expect(body).toMatch(/gatepass\.approval_roles/i);
    expect(body).toMatch(/role_key = 'ceo'/i);
  });

  it('lets the CEO READ the queue they are the only person able to clear', () => {
    // 039 filtered the list on is_admin() alone, so the CEO could decide a
    // request they could not see.
    expect(fnBody('gatepass.list_whitelist_requests'))
      .toMatch(/gatepass\.is_admin\(\)\s+or\s+gatepass\.is_ceo\(\)/i);
  });

  it('keeps both functions SECURITY DEFINER with a pinned search_path', () => {
    for (const name of ['gatepass.is_ceo', 'gatepass.list_whitelist_requests']) {
      const body = fnBody(name);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('does not widen who may DECIDE beyond is_ceo()', () => {
    // The two decide RPCs are untouched here; a `create or replace` of either
    // in this migration would need its own review.
    expect(/create or replace function gatepass\.(approve|reject)_whitelist_request/i.test(bare))
      .toBe(false);
  });
});

describe('054 — an office may have one standing deputy, and one person one seat', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('054'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  /** The LAST definition wins — 054 restates several of 043/046/049/051. */
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('lets a deputy act for the office, without widening my_approval_role beyond one row', () => {
    // The whole migration hangs off this one `or`: every RLS policy, both
    // decision RPCs and the slip-order rule resolve authority through this
    // function, so widening it here is what gives a deputy the existing
    // workflow. It stays SCALAR only because three separate rules keep it to
    // one row — 049's unique user_id, 054's unique deputy_id, and the two
    // setters refusing to seat one person twice.
    const body = fnBody('gatepass.my_approval_role');
    expect(body).toMatch(/r\.user_id = auth\.uid\(\)\s+or\s+r\.deputy_id = auth\.uid\(\)/i);
    expect(body).toMatch(/gatepass\.is_user_active\(auth\.uid\(\)\)/i);
  });

  it('keeps one person to one seat, by index AND by sentence in both directions', () => {
    // 049's hazard exactly: a scalar over several rows returns an arbitrary
    // one, silently. A deputy reopens it unless a deputy is unique too.
    expect(bare).toMatch(
      /create unique index[\s\S]*?approval_roles_one_deputy_per_person[\s\S]*?\(deputy_id\)[\s\S]*?where deputy_id is not null/i,
    );
    // A holder cannot be made a deputy...
    expect(fnBody('gatepass.set_approval_deputy')).toMatch(/One person holds one approval seat/i);
    // ...and a deputy cannot be made a holder.
    expect(fnBody('gatepass.set_approval_role')).toMatch(/standing deputy for the % office/i);
  });

  it('refuses to let the holder be their own deputy', () => {
    expect(bare).toMatch(/constraint approval_roles_deputy_is_not_holder/i);
    expect(bare).toMatch(/check \(deputy_id is null or deputy_id <> user_id\)/i);
  });

  it('admits nobody but an admin to either deputy RPC', () => {
    for (const name of ['gatepass.set_approval_deputy', 'gatepass.clear_approval_deputy']) {
      const body = fnBody(name);
      expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('records WHICH SEAT signed, as a stored column rather than a join', () => {
    // The seat is a fact about the moment of the decision, and both seats move.
    // A join back to approval_roles would retroactively rewrite history every
    // time an office was re-pointed.
    expect(bare).toMatch(/alter table gatepass\.pass_approvals[\s\S]*?decided_as_deputy boolean not null default false/i);
    for (const name of ['gatepass.approve_pass_level', 'gatepass.reject_pass_level']) {
      expect(fnBody(name)).toMatch(/decided_as_deputy\s*=\s*coalesce\(v_as_deputy, false\)/i);
    }
  });

  it('leaves the slip order, the pass status rules and the rejection reason exactly as 046 set them', () => {
    // A deputy is a second signer, not a second set of rules.
    for (const name of ['gatepass.approve_pass_level', 'gatepass.reject_pass_level']) {
      const body = fnBody(name);
      expect(body).toMatch(/An earlier approval level has not signed this pass yet/i);
      expect(body).toMatch(/This gate pass is no longer waiting for approval/i);
      expect(body).toMatch(/This gate pass is not waiting on your approval/i);
    }
    expect(fnBody('gatepass.reject_pass_level')).toMatch(/A rejection needs a reason/i);
  });

  it('drops and recreates the two readers whose return type changed, and re-grants them', () => {
    // `create or replace function` cannot change a return type. The grant dies
    // with the drop, so it must be re-applied in the same transaction.
    const lower = bare.toLowerCase();
    for (const fn of ['gatepass.get_pass_approvals(uuid)', 'gatepass.get_approval_ladder()']) {
      expect(lower).toContain(`drop function if exists ${fn}`);
      expect(lower).toContain(`grant execute on function ${fn} to authenticated`);
    }
  });

  it('tells the deputy about the pass, resolving them TODAY rather than at raise', () => {
    // 051's rule, applied to the second seat: authority is resolved at the
    // moment of the press, so the address has to be too.
    const body = fnBody('gatepass.approval_notice_payload');
    expect(body).toMatch(/'deputy_email',\s*dep\.email/i);
    expect(body).toMatch(/left join public\.profiles\s+dep on dep\.id = r\.deputy_id/i);
  });

  it('never exposes an approver address to a signed-in reader', () => {
    // 047's rule, restated because this migration touches both functions:
    // the payload carries emails and stays service_role-only; the ladder is
    // readable by every signed-in user and must carry none.
    expect(bare).not.toMatch(/grant execute on function gatepass\.approval_notice_payload[^;]*authenticated/i);
    const ladder = fnBody('gatepass.get_approval_ladder');
    expect(ladder).not.toMatch(/\bemail\b/i);
  });
});

describe('055 — an emergency release is written down, and reviewed by somebody else', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('055'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('admits ONLY a super admin, the way 039 does — never is_admin()', () => {
    // An ordinary admin already creates users and resets passwords. Gating this
    // on is_admin() would hand the entire approval ladder to the same group
    // that administers it.
    const body = fnBody('gatepass.emergency_release_pass');
    expect(body).toMatch(/gatepass\.app_role\(\) <> 'super_admin'/i);
    expect(body).not.toMatch(/if not gatepass\.is_admin\(\) then/i);
  });

  it('will not release without a written reason', () => {
    expect(fnBody('gatepass.emergency_release_pass')).toMatch(/length\(v_reason\) < 10/i);
    expect(bare).toMatch(/constraint emergency_releases_reason_is_written/i);
    expect(bare).toMatch(/length\(btrim\(reason\)\) between 10 and 500/i);
  });

  it('refuses to let the releaser review their own release', () => {
    // The whole control. Without this line an override is a bypass.
    const body = fnBody('gatepass.review_emergency_release');
    expect(body).toMatch(/if v_released_by = auth\.uid\(\) then/i);
    expect(body).toMatch(/reviewed by somebody other than/i);
  });

  it('lets a WIDER pool review than release, or the refusal could not bite', () => {
    // If reviewing needed super_admin too, a lone super admin could release and
    // then self-review in two clicks — which the check above only prevents when
    // somebody else is actually eligible.
    const body = fnBody('gatepass.review_emergency_release');
    expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
    expect(body).not.toMatch(/<> 'super_admin'/i);
  });

  it('never touches the pass status, and adds no update or delete grant on gate_passes', () => {
    // The release clears the pending approval rows, which makes
    // pass_awaits_approval() false. It must not move the pass itself: that
    // would trip block_unapproved_gate_move and break the RPC-only state
    // machine that sqlInvariants enforces elsewhere in this file.
    expect(bare).not.toMatch(/update gatepass\.gate_passes/i);
    expect(bare).not.toMatch(/grant[^;]*(update|delete)[^;]*on\s+(table\s+)?gatepass\.gate_passes/i);
  });

  it('marks the levels it cleared as emergency, rather than forging four signatures', () => {
    // decided_by is the super admin, who holds none of these offices. Without
    // this flag the ladder would read "Approved by <admin>" against four
    // offices they do not hold — a fabricated audit trail.
    expect(bare).toMatch(/add column if not exists emergency boolean not null default false/i);
    expect(fnBody('gatepass.emergency_release_pass')).toMatch(/emergency\s*=\s*true/i);
  });

  it('gives no signed-in role a write on the log itself', () => {
    expect(bare).toMatch(/alter table gatepass\.emergency_releases enable row level security/i);
    expect(bare).not.toMatch(/create policy[\s\S]*?on gatepass\.emergency_releases for (insert|update|delete)/i);
    expect(bare).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*on\s+(table\s+)?gatepass\.emergency_releases/i);
  });

  it('keeps the release log readable by exactly the people who can read the pass', () => {
    // An override nobody can see is not a control. can_see_pass is SECURITY
    // INVOKER, so this inherits gate_passes_select rather than restating it.
    expect(bare).toMatch(/using \(gatepass\.can_see_pass\(gate_pass_id\)\)/i);
  });

  it('pins search_path on every definer function it adds', () => {
    for (const name of [
      'gatepass.emergency_release_pass',
      'gatepass.review_emergency_release',
      'gatepass.list_emergency_releases',
    ]) {
      const body = fnBody(name);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });
});

describe('057 — the ladder is linear in the client order, and an unapproved pass offers no gate action', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('057'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('pins Finance to level 3 and the CEO to level 4 in the check constraint', () => {
    // The client's order (2026-08-20). This reverses 043's, which took the CEO
    // third off the printed slip.
    const check = bare.match(/add constraint pass_approvals_level_matches[\s\S]*?\);/i)![0];
    expect(check).toMatch(/when 'finance_head'\s*then 3/i);
    expect(check).toMatch(/when 'ceo'\s*then 4/i);
    expect(check).toMatch(/when 'security_head'\s*then 1/i);
    expect(check).toMatch(/when 'coo'\s*then 2/i);
  });

  it('drops the old constraint BEFORE renumbering, or no single update could satisfy it', () => {
    const drop = bare.search(/drop constraint if exists pass_approvals_level_matches/i);
    const update = bare.search(/update gatepass\.pass_approvals set level_no/i);
    const add = bare.search(/add constraint pass_approvals_level_matches/i);
    expect(drop).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(drop);
    expect(add).toBeGreaterThan(update);
  });

  // REWRITTEN 2026-08-22: this used to read the LATEST definition of the
  // snapshot trigger and expect 057's mapping. 063 renumbered it, so the
  // property this file owns is that 057's OWN copy of the trigger agreed with
  // 057's OWN constraint — two copies of one mapping is the drift being pinned,
  // and the current mapping is pinned in the 063 block below.
  it('snapshots new passes in the same order its own constraint enforces', () => {
    const trigger = bare.match(
      /create or replace function gatepass\.snapshot_pass_approvals[\s\S]*?\$\$;/i,
    )![0];
    expect(trigger).toMatch(/when 'finance_head'\s*then 3/i);
    expect(trigger).toMatch(/when 'ceo'\s*then 4/i);
  });

  it('rebuilds the view rather than replacing it, and re-grants select in the same file', () => {
    // TRAP 2 (CLAUDE.md): `create or replace view` cannot absorb a new column,
    // and a rebuild drops every grant with it.
    expect(bare).toMatch(/drop view if exists gatepass\.v_gate_passes/i);
    expect(bare).toMatch(/create view gatepass\.v_gate_passes with \(security_invoker = true\)/i);
    expect(bare).toMatch(/grant select on gatepass\.v_gate_passes to authenticated/i);
  });

  it('defines awaits_approval on the view, once, from the definer function', () => {
    // Never recomputed in TypeScript — the same rule is_overdue lives by.
    expect(bare).toMatch(/gatepass\.pass_awaits_approval\(p\.id\) as awaits_approval/i);
  });

  it('leaves the trigger that refuses an unapproved gate move completely alone', () => {
    // The screen stops drawing the button; the database keeps refusing the
    // press. Weakening 046's trigger here would turn a UX fix into a hole.
    expect(bare).not.toMatch(/block_unapproved_gate_move/i);
    expect(bare).not.toMatch(/drop trigger[^;]*gate_passes_block_unapproved/i);
  });

  it('lets an office holder be reactivated, without letting a bare staff row be', () => {
    // 040 refused every non-guard/hod target. An office holder is `staff` (046)
    // and would have been stuck deactivated for ever; a roleless staff row still
    // has nothing to come back to and is still refused.
    const body = fnBody('gatepass.admin_reactivate_user');
    expect(body).toMatch(/from gatepass\.approval_roles/i);
    expect(body).toMatch(/v_role not in \('guard', 'hod'\) and v_office is null/i);
    expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
  });

  it('adds no update or delete grant on gate_passes', () => {
    expect(bare).not.toMatch(/grant[^;]*(update|delete)[^;]*on\s+(table\s+)?gatepass\.gate_passes/i);
  });

  it('pins search_path on every definer function it restates', () => {
    for (const name of ['gatepass.snapshot_pass_approvals', 'gatepass.admin_reactivate_user']) {
      const body = fnBody(name);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });
});

describe('056 — the application settings are admin-editable, and honest about their reach', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('056'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('gives no signed-in role any privilege on the table itself — 052 pattern', () => {
    expect(bare).toMatch(/alter table gatepass\.app_settings enable row level security/i);
    expect(bare).not.toMatch(/grant\s+[\w, ()]*on\s+(table\s+)?gatepass\.app_settings\s+to\s+authenticated/i);
    expect(bare).not.toMatch(/create policy[\s\S]*?on gatepass\.app_settings/i);
  });

  it('checks that both the full reader and the writer are admins', () => {
    for (const name of ['gatepass.get_app_settings', 'gatepass.set_app_settings']) {
      const body = fnBody(name);
      expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('lets EVERY signed-in user read the idle timeout, and nothing else', () => {
    // Their own browser is what enforces it, so gating it would leave a setting
    // that only changed the behaviour of the admin who set it. It must not leak
    // the 2FA flag on the way — "there is no second factor here" is
    // reconnaissance about a control.
    const body = fnBody('gatepass.get_session_timeout');
    expect(bare).toMatch(/grant execute on function gatepass\.get_session_timeout\(\) to authenticated/i);
    expect(body).toMatch(/session_timeout_minutes/i);
    expect(body).not.toMatch(/require_approver_2fa/i);
    expect(body).toMatch(/gatepass\.app_role\(\) is not null/i);
  });

  it('never returns the 2FA flag to a non-admin through the full getter either', () => {
    // The full document is admin-gated; this is the belt to that braces.
    const body = fnBody('gatepass.get_app_settings');
    expect(body).toMatch(/require_approver_2fa/i);
    expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
  });

  it('bounds the timeout in the database, so no setting can sign everyone out instantly', () => {
    expect(bare).toMatch(/session_timeout_minutes between 5 and 1440/i);
    expect(fnBody('gatepass.set_app_settings')).toMatch(/between 5 minutes and 24 hours/i);
  });

  it('restates every CHECK as a sentence, because 23514 is not mapped to one', () => {
    const body = fnBody('gatepass.set_app_settings');
    expect(body).toMatch(/40 characters or fewer/i);
    expect(body).toMatch(/six-digit hex code/i);
  });

  it('reads as one row, always', () => {
    // 052's single-row lock: a second row is a primary key violation rather
    // than a settings table nobody can read deterministically.
    expect(bare).toMatch(/id boolean primary key default true check \(id\)/i);
  });
});

describe('058 — the rollout closes a pre-workflow ladder WITHOUT inventing an approver', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('058'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('NEVER names a person as the approver of a level nobody signed', () => {
    // THE WHOLE POINT OF THE MIGRATION. Setting `decided_by` to some admin
    // would make the record read "Approved by X" against four offices X does
    // not hold — a fabricated audit trail, the exact thing 046 refused when it
    // declined to backfill the grandfathered passes.
    expect(bare).toMatch(/set\s+status\s*=\s*'approved'/i);
    expect(bare).toMatch(/decided_by\s*=\s*null/i);
    // Every assignment to `decided_by` in this file is to null, not just one.
    const assigns = bare.match(/decided_by\s*=\s*\w+/gi) ?? [];
    expect(assigns.length).toBeGreaterThan(0);
    for (const a of assigns) expect(a).toMatch(/=\s*null$/i);
    // But the moment IS real, and the sentence is written down.
    expect(bare).toMatch(/decided_at\s*=\s*now\(\)/i);
    expect(bare).toMatch(/reason\s*=\s*'Approved on rollout/i);
  });

  it('widens the decision shape by exactly ONE arm, and only for a grandfathered row', () => {
    // An ordinary approval still needs an author and a moment. A null decider
    // is legal only when the row is marked as the rollout's doing.
    expect(bare).toMatch(
      /status = 'approved' and grandfathered and decided_by is null and decided_at is not null/i,
    );
    expect(bare).toMatch(
      /status = 'approved' and not grandfathered and decided_by is not null and decided_at is not null/i,
    );
    // The other three arms are unchanged from 046.
    expect(bare).toMatch(/status = 'pending'\s+and decided_by is null/i);
    expect(bare).toMatch(/status = 'rejected' and decided_by is not null/i);
  });

  it('only ever closes a level that is still PENDING, and only on a pass raised before the cutoff', () => {
    // It must not reopen, re-stamp or overwrite a decision somebody made.
    expect(bare).toMatch(/where a\.status = 'pending'/i);
    expect(bare).toMatch(/p\.created_at < v_cutoff/i);
    expect(bare).toMatch(/v_cutoff constant timestamptz := timestamptz '2026-08-20 00:00:00\+00'/i);
  });

  it('marks the rows it closed, so the ladder can say so instead of printing a name', () => {
    expect(bare).toMatch(/add column if not exists grandfathered boolean not null default false/i);
    expect(bare).toMatch(/set\s+status\s*=\s*'approved',\s*grandfathered\s*=\s*true/i);
  });

  it('DROPS and recreates `get_pass_approvals`, because its return type gained a column', () => {
    // `create or replace` cannot change a RETURNS TABLE signature — the rule
    // CLAUDE.md states and `my_profile()` has been bitten by twice.
    expect(bare).toMatch(/drop function if exists gatepass\.get_pass_approvals\(uuid\)/i);
    const body = fnBody('gatepass.get_pass_approvals');
    expect(body).toMatch(/grandfathered\s+boolean/i);
    expect(body).toMatch(/a\.grandfathered/i);
    // And it is still the same guarded, pinned-search-path definer it was.
    expect(body).toMatch(/set search_path = ''/i);
    expect(body).toMatch(/if not gatepass\.can_see_pass\(p_pass_id\) then/i);
    expect(bare).toMatch(/grant execute on function gatepass\.get_pass_approvals\(uuid\) to authenticated/i);
  });

  it('grants nothing new, and no RPC can ever set the flag', () => {
    // Only this migration writes `grandfathered`. If an RPC could set it, an
    // approver could sign a level as "nobody".
    const setters = bare.match(/grandfathered\s*=\s*true/gi) ?? [];
    expect(setters.length).toBe(1);
    expect(bare).not.toMatch(/grant (insert|update|delete) on gatepass\.pass_approvals/i);
  });
});

// ONE OFFICE, ONE ACTIVE PERSON, AND DEACTIVATION VACATES THE SEAT.
//
// Client, 2026-08-20: "if one of the roles, like COO and security head, is
// deactivated and created again, that should allow me to deactivate one person
// from that role and create another new person in that same role … but make
// sure only one account is tacked to that role at the same point in time."
//
// The dangerous half is not the count — `role_key` is the primary key, so two
// holders are physically impossible. It is that a SUSPENDED holder used to keep
// the seat, which made the office unable to approve anything (`my_approval_role`
// gates on `is_user_active`) while every screen read as though it were staffed.
describe('059 — an approval office is held by exactly one ACTIVE person', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('059'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('deactivation vacates the office AND any deputy seat', () => {
    const body = fnBody('gatepass.admin_soft_delete_user');
    expect(body).toMatch(/delete from gatepass\.approval_roles r where r\.role_key = v_office;/i);
    expect(body).toMatch(/set deputy_id = null\s+where r\.deputy_id = p_user_id;/i);
    // And the three refusals 040 shipped with are still in front of it.
    expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
    expect(body).toMatch(/p_user_id = auth\.uid\(\)/i);
    expect(body).toMatch(/v_role in \('admin', 'super_admin'\)/i);
    expect(body).toMatch(/set search_path = ''/i);
  });

  it('remembers the vacated office so reactivation is not a one-way door', () => {
    // Without this marker a deactivated COO is a bare `staff` row, and 057's
    // widened test ("has this person anything to come back to") would refuse
    // them for good.
    expect(bare).toMatch(/add column if not exists vacated_approval_office text/i);
    expect(bare).toMatch(/user_status_vacated_office_known/i);
    const react = fnBody('gatepass.admin_reactivate_user');
    expect(react).toMatch(/s\.vacated_approval_office into v_vacated/i);
    expect(react).toMatch(/v_role not in \('guard', 'hod'\) and v_office is null and v_vacated is null/i);
    // Reactivation FORGETS it, and never re-seats them: the office may belong to
    // somebody else by now, and re-seating would displace a working approver.
    expect(react).toMatch(/vacated_approval_office = null/i);
    expect(react).not.toMatch(/insert into gatepass\.approval_roles/i);
  });

  it('a second deactivation cannot forget the office the first one took', () => {
    const body = fnBody('gatepass.admin_soft_delete_user');
    expect(body).toMatch(
      /vacated_approval_office = coalesce\(excluded\.vacated_approval_office,\s*user_status\.vacated_approval_office\)/i,
    );
  });

  it('refuses to seat a deactivated account, as holder OR as deputy', () => {
    for (const fn of ['gatepass.set_approval_role', 'gatepass.set_approval_deputy']) {
      const body = fnBody(fn);
      expect(body).toMatch(/if not gatepass\.is_user_active\(p_user_id\) then/i);
      expect(body).toMatch(/That account is deactivated/i);
      // 049's and 054's one-seat refusals survive untouched.
      expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
      expect(body).toMatch(/p_role_key not in \('security_head', 'coo', 'ceo', 'finance_head'\)/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('swaps a holder atomically — one row per office, never two', () => {
    const body = fnBody('gatepass.set_approval_role');
    expect(body).toMatch(/on conflict \(role_key\) do update/i);
    // 049's "one person, one office" test is still there and still excludes the
    // office being set, so re-designating the same person stays a no-op.
    expect(body).toMatch(/where r\.user_id = p_user_id\s+and r\.role_key <> p_role_key/i);
  });

  it('sweeps anybody already seated while suspended, using the same test', () => {
    expect(bare).toMatch(/delete from gatepass\.approval_roles r\s+where not gatepass\.is_user_active\(r\.user_id\)/i);
    expect(bare).toMatch(/set deputy_id = null\s+where r\.deputy_id is not null\s+and not gatepass\.is_user_active\(r\.deputy_id\)/i);
    // The marker is written off the seat BEFORE it is removed, and only for a
    // row that is actually suspended.
    expect(bare).toMatch(/s\.is_active = false/i);
  });

  it('grants nothing new — the four RPCs were already reachable', () => {
    expect(bare).not.toMatch(/grant (insert|update|delete) on gatepass\.approval_roles/i);
    expect(bare).not.toMatch(/grant (insert|update|delete) on gatepass\.user_status/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 060 — deleting a department: the FK that always refused it, and the HOD's
// approval that must now be asked for.
// ──────────────────────────────────────────────────────────────────────────────
describe('060 — a department is deleted only by its own HOD', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('060'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('creates and alters nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  // The whole reason every delete raised 23503: profiles.department_id is a
  // plain `no action` FK, and every live department had somebody on it.
  it('clears the VMS profile assignment rather than colliding with its foreign key', () => {
    const body = fnBody('gatepass.perform_department_delete');
    expect(body).toMatch(/update public\.profiles set department_id = null where department_id = p_dept_id;/i);
  });

  it('the worker performs no authorization, so it is granted to nobody', () => {
    expect(bare).toMatch(/revoke all on function gatepass\.perform_department_delete\(uuid\) from public;/i);
    expect(bare).not.toMatch(/grant execute on function gatepass\.perform_department_delete/i);
  });

  it('a department with an ACTIVE HOD is not deleted — a request is raised instead', () => {
    const body = fnBody('gatepass.admin_delete_department');
    expect(body).toMatch(/if not gatepass\.is_admin\(\) then/i);
    expect(body).toMatch(/insert into gatepass\.department_delete_requests/i);
    // The straight-through arm is guarded on there being nobody to ask.
    expect(body).toMatch(/if v_hods is null or cardinality\(v_hods\) = 0 then/i);
  });

  it('only an ACTIVE holder counts as an HOD to ask', () => {
    expect(fnBody('gatepass.department_active_hods')).toMatch(/gatepass\.is_user_active\(p\.id\)/i);
  });

  it('approving is what deletes, and only the department’s own head may approve', () => {
    const body = fnBody('gatepass.hod_decide_department_deletion');
    expect(body).toMatch(/from gatepass\.department_active_hods\(v_dept\) h/i);
    expect(body).toMatch(/h\.user_id = auth\.uid\(\)/i);
    expect(body).toMatch(/perform gatepass\.perform_department_delete\(v_dept\)/i);
    // Re-checked at the decision, never trusted from the request.
    expect(fnBody('gatepass.perform_department_delete')).toMatch(/gatepass\.department_delete_blocker\(p_dept_id\)/i);
  });

  it('a refusal needs a written reason, and the request itself needs one too', () => {
    expect(fnBody('gatepass.hod_decide_department_deletion')).toMatch(/length\(v_reason\) < 5/i);
    expect(bare).toMatch(/check \(length\(btrim\(reason\)\) between 5 and 500\)/i);
  });

  it('the record outlives the department it points at', () => {
    // `on delete cascade` here would erase the decision in the act of carrying
    // it out, which is why the name and code are snapshot beside the id.
    expect(bare).toMatch(/department_id\s+uuid references public\.departments\(id\) on delete set null/i);
    expect(bare).toMatch(/department_name text not null/i);
  });

  it('the request table is RLS-on with no policy and no grant — RPCs only', () => {
    expect(bare).toMatch(/alter table gatepass\.department_delete_requests enable row level security;/i);
    expect(bare).not.toMatch(/create policy [\s\S]*on gatepass\.department_delete_requests/i);
    expect(bare).not.toMatch(/grant (select|insert|update|delete)[\s\S]*on gatepass\.department_delete_requests/i);
  });

  it('one live request per department', () => {
    expect(bare).toMatch(/create unique index if not exists department_delete_requests_one_pending[\s\S]*where status = 'pending'/i);
  });

  it('every function pins an empty search_path', () => {
    for (const name of [
      'gatepass.department_active_hods',
      'gatepass.department_delete_blocker',
      'gatepass.perform_department_delete',
      'gatepass.admin_delete_department',
      'gatepass.admin_withdraw_department_delete',
      'gatepass.hod_decide_department_deletion',
      'gatepass.list_department_delete_requests',
    ]) {
      expect(fnBody(name)).toMatch(/set search_path = ''/i);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 061 — an approver cannot SEE a pass until it is their turn.
// ──────────────────────────────────────────────────────────────────────────────
describe('061 — ladder visibility is linear', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('061'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const body = fns.filter((f) => f.name === 'gatepass.pass_routed_to_me').slice(-1)[0].body;

  // REWRITTEN 2026-08-22: the rung test used to be `<> 'approved'` exactly.
  // 063 added the `not_required` status — a rung the OTHER office on a shared
  // level signed — and restated this predicate as `not in ('approved',
  // 'not_required')`. The property is the same one: a rung below me that is
  // still open (or was rejected) means the turn never reached me.
  it('the office sees a pass only when every rung BELOW it is closed in its favour', () => {
    expect(body).toMatch(/b\.level_no < a\.level_no/i);
    expect(body).toMatch(/b\.status not in \('approved', 'not_required'\)/i);
    expect(body).toMatch(/not exists/i);
    // NOT `= 'pending'`: a rejection below me is not a turn that passed to me,
    // so the pass stays invisible for good.
    expect(body).not.toMatch(/b\.status = 'pending'/i);
  });

  it('still resolves the office through my_approval_role, so a deputy inherits it', () => {
    expect(body).toMatch(/a\.role_key = gatepass\.my_approval_role\(\)/i);
  });

  it('stays SECURITY DEFINER with an empty search_path — it is read from a policy', () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = ''/i);
  });

  it('changes the predicate only — it does not touch the slip order or the policies', () => {
    expect(bare).not.toMatch(/create policy/i);
    expect(bare).not.toMatch(/approve_pass_level|reject_pass_level/i);
  });

  it('is not readable by an anonymous caller', () => {
    expect(bare).toMatch(/revoke all on function gatepass\.pass_routed_to_me\(uuid\) from public;/i);
    expect(bare).toMatch(/grant execute on function gatepass\.pass_routed_to_me\(uuid\) to authenticated;/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 062 — an approver delegates their OWN office for a stated period.
//
// The security of this migration is one property: `gatepass.my_approval_role()`
// is a scalar over a query that can now yield rows from TWO tables, and Postgres
// returns an arbitrary one rather than erroring. If any of the seat refusals
// below is dropped, one human can hold two seats and sign two rungs of the same
// pass — the four-eyes property the whole ladder rests on. Every case here is
// one of those refusals, or the ceiling that limits what a stand-in may commit.
// ──────────────────────────────────────────────────────────────────────────────
describe('062 — approval delegation', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('062'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('creates and alters nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  // The table says who covers for whom and to what value ceiling. RLS on with
  // NO policy and NO grant is the shape 052 and 060 both take: the RPCs are the
  // only way in, so there is no query anybody can send that reaches it.
  it('locks the table to its RPCs — RLS on, no policy, no grant', () => {
    expect(bare).toMatch(/alter table gatepass\.approval_delegations enable row level security;/i);
    expect(bare).not.toMatch(/create policy[\s\S]*approval_delegations/i);
    expect(bare).not.toMatch(/grant\s+(select|insert|update|delete)[^;]*gatepass\.approval_delegations/i);
  });

  it('refuses a self-delegation and a backwards window in the schema itself', () => {
    expect(bare).toMatch(/check \(delegate_id <> delegator_id\)/i);
    expect(bare).toMatch(/check \(ends_at > starts_at\)/i);
    expect(bare).toMatch(/check \(approval_limit is null or approval_limit > 0\)/i);
  });

  // ── my_approval_role stays scalar ───────────────────────────────────────
  it('widens my_approval_role by a live-delegation arm, gated on the account being active', () => {
    const body = fnBody('gatepass.my_approval_role');
    expect(body).toMatch(/from gatepass\.approval_delegations d/i);
    expect(body).toMatch(/d\.delegate_id = auth\.uid\(\)/i);
    expect(body).toMatch(/gatepass\.delegation_is_live\(d\.revoked_at, d\.starts_at, d\.ends_at\)/i);
    // Both arms ask it, so suspending a delegate empties their queue (040).
    expect((body.match(/gatepass\.is_user_active\(auth\.uid\(\)\)/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // ⚠ A `limit 1` would paper over a broken invariant by picking an arbitrary
  // seat, which is precisely the failure 049 was written to stop. Scalarity is
  // guaranteed by the refusals, not by truncation.
  it('does NOT hide a double seat behind a limit', () => {
    expect(fnBody('gatepass.my_approval_role')).not.toMatch(/limit\s+1/i);
  });

  it('refuses a delegate who already holds an office, a deputy seat or an overlapping delegation', () => {
    const body = fnBody('gatepass.create_approval_delegation');
    expect(body).toMatch(/where r\.user_id = p_delegate_id/i);
    expect(body).toMatch(/where r\.deputy_id = p_delegate_id/i);
    // OVERLAP, not existence — two windows that do not overlap are two separate
    // absences and are legal. Half-open, matching `delegation_is_live`.
    expect(body).toMatch(/d\.starts_at < p_ends_at/i);
    expect(body).toMatch(/d\.ends_at\s+> p_starts_at/i);
  });

  // The other direction, and it is the one an admin could otherwise walk
  // straight through: seating somebody who is already covering an office.
  it('refuses to seat a live-or-future delegate as a holder or a deputy', () => {
    for (const fn of ['gatepass.set_approval_role', 'gatepass.set_approval_deputy']) {
      const body = fnBody(fn);
      expect(body).toMatch(/from gatepass\.approval_delegations d/i);
      expect(body).toMatch(/d\.delegate_id = p_user_id/i);
      expect(body).toMatch(/d\.ends_at > now\(\)/i);
      expect(body).toMatch(/covering the % office under a delegation/i);
      // And 059's refusal survives this restatement.
      expect(body).toMatch(/if not gatepass\.is_user_active\(p_user_id\) then/i);
    }
  });

  // ── Who may write one ───────────────────────────────────────────────────
  // THE APPROVER'S OWN ACT (client, 2026-08-22). Gated on HOLDING the office —
  // not `my_approval_role()`, which is true for a deputy and for a delegate as
  // well, and neither may hand on what they are only covering.
  it('admits only the office holder themselves — not an admin, not a stand-in', () => {
    const body = fnBody('gatepass.create_approval_delegation');
    expect(body).toMatch(/where r\.user_id = auth\.uid\(\)/i);
    expect(body).not.toMatch(/gatepass\.is_admin\(\)/i);
    expect(body).not.toMatch(/gatepass\.my_approval_role\(\)/i);
    expect(body).toMatch(/set search_path = ''/i);
  });

  it('snapshots the office rather than resolving it later', () => {
    const body = fnBody('gatepass.create_approval_delegation');
    expect(body).toMatch(/insert into gatepass\.approval_delegations[\s\S]*values[\s\S]*v_office/i);
  });

  // Not the delegate: somebody covering an office must not be able to quietly
  // hand it back while its holder is away.
  it('lets the delegator or an admin revoke, and nobody else', () => {
    const body = fnBody('gatepass.revoke_approval_delegation');
    expect(body).toMatch(/v_owner <> auth\.uid\(\) and not gatepass\.is_admin\(\)/i);
    // Revoking is not a delete — the history is the whole reason it is kept.
    expect(body).not.toMatch(/delete from gatepass\.approval_delegations/i);
    expect(body).toMatch(/set revoked_at = now\(\)/i);
  });

  // ── The ceiling ─────────────────────────────────────────────────────────
  it('reads the pass value from the database and never from the caller', () => {
    const body = fnBody('gatepass.approve_pass_level');
    expect(body).toMatch(/select coalesce\(sum\(i\.approx_value\), 0\) into v_value/i);
    expect(body).toMatch(/from gatepass\.gate_pass_items i/i);
    expect(body).toMatch(/v_value > v_deleg_limit/i);
  });

  // ⚠ An approval limit caps what somebody may COMMIT the business to. Refusing
  // to let a stand-in STOP a pass because it is worth too much points the rule
  // exactly the wrong way.
  it('applies the ceiling to an approval alone, never to a rejection', () => {
    expect(fnBody('gatepass.reject_pass_level')).not.toMatch(/approval_limit/i);
  });

  it('stamps which seat signed, on both decisions', () => {
    for (const fn of ['gatepass.approve_pass_level', 'gatepass.reject_pass_level']) {
      const body = fnBody(fn);
      expect(body).toMatch(/decided_as_delegate\s*=\s*\(v_deleg_id is not null\)/i);
      expect(body).toMatch(/delegation_id\s*=\s*v_deleg_id/i);
      // 054's stamp is untouched.
      expect(body).toMatch(/decided_as_deputy\s*=\s*coalesce\(v_as_deputy, false\)/i);
    }
  });

  // Carried forward from 058 and 054 through a return-type change, which is the
  // rule CLAUDE.md states: `create or replace` cannot alter a RETURN TYPE, and
  // the grant goes with the drop.
  it('rebuilds get_pass_approvals keeping every column it already returned', () => {
    expect(bare).toMatch(/drop function if exists gatepass\.get_pass_approvals\(uuid\);/i);
    const body = fnBody('gatepass.get_pass_approvals');
    for (const col of ['a.decided_as_deputy', 'a.grandfathered', 'a.decided_as_delegate']) {
      expect(body).toContain(col);
    }
    expect(bare).toMatch(/grant execute on function gatepass\.get_pass_approvals\(uuid\) to authenticated;/i);
  });

  it('names the delegator through a LEFT join, so a missing name never drops a rung', () => {
    const body = fnBody('gatepass.get_pass_approvals');
    expect(body).toMatch(/left join gatepass\.approval_delegations dl on dl\.id = a\.delegation_id/i);
    expect(body).toMatch(/left join public\.profiles gp on gp\.id = dl\.delegator_id/i);
  });

  // ── The readers ─────────────────────────────────────────────────────────
  it('scopes the delegation list to the caller and the candidate list to an office holder', () => {
    expect(fnBody('gatepass.list_my_delegations')).toMatch(/where d\.delegator_id = auth\.uid\(\)/i);
    const cands = fnBody('gatepass.list_delegation_candidates');
    expect(cands).toMatch(/from gatepass\.approval_roles r where r\.user_id = auth\.uid\(\)/i);
    expect(cands).toMatch(/You do not hold a gate pass approval office/i);
    // It hands back no email and no role — this is not the admin directory.
    expect(cands).not.toMatch(/p\.email/i);
    expect(cands).not.toMatch(/p\.role/i);
  });

  it('every new definer function pins an empty search_path and is off `public`', () => {
    for (const fn of [
      'gatepass.create_approval_delegation',
      'gatepass.revoke_approval_delegation',
      'gatepass.list_my_delegations',
      'gatepass.list_delegation_candidates',
      'gatepass.my_live_delegation',
    ]) {
      expect(fnBody(fn)).toMatch(/set search_path = ''/i);
      expect(bare).toMatch(new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\(`, 'i'));
    }
  });

  it('reloads the PostgREST schema cache', () => {
    expect(bare).toMatch(/notify pgrst, 'reload schema';/i);
  });
});

describe('063 — the last rung is the COO or the CEO, and the CEO inherits it on a clock', () => {
  const migrations = sqlMigrations();
  const sql = migrations.find((m) => m.name.startsWith('063'))!.sql;
  const bare = stripSqlComments(sql);
  const fns = extractFunctions(migrations);
  const fnBody = (name: string) => fns.filter((f) => f.name === name).slice(-1)[0].body;

  it('touches nothing in `public` — the two-schema rule', () => {
    expect(/create\s+(table|view|function|type)\s+public\./i.test(bare)).toBe(false);
    expect(/alter\s+table\s+public\./i.test(bare)).toBe(false);
  });

  it('puts the COO and the CEO on the SAME level in the check constraint', () => {
    const check = bare.match(/add constraint pass_approvals_level_matches[\s\S]*?\);/i)![0];
    expect(check).toMatch(/when 'security_head'\s*then 1/i);
    expect(check).toMatch(/when 'finance_head'\s*then 2/i);
    expect(check).toMatch(/when 'coo'\s*then 3/i);
    expect(check).toMatch(/when 'ceo'\s*then 3/i);
  });

  it('drops the old constraint BEFORE renumbering, or no single update could satisfy it', () => {
    const drop = bare.search(/drop constraint if exists pass_approvals_level_matches/i);
    const update = bare.search(/update gatepass\.pass_approvals set level_no/i);
    const add = bare.search(/add constraint pass_approvals_level_matches/i);
    expect(drop).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(drop);
    expect(add).toBeGreaterThan(update);
  });

  it('snapshots new passes in the same order its own constraint enforces', () => {
    // Two copies of one mapping is exactly the drift this pins against: a
    // trigger writing level 4 for the CEO would fail the check on every raise.
    const body = fnBody('gatepass.snapshot_pass_approvals');
    expect(body).toMatch(/when 'finance_head'\s*then 2/i);
    expect(body).toMatch(/when 'coo'\s*then 3/i);
    expect(body).toMatch(/when 'ceo'\s*then 3/i);
    expect(body).not.toMatch(/then 4/i);
  });

  it('replaces the snapshot trigger rather than dropping it', () => {
    // Dropping and recreating would open a window, however short, in which an
    // insert snapshots nothing at all.
    expect(bare).toMatch(/create or replace function gatepass\.snapshot_pass_approvals/i);
    expect(bare).not.toMatch(/drop trigger[\s\S]*snapshot_approvals/i);
  });

  it('a `not_required` rung has a moment and a sentence, and NO author', () => {
    const shape = bare.match(/add constraint pass_approvals_decision_shape[\s\S]*?\);/i)![0];
    expect(shape).toMatch(
      /status = 'not_required'\s+and decided_by is null\s+and decided_at is not null/i,
    );
    // Nobody signed it, so a decided_by here would print a name beside a
    // signature that was never given.
    expect(bare).toMatch(/status in \('pending', 'approved', 'rejected', 'not_required'\)/i);
  });

  it('keeps 058\'s two approval arms — the rollout is still authorless', () => {
    const shape = bare.match(/add constraint pass_approvals_decision_shape[\s\S]*?\);/i)![0];
    expect(shape).toMatch(/status = 'approved' and grandfathered and decided_by is null/i);
    expect(shape).toMatch(/status = 'approved' and not grandfathered and decided_by is not null/i);
  });

  it('closes the sibling rung as `not_required` in the same call as the signature', () => {
    const body = fnBody('gatepass.approve_pass_level');
    expect(body).toMatch(/set status\s*=\s*'not_required'/i);
    // Written as "every other pending row on MY OWN level", so the rule belongs
    // to a shared level rather than to one pair of offices.
    expect(body).toMatch(/a\.level_no = v_mine/i);
    expect(body).toMatch(/a\.role_key <> v_role/i);
    expect(body).toMatch(/a\.status = 'pending'/i);
  });

  it('refuses the CEO while the COO still has time, naming the moment', () => {
    const body = fnBody('gatepass.approve_pass_level');
    expect(body).toMatch(/gatepass\.level_escalates_at\(p_pass_id, v_role\)/i);
    expect(body).toMatch(/now\(\) < v_escalates/i);
    expect(body).toMatch(/raise exception 'This pass is with the COO until/i);
  });

  it('leaves the slip-order rule and the delegation ceiling exactly as they were', () => {
    const body = fnBody('gatepass.approve_pass_level');
    expect(body).toMatch(/An earlier approval level has not signed this pass yet/i);
    expect(body).toMatch(/decided_as_delegate/i);
    expect(body).toMatch(/is limited to/i);
  });

  it('never gates a REJECTION on the escalation window', () => {
    // A limit caps what somebody may COMMIT the business to; refusing to let an
    // office STOP a pass points the rule exactly the wrong way (062's call).
    const body = fnBody('gatepass.reject_pass_level');
    expect(body).not.toMatch(/level_escalates_at|escalat/i);
  });

  it('counts the window from when the rung was REACHED, never from now()', () => {
    const body = fnBody('gatepass.level_escalates_at');
    expect(body).toMatch(/max\(b\.decided_at\)/i);
    expect(body).toMatch(/b\.level_no < a\.level_no/i);
    expect(body).toMatch(/g\.created_at/i);
    expect(body).toMatch(/gatepass\.get_escalation_hours\(\)/i);
    expect(body).not.toMatch(/now\(\)\s*-/i);
  });

  it('answers null unless the CEO is genuinely waiting behind a pending COO', () => {
    const body = fnBody('gatepass.level_escalates_at');
    expect(body).toMatch(/when p_role_key <> 'ceo' then null/i);
    expect(body).toMatch(/c\.role_key = 'coo'[\s\S]*?c\.status = 'pending'/i);
  });

  it('pins search_path on every definer function it adds', () => {
    for (const name of [
      'gatepass.level_escalates_at',
      'gatepass.get_escalation_hours',
      'gatepass.get_app_settings',
      'gatepass.set_app_settings',
      'gatepass.approve_pass_level',
      'gatepass.snapshot_pass_approvals',
      'gatepass.pass_routed_to_me',
    ]) {
      const body = fnBody(name);
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = ''/i);
    }
  });

  it('drops the 4-arg settings setter, so no overload is reachable by named args', () => {
    // 045's lesson: two overloads reachable by named arguments is exactly the
    // ambiguity PostgREST guesses at.
    const drop = bare.search(
      /drop function if exists gatepass\.set_app_settings\(text, text, boolean, int\)/i,
    );
    const create = bare.search(/create function gatepass\.set_app_settings/i);
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it('bounds the escalation window in the column and restates it as a sentence', () => {
    expect(bare).toMatch(/coo_escalation_hours smallint not null default 48/i);
    expect(bare).toMatch(/check \(coo_escalation_hours between 1 and 720\)/i);
    expect(fnBody('gatepass.set_app_settings'))
      .toMatch(/raise exception 'The COO escalation window has to be/i);
  });

  it('keeps the settings table admin-only, and the one integer readable by everyone', () => {
    // `get_session_timeout`'s argument (056): the office holding the pass is not
    // an admin, and their own screen has to say when it becomes theirs.
    expect(fnBody('gatepass.get_app_settings')).toMatch(/if not gatepass\.is_admin\(\) then/i);
    expect(fnBody('gatepass.set_app_settings')).toMatch(/if not gatepass\.is_admin\(\) then/i);
    expect(fnBody('gatepass.get_escalation_hours')).not.toMatch(/is_admin/i);
    expect(bare).toMatch(/grant execute on function gatepass\.get_escalation_hours\(\) to authenticated;/i);
  });

  it('leaves `pass_awaits_approval` alone — a not_required rung stops blocking at once', () => {
    expect(bare).not.toMatch(/function gatepass\.pass_awaits_approval/i);
  });
});
