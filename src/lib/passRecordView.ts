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
import { passStageStyle } from './passStage';

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
  //
  // It says the same words the PASS's badge says (client, 2026-09-01), because
  // `itemReturnStage` reaches this stage for exactly one thing: a line on an
  // NRGP, which is never coming back. A line reading "Closed" under a pass
  // reading "Out — No Return Due" was two vocabularies for one fact.
  closed: {
    bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Out — No Return Due',
  },
  pending: { bg: 'bg-pending-50', text: 'text-pending-700', dot: 'bg-pending-500', label: 'Pending' },
  partial: {
    bg: 'bg-accent-50', text: 'text-accent-700', dot: 'bg-accent-500', label: 'Partially Returned',
  },
  returned: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Returned' },
};

/** A pass whose journey ENDED IN A REFUSAL — so its material lines never went
 *  anywhere and never will.
 *
 *  A `Record<PassStatus, boolean>` rather than an `includes()` chain, per the
 *  repo's no-fuzzy-enum-matching rule: adding a label to `gatepass.pass_status`
 *  breaks the build here until somebody has decided whether it is a refusal.
 *
 *  Its remaining job is narrow — the record WITHHOLDS every return-leg figure on
 *  such a pass (no progress line, no Action column, and the column head reads
 *  "Status" rather than "Return Status"), because a bar over an obligation that
 *  never began is a reading of something that does not exist. The line's own
 *  WORDS no longer come from here: since 2026-08-21 a line simply repeats the
 *  pass's badge (`itemLineView`), which already says "Rejected at Security Gate"
 *  / "Voided" / "Cancelled" for exactly these statuses — and says it in the
 *  words printed on the pass a few pixels above, rather than in a second
 *  vocabulary of its own. */
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

/** The pass facts a line needs in order to name its own state. */
export type ItemLinePass = Pick<
  GatePassView, 'type' | 'status' | 'return_status' | 'is_expired' | 'is_overdue' | 'awaits_approval'
>;

/**
 * WHAT ONE MATERIAL LINE READS, on every surface that badges one.
 *
 * Client, 2026-08-21: "whatever status you are showing on the top for the gate
 * pass, show the exact same status for the individual items, except when the
 * individual return item status has to be mentioned … if an individual item has
 * been completely returned, mark it returned … otherwise show whatever you are
 * showing on top of the pass. Show that exactly across all the views."
 *
 * THERE ARE EXACTLY TWO FACTS A LINE KNOWS THAT ITS PASS DOES NOT: this line is
 * fully back, and this line is half back. Both are quantities on the line
 * itself and neither can be read off the pass's badge — a pass with three of
 * eight headsets in reads "Partially Returned" as a whole while one of its lines
 * is finished and another has not started.
 *
 * EVERYTHING ELSE IS A FACT ABOUT THE PASS, so the line repeats
 * `passStageStyle` verbatim — the same function, the same words, the same hue.
 * That is what stops "Pending" appearing under a badge saying "Overdue",
 * "Pending Approval" or "Rejected at Security Gate": grading the return leg of a
 * pass whose return leg has not begun answered a question nobody asked.
 *
 * A REFUSAL AND AN UNSTARTED RETURN FALL OUT OF THE SAME RULE, with no special
 * case: `returned_qty` is 0 on every line of a refused pass for ever, so neither
 * override can fire and the pass's own refusal is what the line shows.
 */
export function itemLineView(
  item: Pick<GatePassItemView, 'quantity' | 'returned_qty'>,
  pass: ItemLinePass,
): StatusStyle {
  // A REFUSAL OUTRANKS BOTH OVERRIDES. Today it cannot even come up — a pass is
  // only refused before the gate lets it out, so `returned_qty` is 0 on every
  // line of one — but the client asked for the return leg to become flaggable on
  // the way back in, and when that lands a line that came back must not read
  // "Returned" on a pass the gate has just rejected.
  if (passWasRejected(pass)) return passStageStyle(pass);
  const stage = itemReturnStage(item, pass.type);
  if (stage === 'returned') return ITEM_RETURN_STYLES.returned;
  if (stage === 'partial') return ITEM_RETURN_STYLES.partial;
  return passStageStyle(pass);
}

export type ReturnProgress = { returned: number; total: number; percent: number };

/** "3 of 5 items returned — 38%".
 *
 *  TWO DIFFERENT COUNTS, ON PURPOSE. `returned` / `total` are LINES fully back,
 *  because the sentence says "items" and sits over a table of lines a reader can
 *  count. `percent` is the share of the MATERIAL — the sum of the returned
 *  quantities over the sum of the issued ones.
 *
 *  The percentage used to count lines too, and that is the bug the client
 *  reported (2026-08-21): three of eight headsets back on a single line closes
 *  no line at all, so the bar read 0% over a table plainly showing material
 *  returned. A figure that says "nothing has come back" while something has is
 *  worse than no figure.
 *
 *  IT NEVER ROUNDS AWAY A REAL MOVEMENT. 1 of 1,000 units rounds to 0% and 999
 *  of 1,000 rounds to 100%, and both readings are lies about the two facts this
 *  bar exists to state — whether the return has STARTED and whether it is
 *  FINISHED — so a part-returned pass is clamped to 1–99%. 0% and 100% are
 *  reserved for exactly nothing back and exactly everything back.
 *
 *  A line the return leg does not apply to (every NRGP line) counts as fully
 *  accounted: it left for good and owes nothing. An empty pass is 0 of 0 at 0%,
 *  never NaN. */
export function returnProgress(items: GatePassItemView[], passType: PassType): ReturnProgress {
  const total = items.length;
  const returned = items.filter((i) => itemReturnStage(i, passType) === 'returned').length;

  let issuedQty = 0;
  let backQty = 0;
  for (const i of items) {
    const qty = Number(i.quantity) || 0;
    issuedQty += qty;
    backQty += itemReturnStage(i, passType) === 'closed'
      ? qty
      : Math.min(Math.max(Number(i.returned_qty) || 0, 0), qty);
  }

  return { returned, total, percent: quantityPercent(backQty, issuedQty) };
}

/** The clamp described on `returnProgress`, kept separate so it is testable and
 *  so the two edge readings cannot be re-derived differently by a future
 *  caller. */
function quantityPercent(back: number, issued: number): number {
  if (issued <= 0 || back <= 0) return 0;
  if (back >= issued) return 100;
  const pct = Math.round((back / issued) * 100);
  return Math.min(99, Math.max(1, pct));
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
