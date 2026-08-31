// psql access for the e2e scripts.
//
// WHY NOT THE SERVICE-ROLE KEY: migration 007 gives service_role the narrowest
// grant set in `gatepass` on purpose, so `approval_roles`, `app_settings` and
// friends answer "permission denied for table" over PostgREST. Seeding needs
// them, and psql connects as `postgres`.
//
// psql BYPASSES RLS ENTIRELY. Nothing proved here proves a policy works — the
// browser tests, signed in as a real user with the anon key, are the only thing
// that can (CLAUDE.md).
import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

const DB = process.env.SUPABASE_DB_URL;

export function psql(sql) {
  if (!DB) throw new Error('Missing SUPABASE_DB_URL in .env');
  let out;
  try {
    out = execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // The connection string carries the database password, and execFileSync puts
    // the whole argv into the Error it throws. Re-throw with the SQL and the
    // server's own message only.
    const detail = (e.stderr ?? '').toString().trim() || String(e.message).split('\n')[0];
    throw new Error(`psql failed\n  sql: ${sql}\n  ${detail}`);
  }
  // STRIP CARRIAGE RETURNS. psql on Windows ends every row with CRLF, and under
  // `-A -F <sep>` the CR is glued to the LAST COLUMN of each row. A snapshot
  // taken that way stored a designator id of "\r", which is not a uuid — the
  // restore would have failed at the exact moment it was needed, with the real
  // values already overwritten.
  return out.replace(/\r/g, '').trim();
}

/** Rows as arrays of strings, tab-separated by psql's `-A -F`. */
export function psqlRows(sql) {
  const out = psql(sql);
  return out ? out.split('\n').map((l) => l.split('\t')) : [];
}
