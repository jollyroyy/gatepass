// The three figures on the Whitelist of Vendors screen (client, 2026-08-20:
// "show the number of the requests that have been granted for whitelisting
// under the CEO ... the exact KPI number also, both for approval and
// rejection").
//
// THE BOARD INVARIANT IS WHAT THESE CASES EXIST FOR: a figure is the length of
// the very array rendered under it, so `groupWhitelistRequests` returns the
// ARRAYS and the cards count them. There is no second predicate and no
// aggregate for a figure to drift away from.
import { describe, it, expect } from 'vitest';
import {
  groupWhitelistRequests,
  whitelistKpis,
  WHITELIST_GROUP_ORDER,
} from '../../src/lib/whitelistCounts';
import type { WhitelistRequest } from '../../src/types';

function req(id: string, status: WhitelistRequest['status']): WhitelistRequest {
  return {
    id,
    blacklist_id: status === 'approved' ? null : 'bl-1',
    list_type: 'company',
    list_value: `Vendor ${id}`,
    blocked_reason: 'Repeated late deliveries',
    justification: 'New management, dues cleared.',
    requested_by: 'admin-1',
    requested_by_name: 'Priya Admin',
    requested_at: '2026-08-10T09:00:00Z',
    status,
    decided_by_name: status === 'pending' ? null : 'Rahul CEO',
    decided_at: status === 'pending' ? null : '2026-08-11T09:00:00Z',
    decision_note: null,
  };
}

const ROWS: WhitelistRequest[] = [
  req('a', 'pending'),
  req('b', 'approved'),
  req('c', 'rejected'),
  req('d', 'approved'),
  req('e', 'pending'),
];

describe('groupWhitelistRequests', () => {
  it('splits every request into exactly one of the three groups', () => {
    const g = groupWhitelistRequests(ROWS);
    expect(g.pending.map((r) => r.id)).toEqual(['a', 'e']);
    expect(g.approved.map((r) => r.id)).toEqual(['b', 'd']);
    expect(g.rejected.map((r) => r.id)).toEqual(['c']);
  });

  it('the three groups sum to the rows they were built from', () => {
    const g = groupWhitelistRequests(ROWS);
    expect(g.pending.length + g.approved.length + g.rejected.length).toBe(ROWS.length);
  });

  it('is empty in every group when there is nothing at all', () => {
    const g = groupWhitelistRequests([]);
    expect(g.pending).toEqual([]);
    expect(g.approved).toEqual([]);
    expect(g.rejected).toEqual([]);
  });
});

describe('whitelistKpis', () => {
  it('names the granted figure for the decision, not for the row status', () => {
    const cards = whitelistKpis(groupWhitelistRequests(ROWS));
    const granted = cards.find((c) => c.key === 'approved');
    expect(granted?.title).toBe('Whitelisting Granted');
    expect(granted?.value).toBe(2);
  });

  it('carries one card per group, in reading order, each counting its own array', () => {
    const g = groupWhitelistRequests(ROWS);
    const cards = whitelistKpis(g);
    expect(cards.map((c) => c.key)).toEqual([...WHITELIST_GROUP_ORDER]);
    for (const c of cards) expect(c.value).toBe(g[c.key].length);
  });

  it('says nothing is waiting rather than hiding a zero figure', () => {
    const cards = whitelistKpis(groupWhitelistRequests([]));
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.value).toBe(0);
      expect(c.note.length).toBeGreaterThan(0);
    }
  });
});
