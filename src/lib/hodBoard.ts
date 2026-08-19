// THE HOD DASHBOARD'S FOUR FIGURES, and the greeting above them.
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
//   RUNNING — card 4, and the "pending at the gate" note. An obligation does not
//             stop being open because the calendar rolled over, so a Today-scoped
//             Overdue card would print 0 while material sat off site.
//
// The mock's own numbers say the same thing: it draws 6 RGP issued today above
// "7 pending at the gate". The note is deliberately NOT a subset of the card it
// sits under — it is the running queue, which is what the reader is being asked
// to act on.
import type { GatePassView } from '../types';
import type { BoardDrill } from './boardDrills';
import { IS_OPEN_RETURN } from './boardDrills';
import { isWaitingAtGate } from './boardKpis';
import { DAY_MS, dayStart } from './localDay';
import { APPROVAL_WAITING_TOTAL } from './hodApprovals';
import type { HodGlyph, HodTone } from '../components/hod/hodIconTypes';

export type HodKpiKey = 'total' | 'nrgpIssued' | 'rgpIssued' | 'pendingReturn';

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

/** "N pending approval". ALWAYS ZERO, and from one place — see hodApprovals.ts.
 *  This app has no multi-level approval workflow: a raised pass goes straight to
 *  the gate, and the four offices on the printed slip sign in wet ink. */
const pendingApprovalNote = (): HodKpiNote => ({
  text: `${APPROVAL_WAITING_TOTAL} pending approval`,
  dot: 'purple',
});

/**
 * The four cards, in the mock-up's order, each carrying its own rows.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a test can pin a
 * day boundary without freezing the clock globally.
 */
export function buildHodKpis(rows: GatePassView[], now: number = Date.now()): HodKpiCard[] {
  const today = raisedToday(rows, now);
  const nrgpToday = today.filter((p) => p.type === 'NRGP');
  const rgpToday = today.filter((p) => p.type === 'RGP');
  // RUNNING, not today's — see the header. The same predicate the RGP Awaiting
  // Clearance tile used on the old board, imported rather than restated.
  const atGate = rows.filter((p) => p.type === 'RGP' && isWaitingAtGate(p));
  const overdue = overdueReturns(rows);

  return [
    {
      key: 'total',
      label: 'Total Passes',
      sub: 'Today',
      glyph: 'document',
      tone: 'blue',
      value: today.length,
      notes: [{ text: 'All types' }],
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
      notes: [pendingApprovalNote()],
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
      notes: [
        { text: `${atGate.length} pending at the gate`, dot: 'orange' },
        pendingApprovalNote(),
      ],
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
      notes: [{ text: `${overdue.length} overdue` }],
      drill: {
        key: 'pendingReturn',
        heading: 'Material past its return date',
        empty: 'Nothing you raised is overdue.',
        rows: overdue,
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
