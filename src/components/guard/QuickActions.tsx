// The three screens a guard reaches for that are not on this board, drawn to
// the client's mock-up (2026-08-19): a tinted rounded plate, a bold title and
// a grey note, inside one card under a "Quick Actions" heading.
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

type Action = { to: string; glyph: GuardGlyph; tone: GuardTone; title: string; note: string };

const ACTIONS: Action[] = [
  { to: '/console', glyph: 'scan', tone: 'green', title: 'Scan QR / Pass No.', note: 'Scan or search any pass' },
  { to: '/returns', glyph: 'clock', tone: 'blue', title: 'Returns Due Today', note: 'Record material coming back' },
  { to: '/overdue', glyph: 'alert', tone: 'orange', title: 'Overdue Returns', note: 'Material past its return date' },
];

export default function QuickActions(): React.ReactElement {
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
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
