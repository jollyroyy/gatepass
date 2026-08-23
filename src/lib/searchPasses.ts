// THE READS BEHIND THE GATE'S SEARCH — the two queries a non-code query runs,
// in one place, so `useGateSearch` stays a state machine and nothing else.
//
// NEITHER QUERY IS NARROWED BY THE SCREEN IT WAS TYPED ON. Both read
// `v_gate_passes` unfiltered by status, type or date: a guard holding a slip is
// asking about the register, not about the list they happen to have open. RLS
// is what scopes the answer, and it is the only thing that should.
import { gp } from '../supabaseClient';
import type { GatePassView } from '../types';
import { passMatchesPhone, phoneSearchPattern } from './phoneSearch';
import {
  ITEM_TEXT_FIELDS,
  mergeMatches,
  orFilter,
  PASS_TEXT_FIELDS,
  sanitizeTerm,
} from './passTextSearch';

/** How many passes one search may answer with. A gate terminal cannot read
 *  more than this, and a query that wide is one the guard should narrow. */
export const SEARCH_LIMIT = 50;

/** Item rows scanned to find the passes behind them. Higher than SEARCH_LIMIT
 *  because a pass has many lines, and the ids collapse. */
const ITEM_SCAN_LIMIT = 400;

/** Passes carrying this mobile number. The `ilike` is a narrowing on the last
 *  four digits only and can over-match (an address holding the same digits);
 *  `passMatchesPhone` is what decides, on the pass's OWN phone field. */
export async function searchPassesByPhone(raw: string): Promise<GatePassView[]> {
  const { data, error } = await gp()
    .from('v_gate_passes')
    .select('*')
    .ilike('visitor_company', phoneSearchPattern(raw))
    .order('created_at', { ascending: false })
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  return ((data as GatePassView[] | null) ?? []).filter((p) => passMatchesPhone(p, raw));
}

/**
 * Passes matching free text on their own columns OR on any of their material
 * lines — name, vendor, requester, vehicle, purpose, and a line's make/model,
 * invoice (order) number or serial.
 *
 * THE LINES READ IS ALLOWED TO FAIL QUIETLY. If `v_gate_pass_items` errors, the
 * pass-level answer is still a true answer and is returned; taking the whole
 * search down because the second half of it failed would leave the guard with
 * nothing when they had something.
 */
export async function searchPassesByText(raw: string): Promise<GatePassView[]> {
  const term = sanitizeTerm(raw);
  if (!term) return [];

  const [passRes, itemRes] = await Promise.all([
    gp()
      .from('v_gate_passes')
      .select('*')
      .or(orFilter(PASS_TEXT_FIELDS, term))
      .order('created_at', { ascending: false })
      .limit(SEARCH_LIMIT),
    gp()
      .from('v_gate_pass_items')
      .select('gate_pass_id')
      .or(orFilter(ITEM_TEXT_FIELDS, term))
      .limit(ITEM_SCAN_LIMIT),
  ]);

  if (passRes.error) throw passRes.error;
  const direct = (passRes.data as GatePassView[] | null) ?? [];
  if (itemRes.error) return direct.slice(0, SEARCH_LIMIT);

  const known = new Set(direct.map((p) => p.id));
  const extra = [
    ...new Set(
      ((itemRes.data as { gate_pass_id: string }[] | null) ?? [])
        .map((r) => r.gate_pass_id)
        .filter((id) => id && !known.has(id))
    ),
  ].slice(0, SEARCH_LIMIT);

  if (extra.length === 0) return direct.slice(0, SEARCH_LIMIT);

  const byLine = await gp()
    .from('v_gate_passes')
    .select('*')
    .in('id', extra)
    .order('created_at', { ascending: false });

  // Same rule as above: the lines told us WHICH passes; if reading them back
  // fails, the passes we already have are still the answer.
  const lineRows = byLine.error ? [] : ((byLine.data as GatePassView[] | null) ?? []);
  return mergeMatches(direct, lineRows).slice(0, SEARCH_LIMIT);
}
