// THE APPROVAL PENDING STRIP, and the one number behind every "pending
// approval" figure on the HOD dashboard.
//
// READ THIS BEFORE CHANGING ANY NUMBER IN HERE.
//
// The client's mock-up (2026-08-19) draws a strip of four offices — HOD
// Approval, Security Approval, Finance Approval, Other Approvers — each with a
// "Waiting" count, and two of the KPI cards above it carry a "N pending
// approval" line. THIS DATABASE HAS NO SUCH STATE, and the gap was put to the
// client in the same pass. They chose to keep the strip exactly as drawn.
//
// Why there is nothing to count:
//
//   * A raised pass goes STRAIGHT TO THE GATE. `status` is `pending` from the
//     insert until `match_pass` or `flag_pass` moves it; there is no
//     intermediate approval state and no RPC that grants one. The queue an HOD
//     can actually watch is "pending at the gate", which the RGP card names.
//   * `gatepass.approval_roles` (migration 043) is an ORG CHART, not a
//     workflow. One row per office recording WHO holds it, so the printed slip
//     can name a person instead of a blank box. Nothing waits on a level, no
//     level carries a timestamp, and `match_pass` does not consult it. Its own
//     migration comment says so.
//   * The four signatures are WET INK on the A5 slip that travels with the
//     material. That is why a guard's copy of the approval ladder reads
//     APPROVED on all four (see `src/lib/approvalLadder.ts`) — the paper is in
//     their hand.
//
// So every figure below is a HARD ZERO, and deliberately so: inventing one
// would fabricate an approval record on a document that leaves the building.
// They live here, in one module, rather than as four literals in JSX, so that
// the day a real multi-level approval workflow lands there is exactly ONE place
// to make them real.
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

export type ApprovalOffice = 'hod' | 'security' | 'finance' | 'other';

export interface ApprovalSlot {
  key: ApprovalOffice;
  label: string;
  glyph: HodGlyph;
  tone: HodTone;
}

/** The mock-up's four, in its own order. A `Record`-keyed union rather than a
 *  loose string, so a fifth office is a type error and not a silent blank. */
export const APPROVAL_SLOTS: ApprovalSlot[] = [
  { key: 'hod', label: 'HOD Approval', glyph: 'people', tone: 'green' },
  { key: 'security', label: 'Security Approval', glyph: 'shield', tone: 'blue' },
  { key: 'finance', label: 'Finance Approval', glyph: 'wallet', tone: 'orange' },
  { key: 'other', label: 'Other Approvers', glyph: 'people', tone: 'purple' },
];

/** How many passes wait at each office. See the header: all four are zero
 *  because no mechanism in this database can make them anything else. */
export const APPROVAL_WAITING: Record<ApprovalOffice, number> = {
  hod: 0,
  security: 0,
  finance: 0,
  other: 0,
};

/** The roll-up the KPI cards' "N pending approval" lines print. Summed from the
 *  map above rather than written as its own literal, so the strip and the cards
 *  cannot disagree. */
export const APPROVAL_WAITING_TOTAL: number = APPROVAL_SLOTS.reduce(
  (n, s) => n + APPROVAL_WAITING[s.key],
  0,
);
