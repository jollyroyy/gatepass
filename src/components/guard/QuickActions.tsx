// The three screens a guard reaches for that are not on this board, drawn to
// the client's mock-up (2026-08-19): a tinted rounded plate, a bold title and
// a grey note, inside one card under a "Quick Actions" heading.
//
// TWO OF THEM CARRY A COUNT (client, 2026-08-19: "show the count also, returns
// due today as well as overdue... just below that, the count of the items —
// once they want to drill down they should be able to"). The figure is
// `rows.length` of the very array the page it opens renders — the same
// invariant the two summary cards above obey — so it counts MATERIAL LINES,
// not passes: both destinations are line-level tables. Scan QR carries none:
// the register is not a thing to count.
//
// The mock-up drew four, one of them "Recent Activity". There is no activity
// feed in this app — a guard's own history is in the register, which is an
// admin screen — so rather than draw a tile that goes nowhere, the row is the
// three destinations a guard actually has: search, today's returns, and the
// backlog. Every tile is a route in `ROLE_ROUTES.guard`; a tile whose page the
// reader cannot open is worse than no tile.
import React from 'react';
import { Link } from 'react-router-dom';
import GuardIcon, { type GuardGlyph, type GuardTone } from './GuardIcon';

type CountKey = 'dueToday' | 'overdue';

type Action = {
  to: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  title: string;
  note: string;
  /** Absent = this tile shows no figure. */
  count?: CountKey;
};

const ACTIONS: Action[] = [
  { to: '/console', glyph: 'scan', tone: 'green', title: 'Scan QR / Pass No.', note: 'Scan or search any pass' },
  { to: '/returns', glyph: 'clock', tone: 'blue', title: 'Returns Due Today', note: 'Record material coming back', count: 'dueToday' },
  { to: '/overdue', glyph: 'alert', tone: 'orange', title: 'Overdue Returns', note: 'Material past its return date', count: 'overdue' },
];

/** One item, two items — the count is of material lines, and it says so, so a
 *  guard never reads "3" as three passes. */
function itemCount(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

type Props = {
  /** Lines expected back today — what `/returns` lists. */
  dueToday: number;
  /** Lines past their date and still outside — what `/overdue` lists. */
  overdue: number;
  /** The counts are still loading; the tiles draw without them rather than
   *  flashing a zero that is not an answer. */
  loading?: boolean;
};

export default function QuickActions({ dueToday, overdue, loading = false }: Props): React.ReactElement {
  const counts: Record<CountKey, number> = { dueToday, overdue };

  return (
    <div className="gb-card gb-quick">
      <h2 className="gb-quick-title">Quick Actions</h2>
      <div className="gb-quick-grid">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="gb-tile">
            <GuardIcon glyph={a.glyph} tone={a.tone} shape="square" />
            <span className="min-w-0">
              <span className="gb-tile-title">{a.title}</span>
              <span className="gb-tile-note">{a.note}</span>
              {a.count && !loading && (
                <span className="gb-tile-count">{itemCount(counts[a.count])}</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
