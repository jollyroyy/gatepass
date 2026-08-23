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
//   TODAY   — cards 1 and 2. Passes RAISED today, by `created_at` in LOCAL time.
//   RUNNING — cards 3–5. An obligation does not stop being open because the
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
import { DAY_MS, dayStart } from './localDay';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

// NO `total` KEY. The Total Passes card was removed on 2026-08-23 (client:
// "remove total passes from all the dashboard views ... we already have the
// count of RGP and NRGP"). NRGP + RGP is the same number, said by the two
// figures a reader actually acts on, so the third was a restatement — the same
// argument that took the sub-lines off these cards a day earlier.
export type HodKpiKey =
  | 'nrgpIssued'
  | 'rgpIssued'
  | 'pendingReturn'
  // ONE DESK-PAIR, ONE CARD AGAIN (client, 2026-08-23: "merge both the pending
  // gate approval and pending approval into one total card"). They were split
  // into a card each on 2026-08-22 and are back together, with the two desks
  // printed under the total as sub-lines.
  | 'pendingApprovals'
  // REPLACES `rejected`, same instruction. Unlike every other card here this
  // one does not drill in place — it opens `/overdue`, which is the page the
  // sidebar tab used to reach.
  | 'overdue';

/** One line under a card's figure — a desk, and how many passes sit on it. The
 *  notes SUM to the figure above them by construction (`pendingSplit`), which is
 *  the board rule one level down. */
export interface HodKpiNote {
  key: string;
  label: string;
  value: number;
}

export interface HodKpiCard {
  key: HodKpiKey;
  /** The words beside the figure — "Total Passes". */
  label: string;
  glyph: HodGlyph;
  tone: HodTone;
  value: number;
  /** The rows the figure counted, and the heading the stacked list gets.
   *  Absent on a card that navigates instead of drilling. */
  drill?: BoardDrill;
  /** Where the card goes when pressed, INSTEAD of opening a list under itself.
   *  Exactly one of `drill` / `to` is set on every card. */
  to?: string;
  /** The lines under the hairline, if the card has any. */
  notes?: HodKpiNote[];
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
 * each carrying its own rows — except Overdue, which carries a destination.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a test can pin a
 * day boundary without freezing the clock globally.
 *
 * IT NO LONGER TAKES THE LADDER'S ROWS. It took them for the Rejected card,
 * which was removed on 2026-08-23; the Approval Pending strip at the foot of
 * the page still reads them, and still counts in the same unit as the Pending
 * Approvals card's own "Pending approval" sub-line (`hodApprovals.ts`).
 */
export function buildHodKpis(
  rows: GatePassView[],
  now: number = Date.now(),
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

  return [
    {
      key: 'nrgpIssued',
      label: 'NRGP Issued',
      glyph: 'send',
      tone: 'green',
      value: nrgpToday.length,
      // NO NOTE. The "N pending approval" roll-up this card used to repeat now
      // has a card of its own (below), where it is broken into the two desks a
      // waiting pass can be sitting on. Repeating it here would print the same
      // number three times on one row — the exact thing the client asked to
      // stop on 2026-08-19 ("show it only once").
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
      glyph: 'exchange',
      tone: 'purple',
      value: rgpToday.length,
      // NO NOTE, same reason: both lines this card used to carry are the fifth
      // card now, and unlike these they are not narrowed to RGP.
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
      glyph: 'clock',
      tone: 'orange',
      value: overdue.length,
      // NO NOTE, for the same reason and on the same instruction ("I need to
      // put zero overdue multiple times — show it only once"): the card already
      // reads `0` in 32px type over the words Pending Return · Overdue, and
      // "0 overdue" under it made the same zero appear three times.
      drill: {
        key: 'pendingReturn',
        heading: 'Material past its return date',
        empty: 'Nothing you raised is overdue.',
        rows: overdue,
      },
    },
    {
      // THE TWO PENDING DESKS, ONE CARD, THE SPLIT UNDER IT (client,
      // 2026-08-23: "merge both the pending gate approval and pending approval
      // into one total card. Below the card you put it in two subtexts").
      //
      // They stood as a card each between 2026-08-22 and this. What they count
      // has not moved either way: `pendingSplit` is the same function the
      // admin's board and the report's two filters read, and the two notes are
      // that one array cut in half by `awaits_approval`, so they sum to the
      // figure above them by construction rather than by a second predicate.
      //
      // THE DRILL IS THE WHOLE WAITING SET, not one desk — the card's figure is
      // the whole waiting set, and a list that disagrees with the number
      // pressed to open it is the one thing this board never does.
      //
      // SCOPE IS ALREADY THE HOD's, and is not this module's doing: RLS narrows
      // to their department (`gate_passes_select`, 002) and `useHodBoardData`
      // narrows again to what they raised, server-side.
      key: 'pendingApprovals',
      label: 'Pending Approvals',
      glyph: 'hourglass',
      tone: 'purple',
      value: split.waiting.length,
      notes: [
        { key: 'pendingGate', label: 'Pending gate approval', value: split.atGate.length },
        { key: 'pendingApproval', label: 'Pending approval', value: split.awaitingApproval.length },
      ],
      drill: {
        key: 'pendingApprovals',
        heading: 'Passes waiting on a decision',
        empty: 'Nothing of yours is waiting.',
        rows: split.waiting,
      },
    },
    {
      // OVERDUE, WHERE THE REJECTED CARD USED TO BE (client, 2026-08-23:
      // "remove the rejected. Instead put the overdue in the dashboard").
      //
      // IT NAVIGATES RATHER THAN DRILLING, on the same instruction ("once
      // anybody clicks on the overdue card, it should open up the new page as
      // the current overdue page is showing"), and it is now the HOD's only
      // route to `/overdue`: the sidebar tab came off in the same message.
      // `/overdue` is item-level and carries its own filters, which a stacked
      // pass list under a card cannot be.
      key: 'overdue',
      label: 'Overdue',
      glyph: 'alert',
      tone: 'red',
      value: overdue.length,
      to: '/overdue',
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
