export interface CsvColumn<T = Record<string, unknown>> {
  /** The property read off the row when there is no `format`. */
  key: string;
  header: string;
  /**
   * How the cell should READ. Supply this for anything whose stored value is
   * not what the screen shows — an enum key (`hod_reviewed`), a timestamp, a
   * unit code. The exported file is the same report the table beside the
   * Export button renders, so the two must agree; see `csvCells.ts`, which
   * holds the formatters and reuses the very label maps the badges do.
   */
  format?: (row: T) => string;
}

/**
 * Quote a value only when it contains a comma, quote, or newline (RFC 4180).
 *
 * The `\t` prefix neutralises CSV injection: a cell starting `=`, `+`, `-` or
 * `@` is a formula to Excel and Google Sheets. It is deliberately NOT applied
 * to a plain number — `-5` is not an attack, and a tab welded to the front of
 * every negative figure is exactly the "gibberish / ASCII format" the client
 * reported seeing in the exports (2026-08-17). Real formulas are still
 * mangled, because a mangled cell beats an executed one.
 */
function escapeCsvValue(value: unknown): string {
  let str = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str)) str = '\t' + str;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** The CSV text itself. Exported so tests can read what a download would
 *  contain without going near the DOM. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvValue(c.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => escapeCsvValue(c.format ? c.format(row) : (row as Record<string, unknown>)[c.key]))
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}

/**
 * Builds and downloads a CSV file from arbitrary row objects.
 * BOM-prefixed so Excel opens the UTF-8 file without mangling accented text.
 */
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const blob = new Blob(['﻿', toCsv(rows, columns)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
