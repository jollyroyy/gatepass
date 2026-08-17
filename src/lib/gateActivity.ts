// "Today's Gate Activity" — what actually crossed the barrier today.
//
// A MOVEMENT IS A GATE EVENT, NOT A RAISED PASS. `created_at` records when an
// HOD typed the paperwork; `verified_at` records when the guard cleared the
// material and `actual_return_date` when it came back. A gate log built on
// `created_at` would show a busy morning on a day nothing moved.
//
// ONE PASS CAN PRODUCE TWO EVENTS — cleared out at 09:00, returned at 17:00 is
// two visits to the barrier, and collapsing them would hide the return, which is
// the half a return-watch board exists for.
//
// A FLAGGED PASS PRODUCES NONE. It has a `verified_at` (the guard did act) but
// the material did not go anywhere: a mismatch is a decision for the raising
// HOD, and it belongs on their review queue, not in a log of what left site.
import type { GatePassView } from '../types';
import type { Slice } from './boardAnalytics';
import { categoryKey } from './passTypes';
import { dayStart } from './localDay';

export type GateActivityKind = 'out' | 'in' | 'returned' | 'cleared';

export interface GateActivityEvent {
  /** Unique per (pass, event) — a pass that moved twice today yields two rows. */
  key: string;
  passId: string;
  passNumber: string;
  /** ISO timestamp of the movement itself. */
  at: string;
  kind: GateActivityKind;
  /** "RGP Out", "NRGP Cleared" — what happened, in the gate's words. */
  title: string;
  /** The material line under the title. */
  detail: string;
}

/** The badge on the right of each row. `Record`, never a string chain, so a new
 *  kind without a badge is a type error. */
export const ACTIVITY_BADGE: Record<GateActivityKind, string> = {
  out: 'OUT',
  in: 'IN',
  returned: 'RETURNED',
  cleared: 'CLEARED',
};

/** What a clearance of this pass is called. An RGP leaving is "out" — it owes a
 *  return; an NRGP is "cleared" — it is finished, and calling it "out" would put
 *  it in the reader's mind as something to wait for. */
function clearance(p: GatePassView): { kind: GateActivityKind; title: string } {
  const category = categoryKey(p.type, p.direction);
  if (category === 'RGP-out') return { kind: 'out', title: 'RGP Out' };
  if (category === 'RGP-in') return { kind: 'in', title: 'RGP In' };
  return { kind: 'cleared', title: 'NRGP Cleared' };
}

/** Today's movements, newest first.
 *
 *  Today only, and that is not a truncation of a longer list — this panel
 *  answers "what is happening at the gate right now". The register
 *  (`/all-passes`, `/my-passes`) is where any other day is read, and the card
 *  links to it. `now` is injectable so a test cannot straddle midnight. */
export function gateActivityEvents(rows: GatePassView[], now: number = Date.now()): GateActivityEvent[] {
  const today = dayStart(now);
  const events: GateActivityEvent[] = [];

  for (const p of rows) {
    const detail = p.material_summary || '—';

    if (p.actual_return_date && dayStart(new Date(p.actual_return_date).getTime()) === today) {
      events.push({
        key: `${p.id}-returned`, passId: p.id, passNumber: p.pass_number,
        at: p.actual_return_date, kind: 'returned', title: 'RGP Returned', detail,
      });
    }

    if (p.status === 'matched' && p.verified_at && dayStart(new Date(p.verified_at).getTime()) === today) {
      const { kind, title } = clearance(p);
      events.push({
        key: `${p.id}-${kind}`, passId: p.id, passNumber: p.pass_number,
        at: p.verified_at, kind, title, detail,
      });
    }
  }

  // ISO-8601 UTC strings sort lexicographically in chronological order, so this
  // needs no Date allocation per comparison.
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** What each kind is called in the pie's legend. A `Record`, so a new kind
 *  without a name is a type error rather than a nameless slice. */
export const ACTIVITY_LABEL: Record<GateActivityKind, string> = {
  out: 'RGP Out',
  in: 'RGP In',
  returned: 'RGP Returned',
  cleared: 'NRGP Cleared',
};

/** The order the slices are drawn and listed in. Fixed, not sorted by size: a
 *  ring whose colours move between renders cannot be read at a glance, which is
 *  the only way a wall board is ever read. */
const SLICE_ORDER: GateActivityKind[] = ['out', 'in', 'returned', 'cleared'];

/** Today's gate activity as pie slices, each CARRYING the passes behind it.
 *
 *  This panel replaced the activity TIMELINE (client, 2026-08-17), and the
 *  swap changes what a click means, so the rows travel with the slice: the list
 *  a slice opens is the very array its number was taken from, which is the
 *  board's one invariant. A pass that both left and came back today appears in
 *  two slices — that is two visits to the barrier, and collapsing them would
 *  hide the return.
 *
 *  Every bucket is listed even at zero: the four kinds are a fixed taxonomy, and
 *  "RGP Returned: 0" on a day nothing came back is a fact worth stating. */
export function gateActivitySlices(rows: GatePassView[], now: number = Date.now()): Slice[] {
  const events = gateActivityEvents(rows, now);
  const byId = new Map(rows.map((p) => [p.id, p]));

  return SLICE_ORDER.map((kind) => {
    const passes = events
      .filter((e) => e.kind === kind)
      .map((e) => byId.get(e.passId))
      .filter((p): p is GatePassView => p !== undefined);
    return { key: kind, label: ACTIVITY_LABEL[kind], value: passes.length, rows: passes };
  });
}
