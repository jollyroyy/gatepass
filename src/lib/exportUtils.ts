export interface CsvColumn {
  key: string;
  header: string;
}

/** Quote a value only when it contains a comma, quote, or newline (RFC 4180). */
function escapeCsvValue(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds and downloads a CSV file from arbitrary row objects.
 * BOM-prefixed so Excel opens the UTF-8 file without mangling accented text.
 */
export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns: CsvColumn[],
): void {
  const header = columns.map((c) => escapeCsvValue(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');

  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
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
