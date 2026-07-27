// Rebuilds supabase/APPLY_ALL.sql from supabase/migrations/.
//
// APPLY_ALL.sql is the artifact a human pastes into the Supabase SQL Editor —
// there is no `supabase db push` in this project (no CLI link, no DB password).
// That makes drift the worst bug this repo can have: a migration edited but not
// re-concatenated is a fix that never reaches the database, and nothing fails
// loudly. Editing both by hand is how that happens, so don't — run this:
//
//   node scripts/build-apply-all.mjs      (or: npm run build:sql)
//
// The hand-written preamble at the top of APPLY_ALL.sql is PRESERVED: everything
// before the first section divider is copied through untouched. Only the
// concatenated sections below it are regenerated.
//
// tests/security/applyAllIntegrity.test.ts is the backstop that catches drift if
// someone edits a migration and forgets this script.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const target = join(root, 'supabase', 'APPLY_ALL.sql');

// Migrations that must land LAST regardless of their number. 005 is an optional
// demo seed; keeping it at the end means a real deployment can stop before it
// without also losing the sections numbered above it.
const LAST = ['005_seed_hod_departments.sql'];

const DIVIDER = '-- ═══════════════════════════════════════════════════════════';

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const ordered = [...files.filter((f) => !LAST.includes(f)), ...LAST.filter((f) => files.includes(f))];

// Preamble = everything before the first section divider. If APPLY_ALL.sql is
// missing or has no divider yet, refuse rather than invent a header: that header
// carries the "add gatepass to Exposed schemas" step, and losing it silently
// would cost the next reader an afternoon of PGRST106.
let preamble;
try {
  const existing = readFileSync(target, 'utf8');
  const at = existing.indexOf(DIVIDER);
  if (at === -1) throw new Error('no section divider found');
  preamble = existing.slice(0, at);
} catch (err) {
  console.error(`Cannot rebuild ${target}: ${err.message}`);
  console.error('Restore the file (git checkout) and re-run — its hand-written header is not generated.');
  process.exit(1);
}

const sections = ordered.map((name) => {
  const sql = readFileSync(join(migrationsDir, name), 'utf8');
  return `${DIVIDER}\n-- ${name}\n${DIVIDER}\n${sql.replace(/\s*$/, '')}\n`;
});

writeFileSync(target, `${preamble}${sections.join('\n')}`, 'utf8');
console.log(`Wrote ${target}\n  ${ordered.length} sections: ${ordered.join(', ')}`);
