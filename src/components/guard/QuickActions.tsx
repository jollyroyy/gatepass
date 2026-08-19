// The three screens a guard reaches for that are not on this board.
//
// The client's mock-up drew four, one of them "Recent Activity". There is no
// activity feed in this app — a guard's own history is in the register, which
// is an admin screen — so rather than draw a tile that goes nowhere, the row is
// the three destinations a guard actually has: search, today's returns, and the
// backlog. Every tile is a route in `ROLE_ROUTES.guard`; a tile whose page the
// reader cannot open is worse than no tile.
import React from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../KpiCard';
import GuardIcon, { type GuardGlyph } from './GuardIcon';

type Action = { to: string; glyph: GuardGlyph; tone: Tone; title: string; note: string };

const ACTIONS: Action[] = [
  { to: '/console', glyph: 'scan', tone: 'brand', title: 'Scan QR / Pass No.', note: 'Scan or search any pass' },
  { to: '/returns', glyph: 'calendar', tone: 'pending', title: 'Returns Due Today', note: 'Record material coming back' },
  { to: '/overdue', glyph: 'alert', tone: 'overdue', title: 'Overdue Returns', note: 'Material past its return date' },
];

export default function QuickActions(): React.ReactElement {
  return (
    <div>
      <h2 className="board-section-title mb-3">Quick Actions</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="card card-hover p-4 flex items-center gap-3 min-w-0">
            <GuardIcon glyph={a.glyph} tone={a.tone} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-navy-800">{a.title}</span>
              <span className="block text-caption text-navy-500">{a.note}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
