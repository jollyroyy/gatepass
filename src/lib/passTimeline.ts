// What happened to this pass, in order — the history the collapsed card no
// longer shows.
//
// Client feedback, 2026-08-11: the card badge now names only the LATEST state
// (see src/lib/passStage.ts), so "it was matched on the way out" has to live
// somewhere. This is that somewhere, and it is defined ONCE so the compact My
// Passes card, the drill card and the pass detail page can never disagree
// about what happened when.
//
// A returnable pass makes two trips and therefore has two gate events:
//
//   Cleared Out — the OUTWARD match. `verified_at` is safe to use for it
//                 because neither `apply_item_returns` nor `mark_returned`
//                 touches that column (013/029 write a `verifications` row and
//                 move `return_status` instead), so on a matched pass it is
//                 still the moment the gate let the material leave.
//   Returned    — the pass closing. `actual_return_date` is set by the same
//                 roll-up that moves `return_status` to 'returned', and is
//                 deliberately null while the pass is only partly back.
//
// This is presentation only: no new query, no new column. Every field it reads
// is already on `gatepass.v_gate_passes`.
import type { GatePassView } from '../types';

export type TimelineMoment = { label: string; at: string };

type TimelinePass = Pick<
  GatePassView,
  | 'status'
  | 'return_status'
  | 'created_at'
  | 'verified_at'
  | 'flag_reason'
  | 'flagged_at'
  | 'hod_reviewed_at'
  | 'actual_return_date'
>;

/** The pass's moments, oldest first. Always at least one — it was raised. */
export function passTimeline(p: TimelinePass): TimelineMoment[] {
  const moments: (TimelineMoment | null)[] = [
    { label: 'Raised', at: p.created_at },
    // `flagged_at` (035) is the FIRST flag; `verified_at` is only a fallback
    // for rows written before that column existed.
    p.flag_reason ? { label: 'Mismatch', at: p.flagged_at ?? p.verified_at ?? p.created_at } : null,
    // Keyed off the timestamp, NOT `status === 'hod_reviewed'`: the old cards
    // dropped this moment the instant the gate matched the fresh pass, which
    // is exactly when a reader most wants to know an override happened.
    p.hod_reviewed_at ? { label: 'Override', at: p.hod_reviewed_at } : null,
    p.status === 'matched' && p.verified_at ? { label: 'Cleared Out', at: p.verified_at } : null,
    p.return_status === 'returned' && p.actual_return_date
      ? { label: 'Returned', at: p.actual_return_date }
      : null,
  ];
  return moments.filter((m): m is TimelineMoment => m !== null);
}
