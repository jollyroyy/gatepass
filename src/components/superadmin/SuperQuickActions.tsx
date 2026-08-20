// The super admin's Quick Actions — `QuickActions` in shape, tile for tile,
// with the four screens a super admin actually reaches for.
//
// EVERY TILE IS A ROUTE IN `ROLE_ROUTES.super_admin`. The guard's own rule: a
// tile whose page the reader cannot open is worse than no tile.
//
// THE FOURTH TILE IS THE ONE A SUPER ADMIN HAS THAT NOBODY ELSE DOES — the
// emergency releases waiting to be reviewed (migration 055). It carries a count
// for the same reason the guard's two do: the queue is work, and a door with no
// figure on it gives no reason to open it today rather than tomorrow.
//
// ⚠ IT POINTS AT `/admin`, NOT A PAGE OF ITS OWN, because that is where
// `EmergencyReleasesCard` actually renders — on the Users tab. A tile that
// promised a screen this app does not have would be the same broken promise the
// guard's mock-up's fourth tile was.
//
// AND THE COUNT IS NOT OF THE READER'S OWN WORK. `review_emergency_release`
// REFUSES the person who made the release, so a super admin who released all
// four of these can review none of them. The figure counts UNREVIEWED releases,
// which is what the queue holds; the card behind it is what knows whose are
// whose, and draws a button accordingly (`canReviewRelease`).
import React from 'react';
import { Link } from 'react-router-dom';
import HodIcon from '../hod/HodIcon';
import type { HodGlyph, HodTone } from '../hod/hodIconTypes';

type Action = {
  to: string;
  glyph: HodGlyph;
  tone: HodTone;
  title: string;
  note: string;
  /** Absent = this tile shows no figure. */
  counted?: boolean;
};

const ACTIONS: Action[] = [
  { to: '/admin', glyph: 'people', tone: 'blue', title: 'Departments & Users', note: 'Accounts, departments, approval ladder' },
  { to: '/all-passes', glyph: 'document', tone: 'green', title: 'Reports', note: 'Every pass, filtered and exported' },
  { to: '/activity', glyph: 'clock', tone: 'purple', title: 'Activity Log', note: 'Every approval and gate event' },
  { to: '/admin', glyph: 'shield', tone: 'red', title: 'Emergency Releases', note: 'Overrides awaiting an independent review', counted: true },
];

/** One release, two releases — and the word is "release", never "item": these
 *  are not material lines, and the guard's tiles count lines. */
function releaseCount(n: number): string {
  return `${n} ${n === 1 ? 'release' : 'releases'}`;
}

type Props = {
  /** Emergency releases nobody has reviewed yet. */
  unreviewed: number;
  /** Still loading; the tile draws without a figure rather than flashing a zero
   *  that is not an answer. */
  loading?: boolean;
};

export default function SuperQuickActions({ unreviewed, loading = false }: Props): React.ReactElement {
  return (
    <div className="gb-card gb-quick">
      <h2 className="gb-quick-title">Quick Actions</h2>
      <div className="gb-quick-grid gb-quick-grid-4">
        {ACTIONS.map((a) => (
          <Link key={a.title} to={a.to} className="gb-tile">
            <HodIcon glyph={a.glyph} tone={a.tone} shape="square" />
            <span className="min-w-0">
              <span className="gb-tile-title">{a.title}</span>
              <span className="gb-tile-note">{a.note}</span>
              {a.counted && !loading && (
                <span className="gb-tile-count">{releaseCount(unreviewed)}</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
