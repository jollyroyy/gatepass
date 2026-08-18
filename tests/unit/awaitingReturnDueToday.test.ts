// Awaiting Return means DUE BACK TODAY; Overdue means past its date, all time.
//
// Client instruction, 2026-08-18: "awaiting return should only reflect the
// returns that were supposed to come today. If it is not coming by today, which
// was supposed to come by today, it should fall into the overdue category. Do
// this for every day so basically overdue will be for all time."
//
// So the two guard drills are one timeline cut in two at today's date, not a
// set and its subset:
//
//   Awaiting Return — expected_return_date IS today.
//   Overdue         — expected_return_date is BEFORE today, any day, any age.
//
// Before this, Awaiting Return was every open obligation regardless of date, so
// an overdue pass was counted twice and a pass due next month sat under a card
// implying somebody should be expecting it at the barrier.
//
// BOTH READ `due_state`, WHICH THE VIEW COMPUTES IN `site_tz()`. Never compare
// `expected_return_date` to a browser clock here — a guard's screen would
// disagree with the database for every pass after 18:30 IST.
import { describe, it, expect } from 'vitest';
import { DRILL_DEFS } from '../../src/lib/guardDrills';
import type { GatePassView, DueState, ReturnStatus } from '../../src/types';

function open(due_state: DueState, return_status: ReturnStatus = 'awaiting_return'): GatePassView {
  return { id: 'x', status: 'matched', type: 'RGP', direction: 'out', return_status, due_state,
    is_overdue: due_state === 'overdue' && return_status === 'awaiting_return' } as unknown as GatePassView;
}

const awaiting = DRILL_DEFS.awaiting;
const overdue = DRILL_DEFS.overdue;

describe('Awaiting Return — only what is expected back today', () => {
  it('matches a pass due back today', () => {
    expect(awaiting.match(open('due_today'))).toBe(true);
  });

  it('does not match a pass due tomorrow or later', () => {
    expect(awaiting.match(open('due_soon'))).toBe(false);
    expect(awaiting.match(open('ok'))).toBe(false);
  });

  it('does not match an overdue pass — it belongs to Overdue and to nothing else', () => {
    expect(awaiting.match(open('overdue'))).toBe(false);
  });

  it('counts a part-returned pass whose remaining lines are due today', () => {
    expect(awaiting.match(open('due_today', 'partially_returned'))).toBe(true);
  });

  it('ignores a closed pass that happens to carry today as its date', () => {
    expect(awaiting.match(open('due_today', 'returned'))).toBe(false);
  });

  it('is no longer an all-time card', () => {
    expect(awaiting.allTime).toBe(false);
  });
});

describe('Overdue — every day it was missed, for all time', () => {
  it('matches a pass whose expected return date has passed', () => {
    expect(overdue.match(open('overdue'))).toBe(true);
  });

  it('matches a PART-returned pass past its date — `is_overdue` alone misses it', () => {
    // The view's `is_overdue` is pinned to `awaiting_return`, so a pass with one
    // line back and two still outside read as not-overdue for months. `due_state`
    // grades both open states, which is why the drill reads that instead.
    const p = open('overdue', 'partially_returned');
    expect(p.is_overdue).toBe(false);
    expect(overdue.match(p)).toBe(true);
  });

  it('does not match anything still within its date', () => {
    expect(overdue.match(open('due_today'))).toBe(false);
    expect(overdue.match(open('due_soon'))).toBe(false);
    expect(overdue.match(open('ok'))).toBe(false);
  });

  it('stays all-time', () => {
    expect(overdue.allTime).toBe(true);
  });
});

describe('the two buckets are disjoint', () => {
  it('no open pass is counted by both', () => {
    for (const s of ['not_applicable', 'ok', 'due_soon', 'due_today', 'overdue'] as DueState[]) {
      for (const r of ['awaiting_return', 'partially_returned'] as ReturnStatus[]) {
        const p = open(s, r);
        expect(awaiting.match(p) && overdue.match(p)).toBe(false);
      }
    }
  });
});
