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
import type { GatePassItemView, GatePassView, PassStatus, PassType } from '../types';
import type { StatusStyle } from './statusStyles';

export type ItemReturnStage = 'closed' | 'pending' | 'partial' | 'returned';

/** The return leg's four stages plus the one outcome that has nothing to do
 *  with a return: the pass itself was refused. See `itemLineStage`. */
export type ItemLineStage = ItemReturnStage | 'rejected';

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

/** A pass whose journey ENDED IN A REFUSAL — so its material lines never went
 *  anywhere and never will.
 *
 *  Client, 2026-08-20: "once any approver is rejecting the pass, all the
 *  individual items are still showing pending … show the status also as
 *  rejected against each individual item … everywhere, not only the pass."
 *  The lines read "Pending" because `itemReturnStage` grades the RETURN LEG and
 *  a refused pass never started one: `returned_qty` is 0 on every line for ever.
 *
 *  A `Record<PassStatus, boolean>` rather than an `includes()` chain, per the
 *  repo's no-fuzzy-enum-matching rule: adding a label to `gatepass.pass_status`
 *  breaks the build here until somebody has decided whether it is a refusal.
 *
 *  BOTH REFUSALS COUNT, and deliberately so. `reject_pass_level` (046) writes
 *  `cancelled` with no `flag_reason`; the gate's own `flag_pass` writes
 *  `flagged`, and the HOD upholding it writes `cancelled` WITH the guard's
 *  reason. All three mean the same thing to a material line: it is not moving.
 *  Known cost, accepted: `hod_void_expired_pass` (041) also writes `cancelled`
 *  with no reason, so a pass voided for running out of time reads "Rejected" on
 *  its lines too. The pass's own badge a few pixels above still says "Voided",
 *  and no other signal separates the two on every screen that shows a line —
 *  `is_expired` goes true on a rejected pass as well, once its day passes. */
const REFUSED_STATUS: Record<PassStatus, boolean> = {
  pending: false,
  held: false,        // still open — a hold alleges nothing
  matched: false,
  flagged: true,      // rejected at the security gate
  hod_reviewed: false,
  cancelled: true,    // an approval office refused it, or the HOD upheld a flag
};

export function passWasRejected(p: Pick<GatePassView, 'status'>): boolean {
  return REFUSED_STATUS[p.status];
}

/** What a material line reads on any surface that badges one.
 *
 *  The pass's refusal OUTRANKS the return leg — the same precedence
 *  `passStageStyle` gives the attention states over the return loop, and for
 *  the same reason: a line on a refused pass is not "awaiting" anything. */
export function itemLineStage(
  item: Pick<GatePassItemView, 'quantity' | 'returned_qty'>,
  pass: Pick<GatePassView, 'type' | 'status'>,
): ItemLineStage {
  if (passWasRejected(pass)) return 'rejected';
  return itemReturnStage(item, pass.type);
}

/** The return-leg styles plus the refusal, in the flagged red the pass badge
 *  uses for `flagged` — a line cannot read "Rejected" in a different red to the
 *  pass it sits on. */
export const ITEM_LINE_STYLES: Record<ItemLineStage, StatusStyle> = {
  ...ITEM_RETURN_STYLES,
  rejected: {
    bg: 'bg-flagged-50', text: 'text-flagged-700', dot: 'bg-flagged-500', label: 'Rejected',
  },
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
