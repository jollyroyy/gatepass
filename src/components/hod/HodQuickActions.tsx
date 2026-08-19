// Quick Actions — the two things an HOD opens this app to do, drawn to the
// client's mock-up (2026-08-19): a big solid-filled rounded plate, the action's
// name under it, and a grey line saying what it is for.
//
// Both destinations are `/raise`, which is `ROLE_ROUTES.hod`'s second entry. The
// pass TYPE rides in the query string and `RaisePass` reads it, so the two tiles
// are one screen opened two ways rather than two screens that can drift apart.
import React from 'react';
import { Link } from 'react-router-dom';
import HodIcon from './HodIcon';
import type { HodGlyph, HodTone } from './hodIconTypes';

type Action = {
  to: string;
  glyph: HodGlyph;
  tone: HodTone;
  title: string;
  note: string;
};

const ACTIONS: Action[] = [
  { to: '/raise?type=NRGP', glyph: 'documentAdd', tone: 'blue', title: 'Raise NRGP', note: 'New Material / Job Out' },
  { to: '/raise?type=RGP', glyph: 'exchangeAdd', tone: 'purple', title: 'Raise RGP', note: 'Return Material / Job' },
];

export default function HodQuickActions(): React.ReactElement {
  return (
    <div className="gb-card gb-quick">
      <h2 className="gb-quick-title">Quick Actions</h2>
      <div className="gb-raise-grid">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className="gb-raise-tile">
            <HodIcon glyph={a.glyph} tone={a.tone} shape="tile" />
            <span className="gb-raise-title">{a.title}</span>
            <span className="gb-raise-note">{a.note}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
