// Quick Actions on the approver's board — the HOD's tile block (`HodQuickActions`),
// drawn for an office holder and holding what that office can actually do.
//
// WHY IT EXISTS AT ALL (client, 2026-09-01: "in the dashboard also make sure to
// put Create Gate Pass in the dashboard of all whoever can create gate passes").
// Since 069 three actors may raise a pass: an HOD, the sitting COO and the
// sitting CEO. The HOD's board has offered it since 2026-08-19. The other two
// were granted `/raise` by `roleRoutes` and then landed by `officeReplacesRole`
// on `/approvals`, which drew this block for the CEO alone holding one link, to
// the whitelist — so the two people the client had just given the power to raise
// for ANY department could reach the form only from the sidebar or by typing the
// URL. `/my-passes` comes with it for the same reason `RAISING_OFFICE_ROUTES`
// pairs them: an office holder heads no department, so 069's
// `raised_by = auth.uid()` arm is the ONLY thing that lets them see a pass they
// raised, and no other board of theirs lists it.
//
// THE OFFERED SET IS READ FROM `RAISING_OFFICES`, never hand-written here. That
// is the whole point: a third office gaining `/raise` gains the button in the
// same edit, rather than repeating the omission this file was written to fix.
//
// It renders NOTHING for an office with nothing to offer — a "Quick Actions"
// heading over an empty grid reads as a panel that failed to load. The Security
// Head and the Finance HOD see no card, not an empty one.
import React from 'react';
import { Link } from 'react-router-dom';
import GuardIcon, { type GuardGlyph, type GuardTone } from '../guard/GuardIcon';
import { officeRaises } from '../../lib/roleRoutes';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';

type Tile = {
  to: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  title: string;
  note: string;
};

/** The CEO's second queue (client, 2026-08-20; migration 053). That office
 *  alone: `list_whitelist_requests` shows every other one an empty page. */
const WHITELIST_TILE: Tile = {
  to: '/whitelist',
  glyph: 'alert',
  tone: 'red',
  title: 'Whitelist of Vendors',
  note: 'Take a vendor off the blacklist',
};

/** The two screens `RAISING_OFFICE_ROUTES` grants, in the order they are used:
 *  raise one, then find it again. The wording of the first matches the HOD's
 *  own tile verbatim — it opens the same form, and two names for one screen is
 *  how a person comes to believe there are two. */
const RAISING_TILES: Tile[] = [
  {
    to: '/raise',
    glyph: 'truck',
    tone: 'blue',
    title: 'Raise Gate Pass',
    note: 'RGP or NRGP — for any department',
  },
  {
    to: '/my-passes',
    glyph: 'exchange',
    tone: 'purple',
    title: 'My Raised Passes',
    note: 'Everything you have raised',
  },
];

export function quickActionTiles(office: ApprovalRoleKey): Tile[] {
  return [
    ...(officeRaises(office) ? RAISING_TILES : []),
    ...(office === 'ceo' ? [WHITELIST_TILE] : []),
  ];
}

export default function ApproverQuickActions(
  { office }: { office: ApprovalRoleKey },
): React.ReactElement | null {
  const tiles = quickActionTiles(office);
  if (tiles.length === 0) return null;

  return (
    <div className="gb-card gb-quick">
      <h2 className="gb-quick-title">Quick Actions</h2>
      <div className="gb-raise-grid">
        {tiles.map((tile) => (
          <Link key={tile.to} to={tile.to} className="gb-raise-tile">
            <GuardIcon glyph={tile.glyph} tone={tile.tone} shape="square" />
            <span className="gb-raise-title">{tile.title}</span>
            <span className="gb-raise-note">{tile.note}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
