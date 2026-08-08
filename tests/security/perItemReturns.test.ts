// Per-item returns (migration 029): a guard closes an RGP line by line, each
// line stamping its own return time, and the pass closes itself once the last
// line is back.
//
// These are static checks on the migration files, in the same spirit as
// sqlInvariants.test.ts — there is no database in the test run, so what can be
// proven here is that the SQL says what it must say. The behavioural proof is a
// live run against the real database.
import { describe, expect, it } from 'vitest';
import { sqlMigrations, stripSqlComments } from './sourceScan';

function allSql(): string {
  return sqlMigrations()
    .map((m) => stripSqlComments(m.sql))
    .join('\n');
}

/** The LAST definition of a function wins — later migrations replace earlier
 *  ones, so an invariant asserted against an early body proves nothing. */
function finalFunctionBody(fnName: string): string {
  const re = new RegExp(`create\\s+(?:or replace\\s+)?function\\s+gatepass\\.${fnName}\\b`, 'gi');
  const sql = allSql();
  const matches = [...sql.matchAll(re)];
  expect(matches.length, `gatepass.${fnName} is never defined`).toBeGreaterThan(0);
  const last = matches[matches.length - 1];
  // Up to the next `create ... function`, or end of file.
  const after = sql.slice(last.index! + last[0].length);
  const next = after.search(/create\s+(?:or replace\s+)?function\s+/i);
  return next === -1 ? after : after.slice(0, next);
}

describe('per-item returns — the column', () => {
  it('gate_pass_items carries returned_at', () => {
    expect(allSql()).toMatch(/alter table gatepass\.gate_pass_items[\s\S]*?add column if not exists returned_at/i);
  });

  it('returned_at is nullable — a line still outstanding has no return time', () => {
    // A `not null` here would be a lie: it would force a default of now() onto
    // every line at raise time, so every unreturned item would claim to have
    // come back the moment it left.
    const m = allSql().match(/add column if not exists returned_at\s+([^,;]+)/i);
    expect(m, 'returned_at is never added').not.toBeNull();
    expect(m![1].toLowerCase()).not.toContain('not null');
  });
});

describe('per-item returns — apply_item_returns stamps each line', () => {
  const body = () => finalFunctionBody('apply_item_returns');

  it('sets returned_at in the same statement that moves returned_qty', () => {
    // Two statements would leave a window where a line reads as fully returned
    // with no return time, and a crash between them makes that permanent.
    const perLineUpdate = body().match(
      /update gatepass\.gate_pass_items[\s\S]*?where id = v_item\.id/i,
    );
    expect(perLineUpdate, 'no per-line update found').not.toBeNull();
    expect(perLineUpdate![0]).toMatch(/returned_qty\s*=\s*returned_qty\s*\+\s*v_qty/i);
    expect(perLineUpdate![0]).toMatch(/returned_at\s*=/i);
  });

  it('stamps returned_at only when the line becomes FULLY returned', () => {
    // A partially-returned line still owes material. A timestamp on it would
    // read as "this came back" on every screen that shows one.
    const perLineUpdate = body().match(
      /update gatepass\.gate_pass_items[\s\S]*?where id = v_item\.id/i,
    )![0];
    expect(perLineUpdate).toMatch(/returned_qty\s*\+\s*v_qty\s*>=\s*quantity/i);
  });

  it('never overwrites a return time that is already set', () => {
    const perLineUpdate = body().match(
      /update gatepass\.gate_pass_items[\s\S]*?where id = v_item\.id/i,
    )![0];
    expect(perLineUpdate).toMatch(/coalesce\(\s*returned_at\s*,/i);
  });

  it('uses pg_catalog.now(), since the function pins an empty search_path', () => {
    expect(body()).toMatch(/pg_catalog\.now\(\)/i);
  });

  it('still rolls the lines up so the pass closes itself once the last line is back', () => {
    // This is what makes "once all items are returned the whole pass closes"
    // true without the client ever deciding it.
    expect(body()).toMatch(/returned_qty\s*<\s*i\.quantity|i\.returned_qty\s*<\s*i\.quantity/i);
    expect(body()).toMatch(/'returned'::gatepass\.return_status/i);
  });
});

describe('per-item returns — the view exposes it', () => {
  it('v_gate_pass_items is rebuilt (drop + create), not `create or replace`', () => {
    // TRAP 2: a view's column list is fixed at creation, so `select i.*` does
    // not grow when gate_pass_items does. `create or replace` fails outright.
    const sql = allSql();
    const lastDrop = sql.toLowerCase().lastIndexOf('drop view if exists gatepass.v_gate_pass_items');
    const lastCreate = sql.toLowerCase().lastIndexOf('create view gatepass.v_gate_pass_items');
    expect(lastDrop, 'v_gate_pass_items is never dropped').toBeGreaterThan(-1);
    expect(lastCreate).toBeGreaterThan(lastDrop);
  });

  it('the rebuilt view is re-granted to authenticated — a dropped view takes its grants with it', () => {
    const sql = allSql();
    const lastCreate = sql.toLowerCase().lastIndexOf('create view gatepass.v_gate_pass_items');
    expect(sql.slice(lastCreate)).toMatch(/grant select on gatepass\.v_gate_pass_items to authenticated/i);
  });
});

describe('per-item returns — the client still cannot write a return directly', () => {
  it('no migration grants update on gate_pass_items', () => {
    // returned_at is now part of the audit record. A client that could set it
    // could backdate a return to before the material was even verified.
    for (const { name, sql } of sqlMigrations()) {
      const stripped = stripSqlComments(sql).toLowerCase();
      for (const m of stripped.matchAll(/grant\s+([^;]*?)\s+on\s+gatepass\.gate_pass_items/gi)) {
        expect(m[1], `${name} grants "${m[1]}" on gate_pass_items`).not.toContain('update');
        expect(m[1], `${name} grants "${m[1]}" on gate_pass_items`).not.toContain('all');
      }
    }
  });
});
