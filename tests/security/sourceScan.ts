// Shared static-analysis helpers for tests/security/*.
//
// These specs read source files off disk and assert invariants from
// CLAUDE.md — no network, no Supabase, no React rendering. Everything here
// is plain Node (fs/path), which vitest runs under even with `environment:
// jsdom` configured for the rest of the suite.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

/** Recursively collect files under `dir` whose name matches `pattern`. */
function walk(dir: string, pattern: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, pattern, out);
    } else if (pattern.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Absolute paths of every .ts/.tsx file under src/, recursive. */
export function srcFiles(): string[] {
  return walk(resolve(ROOT, 'src'), /\.tsx?$/);
}

/** Read a file's raw text. */
export function readSrc(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * Strip TypeScript/JS comments: `//`-to-end-of-line and `/* ... *\/` blocks.
 *
 * Several invariants below are DISCUSSED in comments (e.g. supabaseClient.ts
 * explains in prose why `user_metadata` must never be trusted) in files that
 * legitimately must not CONTAIN the pattern in live code. Without stripping,
 * those explanatory comments would falsely trip the same check they document.
 *
 * Deliberately naive (no template-literal or regex-literal awareness) — good
 * enough for scanning this codebase's actual comment style, not a general
 * JS parser.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Strip SQL comments: `--`-to-end-of-line. SQL has no block-comment style used here. */
export function stripSqlComments(text: string): string {
  return text.replace(/--.*$/gm, '');
}

export interface Migration {
  name: string;
  sql: string;
}

/** Every .sql file under supabase/migrations, sorted by filename. */
export function sqlMigrations(): Migration[] {
  const dir = resolve(ROOT, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}
