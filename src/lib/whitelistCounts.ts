// THE THREE FIGURES ON "Whitelist of Vendors" (client, 2026-08-20: "show the
// number of the requests that have been granted for whitelisting under the
// CEO. Show the exact KPI number also, both for approval and rejection").
//
// THIS MODULE COUNTS NOTHING BY ITSELF — it SPLITS the one array the screen
// already loaded, and each card's figure is the length of the array rendered
// directly under it. That is the board invariant this app has carried since
// its first KPI: no aggregate, no `count: 'exact'`, and no second predicate
// for a figure to drift away from the list it stands over.
//
// The three statuses are DISJOINT AND TOTAL by construction — `status` is a
// three-value union and each row is filed by it — so the figures sum to the
// requests, with nothing counted twice and nothing falling between them.
import type { WhitelistRequest, WhitelistRequestStatus } from '../types';
import type { GuardGlyph, GuardTone } from '../components/guard/GuardIcon';

/** The group keys ARE the request statuses — a fourth status would be a type
 *  error here rather than a silently uncounted row. */
export type WhitelistGroupKey = WhitelistRequestStatus;

/** Reading order: what still needs a decision first, then what was decided. */
export const WHITELIST_GROUP_ORDER = ['pending', 'approved', 'rejected'] as const;

export type WhitelistGroups = Record<WhitelistGroupKey, WhitelistRequest[]>;

export function groupWhitelistRequests(rows: WhitelistRequest[]): WhitelistGroups {
  const groups: WhitelistGroups = { pending: [], approved: [], rejected: [] };
  for (const r of rows) groups[r.status].push(r);
  return groups;
}

export interface WhitelistKpi {
  key: WhitelistGroupKey;
  /** The card's name. "Granted" and "Rejected" name the CEO's DECISION, not
   *  the row's stored status, because that decision is what the client asked
   *  to see counted. */
  title: string;
  value: number;
  note: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  /** The class that repaints `.gpo-total`, which is red for the overdue board
   *  it was written for — so only the first two are restated. */
  skin: string;
}

interface CardDef {
  key: WhitelistGroupKey;
  title: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  skin: string;
  note: string;
  /** A zero card stays on screen saying zero rather than vanishing — a figure
   *  that disappears when it reaches nothing is a figure nobody can trust at a
   *  glance. It needs its own sentence, because "tap to see them" is a lie
   *  under a zero. */
  empty: string;
}

const CARDS: Record<WhitelistGroupKey, CardDef> = {
  pending: {
    key: 'pending',
    title: 'Awaiting CEO Decision',
    glyph: 'clock',
    tone: 'purple',
    skin: 'gpo-total--purple',
    note: 'Vendors waiting to be taken off the blacklist',
    empty: 'Nothing is waiting on the CEO',
  },
  approved: {
    key: 'approved',
    title: 'Whitelisting Granted',
    glyph: 'check',
    tone: 'green',
    skin: 'gpo-total--green',
    note: 'Requests the CEO approved — the block was lifted',
    empty: 'The CEO has granted no whitelisting yet',
  },
  rejected: {
    key: 'rejected',
    title: 'Whitelisting Rejected',
    glyph: 'cross',
    tone: 'red',
    skin: '',
    note: 'Requests the CEO turned down — the vendor stays blocked',
    empty: 'The CEO has rejected no request',
  },
};

export function whitelistKpis(groups: WhitelistGroups): WhitelistKpi[] {
  return WHITELIST_GROUP_ORDER.map((key) => {
    const def = CARDS[key];
    const value = groups[key].length;
    return {
      key,
      title: def.title,
      value,
      note: value === 0 ? def.empty : def.note,
      glyph: def.glyph,
      tone: def.tone,
      skin: def.skin,
    };
  });
}
