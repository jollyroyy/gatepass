// The CSV a human opens in Excel must contain what the screen shows — no raw
// enum keys, no ISO timestamps, no escape characters, no columns that the
// database stopped having years ago.
//
// The client's complaint was exactly that: "no gibberish or out-of-the-world
// script … show them as exactly but if needed to be hidden make sure you hide
// them, but don't show any gibberish or any ASCII format". Three separate
// defects sat behind it, and each has a test below:
//
//   1. every cell went through a formula guard that prefixed a literal TAB to
//      anything starting with `-` — so an ordinary negative number arrived in
//      Excel with an invisible control character glued to it;
//   2. `status` / `return_status` / `type` / `unit` exported the stored enum
//      key (`hod_reviewed`, `not_applicable`, `nos`) rather than the label the
//      table beside the Export button renders;
//   3. the HOD's export listed `material_description` / `quantity` / `unit`,
//      three columns migration 013 deleted — every row exported them blank.
import { describe, it, expect } from 'vitest';
import { toCsv, type CsvColumn } from '../../src/lib/exportUtils';
import { csvCategory, csvDate, csvDateTime, csvReturnStatus, csvStatus, csvUnit } from '../../src/lib/csvCells';
import { ALL_PASSES_CSV_COLUMNS } from '../../src/pages/Admin/AllPassesReport';
import { MY_PASSES_CSV_COLUMNS } from '../../src/pages/HOD/MyPasses';

describe('escaping — nothing a human did not type', () => {
  it('leaves a negative number exactly as it is', () => {
    const csv = toCsv([{ n: -5 }], [{ key: 'n', header: 'N' }]);
    expect(csv).toBe('N\r\n-5');
    expect(csv).not.toContain('\t');
  });

  it('leaves an ordinary number and an ordinary word alone', () => {
    const csv = toCsv([{ a: 3100, b: 'Housekeeping' }], [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
    ]);
    expect(csv).toBe('A,B\r\n3100,Housekeeping');
  });

  it('renders a null as an empty cell, never "null" or a dash', () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
    ]);
    expect(csv).toBe('A,B\r\n,');
  });

  it('still neutralises a real formula, which is the only case worth mangling', () => {
    const csv = toCsv([{ a: '=SUM(A1:A9)' }], [{ key: 'a', header: 'A' }]);
    expect(csv).toContain('\t=SUM(A1:A9)');
  });

  it('quotes a value containing a comma rather than splitting the row', () => {
    const csv = toCsv([{ a: 'Drill, cordless' }], [{ key: 'a', header: 'A' }]);
    expect(csv).toBe('A\r\n"Drill, cordless"');
  });
});

describe('cell formatters — the label, not the stored key', () => {
  it('turns a status enum into the badge label the table shows', () => {
    expect(csvStatus({ status: 'hod_reviewed', is_expired: false })).toBe('HOD Approved');
    expect(csvStatus({ status: 'flagged', is_expired: false })).toBe('Mismatched');
    expect(csvStatus({ status: 'pending', is_expired: true })).toBe('Expired');
  });

  it('leaves the return column blank when there is no return loop', () => {
    expect(csvReturnStatus({ return_status: 'not_applicable' })).toBe('');
    expect(csvReturnStatus({ return_status: 'partially_returned' })).toBe('Partly Returned');
  });

  it('names the category, so RGP In is not filed as RGP Out', () => {
    expect(csvCategory({ type: 'RGP', direction: 'out' })).toBe('RGP Out');
    expect(csvCategory({ type: 'RGP', direction: 'in' })).toBe('RGP In');
    expect(csvCategory({ type: 'NRGP', direction: 'out' })).toBe('NRGP Out');
  });

  it('spells the unit out, and exports no dash for a missing one', () => {
    expect(csvUnit('nos')).toBe('Numbers');
    expect(csvUnit(null)).toBe('');
  });

  it('exports a readable date, never an ISO timestamp, and blank for null', () => {
    expect(csvDateTime('2026-08-17T09:47:00.000Z')).not.toContain('T');
    expect(csvDateTime('2026-08-17T09:47:00.000Z')).toMatch(/2026/);
    expect(csvDateTime(null)).toBe('');
    expect(csvDate(null)).toBe('');
    expect(csvDate('2026-08-17')).toMatch(/2026/);
  });
});

describe('the exported columns', () => {
  const COLUMN_SETS: [string, CsvColumn<never>[]][] = [
    ['All Passes', ALL_PASSES_CSV_COLUMNS as unknown as CsvColumn<never>[]],
    ['My Passes', MY_PASSES_CSV_COLUMNS as unknown as CsvColumn<never>[]],
  ];

  // Migration 013 moved the material lines out of `gate_passes` into
  // `gate_pass_items`. A column list still naming them exports a blank cell for
  // every row, which is what "gibberish" looks like once it reaches a
  // spreadsheet: a header with nothing under it.
  const GONE = ['material_description', 'quantity', 'unit', 'cancel_reason', 'serial_no'];

  it.each(COLUMN_SETS)('%s exports no column that the view no longer has', (_name, cols) => {
    for (const c of cols) expect(GONE).not.toContain(c.key);
  });

  it.each(COLUMN_SETS)('%s formats every enum and date column', (_name, cols) => {
    // Anything whose raw value is an enum key or a timestamp must carry a
    // `format`; a plain string or a count may go through as-is.
    const NEEDS_FORMAT = ['type', 'status', 'return_status', 'created_at',
      'expected_return_date', 'actual_return_date', 'verified_at'];
    for (const c of cols) {
      if (NEEDS_FORMAT.includes(c.key)) {
        expect(c.format, `${c.key} must be formatted`).toBeTypeOf('function');
      }
    }
  });
});
