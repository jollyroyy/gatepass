// THE GATE'S TEXT SEARCH — everything a query can be that is neither a pass
// code nor a mobile number.
//
// A guard is handed a slip, or a name, or nothing but "the Dell laptop the IT
// people took out last week". Until now the search understood exactly two
// shapes: a code (anything containing a letter went to `lookup_pass`, so a
// typed NAME came back "no pass matches that code") and a mobile number. This
// module is the third shape, and it is deliberately BROAD — the client asked
// for pass number, mobile, person, vendor, the person who took the material
// out, an invoice / order number, and a make and model (2026-08-24).
//
// IT SEARCHES TWO TABLES, BECAUSE THE ANSWER LIVES IN BOTH. The party, the
// carrier, the requester and the vehicle are columns of `v_gate_passes`; the
// make / model, the invoice number and the serial are columns of a MATERIAL
// LINE (migration 045) and are not rolled up into `material_summary`, which is
// `string_agg(i.name)` and nothing more. A search for "Latitude 5440" that
// only read the pass row would find nothing, so `searchPasses` runs both and
// unions the answers.
//
// ONE QUERY CAN MATCH MANY PASSES AND THAT IS THE NORMAL CASE (client: "there
// are maybe five passes in for Dell"). Nothing here returns a single row.
import type { GatePassView } from '../types';

/** Columns of `gatepass.v_gate_passes` a text query is matched against.
 *  `visitor_company` is the `{"n":…,"a":…,"v":…}` blob and is matched RAW on
 *  purpose: an ilike over the JSON text finds the vendor name inside it without
 *  a second round trip, and a false positive here is a pass the guard can see
 *  is wrong, never one they are shown an action for they should not have. */
export const PASS_TEXT_FIELDS = [
  'pass_number',
  'visitor_name',
  'visitor_company',
  'raised_by_name',
  'material_summary',
  'vehicle_number',
  'purpose',
] as const;

/** Columns of `gatepass.v_gate_pass_items`. `invoice_no` is the client's
 *  "order number" — 045 labels it Invoice / Reference No. */
export const ITEM_TEXT_FIELDS = [
  'name',
  'description',
  'make_model',
  'invoice_no',
  'serial_no',
] as const;

/** Two characters is the shortest query worth running. One would return the
 *  register. */
export const MIN_TEXT_QUERY_CHARS = 2;

/** `RGP-OUT-20260727-0001`, and the older `RGP-20260819-0001` that predates
 *  direction in the number (migration 010). */
const PASS_NUMBER_RE = /^[A-Za-z]{2,5}-[A-Za-z]{2,4}-\d{4,10}-\d{1,8}$/;
const LEGACY_PASS_NUMBER_RE = /^[A-Za-z]{2,5}-\d{4,10}-\d{1,8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A code that belongs to `gatepass.lookup_pass` — a WHOLE pass number, a pass
 * id, or the URL a QR code carries.
 *
 * WHY THIS IS A SHAPE TEST AND NOT "CONTAINS A LETTER". That was the old rule,
 * and it sent every name, vendor and model number down a path that logs a scan
 * attempt, fires the blacklist alert and can only ever answer with ONE row or
 * `not_found`. Those three things are right for a code someone scanned or
 * copied off a slip and wrong for a word someone typed, so the code path is now
 * reserved for things actually shaped like a code. A PARTIAL pass number
 * ("RGP-OUT-2026") falls through to the text search, which matches
 * `pass_number` with an ilike — so typing half a number still finds the pass,
 * as a list.
 */
export function isPassCodeQuery(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return UUID_RE.test(t) || PASS_NUMBER_RE.test(t) || LEGACY_PASS_NUMBER_RE.test(t);
}

/**
 * Strip everything PostgREST's `or=(…)` grammar would read as syntax.
 *
 * A comma separates the filters in that list and a parenthesis closes it, so a
 * vendor typed as "Dell (India), Pvt" would not merely fail to match — it would
 * be parsed as three more filters and the request would 400. `*` and `%` are
 * ilike wildcards and must not be smuggled in from the box. What is left is
 * collapsed to single spaces so "Dell   XPS" and "Dell XPS" are one query.
 */
export function sanitizeTerm(raw: string): string {
  return raw.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when this query should be run as free text — i.e. it is not a mobile
 *  number (that branch is `phoneSearch.ts`), not a code, and long enough. */
export function isTextQuery(raw: string): boolean {
  if (isPassCodeQuery(raw)) return false;
  return sanitizeTerm(raw).length >= MIN_TEXT_QUERY_CHARS;
}

/** `a.ilike.*term*,b.ilike.*term*` — the argument to PostgREST's `or`. `*` is
 *  its own wildcard and is translated to `%` server-side; writing `%` here
 *  survives the round trip too but reads as an escape in the URL. */
export function orFilter(fields: readonly string[], term: string): string {
  return fields.map((f) => `${f}.ilike.*${term}*`).join(',');
}

/** Union of two result sets, newest first — a pass matched on its own columns
 *  AND on one of its lines must appear once. Keyed by `id`, never by
 *  `pass_number`: the id is what every action downstream is addressed by. */
export function mergeMatches(...sets: GatePassView[][]): GatePassView[] {
  const byId = new Map<string, GatePassView>();
  for (const set of sets) {
    for (const p of set) if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
