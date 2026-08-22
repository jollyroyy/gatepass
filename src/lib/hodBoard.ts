// THE HOD DASHBOARD'S FIVE FIGURES, and the greeting above them.
//
// The board an HOD used to get was the admin's `GateBoard` narrowed to one
// person — two KPI rows, a movement trend, a status ring, a return watch and a
// top-items ring. The client replaced it wholesale with their own mock-up
// (2026-08-19): a greeting, four cards, Quick Actions and an Approval Pending
// strip. This module is the data half of that; the layout is
// `src/components/hod/*` and `src/pages/HOD/Dashboard.tsx`.
//
// THE BOARD'S ONE INVARIANT SURVIVES THE REWRITE: every figure carries the very
// rows it counted, on a `BoardDrill`, and the stacked list a click opens renders
// exactly that array. No aggregate query, no `count: 'exact'`, no predicate
// re-applied against a second array — a figure that disagrees with its own list
// is invisible to the eye and fatal to trust.
//
// TWO SCOPES SIT SIDE BY SIDE ON THIS ROW, exactly as they do on the mock-up,
// and mixing them up is the mistake this file is arranged to prevent:
//
//   TODAY   — cards 1–3. Passes RAISED today, by `created_at` in LOCAL time.
//   RUNNING — cards 4 and 5. An obligation does not stop being open because the
//             calendar rolled over, so a Today-scoped Overdue card would print 0
//             while material sat off site, and a Today-scoped Pending Approvals
//             card would print 0 while yesterday's pass sat unsigned.
//
// The mock's own numbers say the same thing: it draws 6 RGP issued today above
// "7 pending at the gate". The note is deliberately NOT a subset of the card it
// sits under — it is the running queue, which is what the reader is being asked
// to act on.
import type { GatePassView } from '../types';
import type { BoardDrill } from './boardDrills';
import { IS_OPEN_RETURN } from './boardDrills';
import { pendingSplit } from './pendingSplit';
import { rejectionNotes, rejectionSplit, type RejectionApprovalRow } from './rejectionSplit';
import { DAY_MS, dayStart } from './localDay';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

export type HodKpiKey =
  | 'total'
  | 'nrgpIssued'
  | 'rgpIssued'
  | 'pendingReturn'
  // TWO DESKS, TWO CARDS (client, 2026-08-22). `pendingApproval` used to be
  // both, with the split printed under it as two sub-lines.
  | 'pendingGate'
  | 'pendingApproval'
  | 'rejected';

/** One line under a card's figure. `dot` draws the mock's small coloured bullet;
 *  a note without one is the plain grey line ("All types"). */
export interface HodKpiNote {
  text: string;
  dot?: HodTone;
}

export interface HodKpiCard {
  key: HodKpiKey;
  /** The words beside the figure — "Total Passes". */
  label: string;
  /** The smaller line under the label — the mock's "Today" / "Overdue". */
  sub: string;
  glyph: HodGlyph;
  tone: HodTone;
  value: number;
  notes: HodKpiNote[];
  /** The rows the figure counted, and the heading the stacked list gets. */
  drill: BoardDrill;
}

/** Local calendar day containing `now`. Local, not UTC: a pass raised at 09:00
 *  IST belongs to that morning on every screen in this app. */
function raisedToday(rows: GatePassView[], now: number): GatePassView[] {
  const start = dayStart(now);
  const end = start + DAY_MS;
  return rows.filter((p) => {
    if (!p.created_at) return false;
    const t = new Date(p.created_at).getTime();
    return t >= start && t < end;
  });
}

/** An RGP whose material is past its date and still outside. `is_overdue` is
 *  defined ONCE, in `gatepass.v_gate_passes`, and is never recomputed here. */
export function overdueReturns(rows: GatePassView[]): GatePassView[] {
  return rows.filter((p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue);
}

/**
 * The five cards, the mock-up's four in its own order plus Pending Approvals,
 * each carrying its own rows.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a test can pin a
 * day boundary without freezing the clock globally.
 *
 * IT NO LONGER TAKES `pendingApprovalTotal`, a roll-up that used to be printed
 * as a note on two other cards. The fifth card counts PASSES, which is what
 * every other figure on this board counts and what its own drill list renders;
 * the per-office breakdown is the Approval Pending strip at the foot of the
 * page, which since 2026-08-21 counts in the same unit and sums to this card's
 * own "N pending approval" sub-line (`hodApprovals.ts`).
 */
export function buildHodKpis(
  rows: GatePassView[],
  now: number = Date.now(),
  /** `pass_approvals` rows for these passes — what tells a rejection made ON
   *  THE LADDER apart from a pass the HOD merely voided when it expired. The
   *  board already reads them for the two strips at its foot; defaulting to
   *  empty keeps every existing caller and fixture working, and an empty
   *  ladder simply means no pass was rejected by an approver. */
  approvals: RejectionApprovalRow[] = [],
): HodKpiCard[] {
  const today = raisedToday(rows, now);
  const nrgpToday = today.filter((p) => p.type === 'NRGP');
  const rgpToday = today.filter((p) => p.type === 'RGP');
  // RUNNING, not today's — see the header. `split.waiting` is every pass of
  // this HOD's that has not been through the gate; the two sub-figures under
  // the fifth card are that same array cut in half by `awaits_approval`, so
  // they sum to the figure by construction.
  const split = pendingSplit(rows);
  const overdue = overdueReturns(rows);
  // TODAY, like the three cards it sits beside — not running. A rejection is an
  // event, and a running count of every pass ever rejected grows without bound
  // and stops being something anybody acts on.
  const rejected = rejectionSplit(today, approvals);

  return [
    {
      key: 'total',
      label: 'Total Passes',
      sub: 'Today',
      glyph: 'document',
      tone: 'blue',
      value: today.length,
      // NO NOTE. Client, 2026-08-19: "remove the bottom All types" — the figure
      // is every type by definition, and a line saying so under it is a second
      // statement of the same fact.
      notes: [],
      drill: {
        key: 'total',
        heading: 'Passes raised today',
        empty: 'You have not raised a pass today.',
        rows: today,
      },
    },
    {
      key: 'nrgpIssued',
      label: 'NRGP Issued',
      sub: 'Today',
      glyph: 'send',
      tone: 'green',
      value: nrgpToday.length,
      // NO NOTE. The "N pending approval" roll-up this card used to repeat now
      // has a card of its own (below), where it is broken into the two desks a
      // waiting pass can be sitting on. Repeating it here would print the same
      // number three times on one row — the exact thing the client asked to
      // stop on 2026-08-19 ("show it only once").
      notes: [],
      drill: {
        key: 'nrgpIssued',
        heading: 'NRGP raised today',
        empty: 'No NRGP raised today.',
        rows: nrgpToday,
      },
    },
    {
      key: 'rgpIssued',
      label: 'RGP Issued',
      sub: 'Today',
      glyph: 'exchange',
      tone: 'purple',
      value: rgpToday.length,
      // NO NOTE, same reason: both lines this card used to carry are the fifth
      // card now, and unlike these they are not narrowed to RGP.
      notes: [],
      drill: {
        key: 'rgpIssued',
        heading: 'RGP raised today',
        empty: 'No RGP raised today.',
        rows: rgpToday,
      },
    },
    {
      key: 'pendingReturn',
      label: 'Pending Return',
      sub: 'Overdue',
      glyph: 'clock',
      tone: 'orange',
      value: overdue.length,
      // NO NOTE, for the same reason and on the same instruction ("I need to
      // put zero overdue multiple times — show it only once"): the card already
      // reads `0` in 32px type over the words Pending Return · Overdue, and
      // "0 overdue" under it made the same zero appear three times.
      notes: [],
      drill: {
        key: 'pendingReturn',
        heading: 'Material past its return date',
        empty: 'Nothing you raised is overdue.',
        rows: overdue,
      },
    },
    {
      // THE TWO PENDING DESKS, ONE CARD EACH (client, 2026-08-22: "separate the
      // pending at gate review and pending for approvals, and remove those
      // subtext"). They were the FIFTH card — one figure with the split printed
      // under it in two small notes — and they are separate work for separate
      // people, so each now stands over the rows it actually counts. What they
      // count has not moved: `pendingSplit` is the same function the admin's
      // board and the report's two filters read.
      //
      // SCOPE IS ALREADY THE HOD's, and is not this module's doing: RLS narrows
      // to their department (`gate_passes_select`, 002) and `useHodBoardData`
      // narrows again to what they raised, server-side.
      key: 'pendingGate',
      label: 'Pending Gate Review',
      sub: 'Running',
      glyph: 'clock',
      tone: 'orange',
      value: split.atGate.length,
      notes: [],
      drill: {
        key: 'pendingGate',
        heading: 'Passes waiting at the gate',
        empty: 'Nothing of yours is waiting at the gate.',
        rows: split.atGate,
      },
    },
    {
      key: 'pendingApproval',
      label: 'Pending Approval',
      sub: 'Running',
      glyph: 'hourglass',
      tone: 'purple',
      value: split.awaitingApproval.length,
      notes: [],
      drill: {
        key: 'pendingApproval',
        heading: 'Passes still owing an approval',
        empty: 'Nothing of yours is waiting on an approver.',
        rows: split.awaitingApproval,
      },
    },
    {
      // THE SIXTH CARD — client, 2026-08-20: "show a dashboard KPI card of
      // rejected under all HOD, and under the rejected KPI card give the total
      // number. Below that put it — rejected at security gate, rejected by
      // approver — show exact count."
      //
      // The two notes SUM to the figure by construction (`rejectionSplit`), and
      // a pass the HOD voided because it expired is in neither: nobody rejected
      // it. See `src/lib/rejectionSplit.ts` for why `flag_reason` being null is
      // not what separates the two desks.
      key: 'rejected',
      label: 'Rejected',
      sub: 'Today',
      glyph: 'alert',
      tone: 'red',
      value: rejected.all.length,
      notes: rejectionNotes(rejected).map((n) => ({
        text: n.text,
        dot: n.key === 'gate' ? ('red' as HodTone) : ('purple' as HodTone),
      })),
      drill: {
        key: 'rejected',
        heading: 'Passes rejected today',
        empty: 'Nothing of yours was rejected today.',
        rows: rejected.all,
      },
    },
  ];
}

/** "Good morning" / "Good afternoon" / "Good evening", by the reader's own
 *  clock. The mock's greeting, and the only thing on the page that changes
 *  without the data changing. */
export function greetingFor(now: number = Date.now()): string {
  const h = new Date(now).getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Who the greeting names. The mock greets by FULL name ("Good morning, Rahul
 *  Sharma") — unlike the guard board, which uses the first name alone — so this
 *  only trims and falls back. A profile that never resolves leaves "Good
 *  morning, HOD", which is what the header said before anyone was named, so the
 *  read has no error surface of its own. */
export function hodGreetingName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim();
  return trimmed || 'HOD';
}
