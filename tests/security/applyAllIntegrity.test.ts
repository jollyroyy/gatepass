// supabase/APPLY_ALL.sql is the artifact a human actually pastes into the
// Supabase SQL Editor — there is no `supabase db push` in this project (no
// CLI link, no DB password). A migration edited but not re-concatenated
// into this file is a fix that silently never reaches the database. These
// checks are the backstop scripts/build-apply-all.mjs's own header points
// to: they catch drift, not produce it — nothing here regenerates the file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sqlMigrations, stripSqlComments } from './sourceScan';

const APPLY_ALL_PATH = resolve(process.cwd(), 'supabase', 'APPLY_ALL.sql');
const applyAll = readFileSync(APPLY_ALL_PATH, 'utf8');

function normalizeWhitespace(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * The distinctive line used to prove a migration's BODY (not just its
 * filename header) survived into APPLY_ALL.sql: the first line of its first
 * `create ` statement.
 *
 * 005_seed_hod_departments.sql is the one migration with no `create`
 * statement at all — it only inserts seed rows (see its own header: it
 * seeds gatepass.hod_departments from data VMS already has). For that one
 * file, fall back to its first comment-stripped, non-blank line instead.
 */
function distinctiveLine(sql: string): string {
  const stripped = stripSqlComments(sql);
  const createIdx = stripped.search(/\bcreate\s/i);
  if (createIdx >= 0) {
    const rest = stripped.slice(createIdx);
    const firstLine = rest.split('\n')[0];
    return normalizeWhitespace(firstLine);
  }
  const firstNonBlank = stripped.split('\n').find((line) => line.trim().length > 0) ?? '';
  return normalizeWhitespace(firstNonBlank);
}

describe('APPLY_ALL.sql integrity', () => {
  const migrations = sqlMigrations();

  it('contains every migration filename as a section header', () => {
    const missing = migrations.filter((m) => !applyAll.includes(m.name)).map((m) => m.name);
    expect(
      missing,
      `these migration files are not referenced in APPLY_ALL.sql at all — they will never be ` +
        `pasted into the Supabase SQL Editor:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('carries a distinctive body line from every migration, not just its filename', () => {
    const missing: string[] = [];
    for (const m of migrations) {
      const line = distinctiveLine(m.sql);
      if (!line) {
        missing.push(`${m.name}: could not find any distinctive line to check (empty file?)`);
        continue;
      }
      const normalizedApplyAll = applyAll
        .split('\n')
        .map(normalizeWhitespace)
        .join('\n');
      if (!normalizedApplyAll.includes(line)) {
        missing.push(`${m.name}: expected line not found in APPLY_ALL.sql: "${line}"`);
      }
    }
    expect(
      missing,
      `a migration's filename header is present in APPLY_ALL.sql but its body content is not — ` +
        `this is exactly the drift scripts/build-apply-all.mjs exists to prevent:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('does not leak supabase/fixes/ content (fixes touch public and are applied by hand)', () => {
    // prevent_self_role_escalation() is defined only in
    // supabase/fixes/public_profiles_recursion.sql, which deliberately alters
    // the public schema (VMS's) and is therefore excluded from the pasteable
    // migration artifact — see that file's own header.
    expect(
      applyAll,
      'APPLY_ALL.sql contains prevent_self_role_escalation, which belongs only to ' +
        'supabase/fixes/public_profiles_recursion.sql — that file must never be folded into ' +
        'the pasteable migration set because it alters the public schema'
    ).not.toContain('prevent_self_role_escalation');
  });

  it('keeps the optional demo seed (005) as the LAST section', () => {
    const seedIndex = applyAll.indexOf('005_seed_hod_departments.sql');
    expect(seedIndex, '005_seed_hod_departments.sql is not present in APPLY_ALL.sql at all').toBeGreaterThan(-1);

    const laterOrEqual = migrations
      .filter((m) => m.name !== '005_seed_hod_departments.sql')
      .map((m) => ({ name: m.name, index: applyAll.indexOf(m.name) }))
      .filter((m) => m.index === -1 || m.index > seedIndex);

    expect(
      laterOrEqual,
      `005_seed_hod_departments.sql must be the last section in APPLY_ALL.sql (it is an ` +
        `OPTIONAL demo seed — a real deployment should be able to stop before it) but these ` +
        `sections appear at or after it:\n${laterOrEqual.map((m) => m.name).join('\n')}`
    ).toEqual([]);
  });
});
