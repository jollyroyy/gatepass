// Derivations for the Search Pass record view — the full gate-pass record a
// guard gets back after searching a pass number or a mobile number.
//
// Presentation only: no new query, no new column, no migration. Every field
// read here is already on `gatepass.v_gate_passes` / `v_gate_pass_items`.
//
// The per-line return stage is derived from `returned_qty` vs `quantity` and
// NOWHERE else. `returned_at` is not used for it: `apply_item_returns` writes
// that column only when a line goes FULLY back, so a partly-returned line has
// a null `returned_at` and would read as "pending" — which is wrong, the
// material is half in. Quantities are the fact; the timestamp is a note.
import type { GatePassItemView, PassType } from '../types';
import type { StatusStyle } from './statusStyles';

export type ItemReturnStage = 'closed' | 'pending' | 'partial' | 'returned';

/** Where one material line stands on the return leg.
 *
 *  NRGP has no return leg at all — the check constraint pins the parent's
 *  `return_status` to 'not_applicable' — so its lines are 'closed': the
 *  material left for good and the line is finished the moment the gate
 *  cleared it. Not "pending" (it would never clear) and not "N/A" (the line
 *  HAS an outcome; N/A read as missing data). Client, 2026-08-18. */
export function itemReturnStage(
  item: Pick<GatePassItemView, 'quantity' | 'returned_qty'>,
  passType: PassType,
): ItemReturnStage {
  if (passType !== 'RGP') return 'closed';
  if (item.returned_qty <= 0) return 'pending';
  if (item.returned_qty >= item.quantity) return 'returned';
  return 'partial';
}

/** Direct lookup, never an includes() chain. The hues are the SAME ones the
 *  pass badges use (statusStyles.ts / rgpLifecycle.ts), so a line that reads
 *  "Returned" green cannot sit under a pass badge of a different green. */
export const ITEM_RETURN_STYLES: Record<ItemReturnStage, StatusStyle> = {
  // Green, the same hue RGP_STAGE_STYLES.closed uses — an NRGP line that is
  // out of the gate is as finished as an RGP whose material came back.
  closed: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Closed' },
  pending: { bg: 'bg-pending-50', text: 'text-pending-700', dot: 'bg-pending-500', label: 'Pending' },
  partial: {
    bg: 'bg-accent-50', text: 'text-accent-700', dot: 'bg-accent-500', label: 'Partially Returned',
  },
  returned: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Returned' },
};

export type ReturnProgress = { returned: number; total: number; percent: number };

/** "3 of 5 items returned — 60%". Counts LINES fully back, not quantities: the
 *  bar sits above a table of lines, and a reader compares it to rows they can
 *  see. An empty pass is 0 of 0 at 0% — never NaN. */
export function returnProgress(items: GatePassItemView[], passType: PassType): ReturnProgress {
  const total = items.length;
  const returned = items.filter((i) => itemReturnStage(i, passType) === 'returned').length;
  return { returned, total, percent: total === 0 ? 0 : Math.round((returned / total) * 100) };
}

/** How many lines still owe material — the count in the mock-up's amber strip
 *  under the table ("2 items still need attention before this pass can be
 *  closed"). It counts PENDING **and** PARTIAL: a line with 800 of 1,000 litres
 *  back is still an open obligation, and a strip that ignored it would say the
 *  pass is ready to close while the database refuses to close it.
 *
 *  Zero for an NRGP, which owes nothing by construction. */
export function pendingItemCount(items: GatePassItemView[], passType: PassType): number {
  return items.filter((i) => {
    const stage = itemReturnStage(i, passType);
    return stage === 'pending' || stage === 'partial';
  }).length;
}

/** "2 min ago" / "3 hr ago" / "4 days ago" — the "Last updated" line under the
 *  QR code. Never negative, and never the bare "0 min ago" that reads as a
 *  broken clock. */
export function relativeSince(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
