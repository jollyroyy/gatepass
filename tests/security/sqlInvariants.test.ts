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
