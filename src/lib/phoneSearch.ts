// The gate can find a pass by the mobile number of the person who took the
// material out, not just by pass number or QR.
//
// The number is NOT its own column: RaisePass packs it into `visitor_company`
// as `{"n":name,"a":address,"v":phone}` (see lib/companyInfo.ts), and it is
// stored EXACTLY as the HOD typed it — "+91 98765-43210", "098765 43210",
// "9876543210" are all real. So the comparison must be on digits alone, and
// the server-side narrowing must not assume any formatting.
//
// The narrowing key is the LAST FOUR digits: separators in a phone number are
// written between groups from the left, so the final four are contiguous in
// every format seen here, while the first four are not ("+91 98765..."). The
// ilike below is therefore a filter that can over-match (an address containing
// "4321"), never one that under-matches — `passMatchesPhone` is what decides.
import type { GatePassView } from '../types';
import { parseCompanyInfo } from './companyInfo';

/** Digits only. Everything else — spaces, +, -, (), the 91 prefix's plus — is
 *  presentation. */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** The shortest query worth running. Four digits would match half the register;
 *  six is a real tail of a number someone read off a slip. */
export const MIN_PHONE_QUERY_DIGITS = 6;

/** A pass number always carries letters (`RGP-OUT-20260726-0001`), so anything
 *  with a letter in it is a pass-number lookup and belongs to `lookup_pass`.
 *  What is left is treated as a phone number once it is long enough. */
export function isPhoneQuery(raw: string): boolean {
  if (/[A-Za-z]/.test(raw)) return false;
  return phoneDigits(raw).length >= MIN_PHONE_QUERY_DIGITS;
}

/** The `ilike` pattern for the server-side narrowing. */
export function phoneSearchPattern(raw: string): string {
  const d = phoneDigits(raw);
  return `%${d.slice(-4)}%`;
}

/** Suffix match in BOTH directions, so a guard may type the whole number with
 *  a country code the HOD did not record ("919876543210" vs "9876543210") or
 *  just the tail they can read off a slip ("543210"). */
export function phoneMatches(stored: string, query: string): boolean {
  const a = phoneDigits(stored);
  const b = phoneDigits(query);
  if (a.length < MIN_PHONE_QUERY_DIGITS || b.length < MIN_PHONE_QUERY_DIGITS) return false;
  return a.endsWith(b) || b.endsWith(a);
}

/** The authoritative filter: the digits of the pass's OWN phone field, never
 *  the raw blob — an address or a value that happens to contain the same four
 *  digits must not surface as a person. */
export function passMatchesPhone(pass: GatePassView, query: string): boolean {
  return phoneMatches(parseCompanyInfo(pass.visitor_company).phone, query);
}

/** True when the gate can still act on this pass — the same rule the queue
 *  uses (status in pending/hod_reviewed, own expiry not yet passed, every
 *  approval level signed), so a search result and the queue can never disagree
 *  about what is actionable. `match_pass` refuses everything else, and a button
 *  that always fails is worse than no button.
 *
 *  THE LADDER TEST IS NOT REDUNDANT WITH RLS. 046 hides an unapproved pass from
 *  a `guard`, so for almost everybody this line can never fire — but an office
 *  holder who is ALSO a guard account (043 explicitly allows the Security Head
 *  to be one) reads the pass through `pass_routed_to_me`, keeps every gate
 *  screen, and was therefore shown Approve OUT on a pass they had just approved
 *  at level 1. Pressing it hit `block_unapproved_gate_move` and reported "This
 *  gate pass has not been approved by every level yet" (client, 2026-08-20).
 *  `awaits_approval` comes off `v_gate_passes` (migration 057) and is never
 *  recomputed here. */
export function canVerifyAtGate(pass: GatePassView, now: Date = new Date()): boolean {
  if (pass.status !== 'pending' && pass.status !== 'hod_reviewed') return false;
  if (pass.awaits_approval) return false;
  return new Date(pass.expires_at).getTime() > now.getTime();
}
