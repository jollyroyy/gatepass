// PENDING APPROVALS, BROKEN IN TWO — the client's 2026-08-20 instruction, and
// the two things about it that could break quietly.
//
//   1. THE TWO SUB-FIGURES SUM TO THE CARD. They are one predicate and its
//      negation over the SAME array the card counted, so no pass can be missed
//      by both or claimed by both. Every case below re-asserts the sum.
//   2. `awaits_approval` IS READ, NEVER RECOMPUTED. It comes off
//      `gatepass.v_gate_passes` (migration 057) and this module has no business
//      deriving it — a pass with no ladder rows is not owed anything, which is
//      exactly what a falsy field means.
import { describe, it, expect } from 'vitest';
import { pendingSplit } from '../../src/lib/pendingSplit';
import { buildOverviewCards } from '../../src/lib/adminOverview';
import { buildHodKpis } from '../../src/lib/hodBoard';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260820-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'h1', raised_by_name: 'Alice',
    visitor_name: 'V', visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Bolts', flagged_at: null, hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const CLIMBING = pass({ id: 'climb', awaits_approval: true });
const AT_GATE = pass({ id: 'gate', awaits_approval: false });
const NO_LADDER = pass({ id: 'old' });                      // pre-workflow: field absent
const EXPIRED = pass({ id: 'dead', is_expired: true });
const CLEARED = pass({ id: 'done', status: 'matched' });

describe('the two desks a waiting pass can be sitting on', () => {
  it('files a pass still climbing the ladder under approval, not under the gate', () => {
    const s = pendingSplit([CLIMBING]);
    expect(s.awaitingApproval.map((p) => p.id)).toEqual(['climb']);
    expect(s.atGate).toEqual([]);
  });

  it('files a pass that has cleared the ladder under the gate', () => {
    const s = pendingSplit([AT_GATE]);
    expect(s.atGate.map((p) => p.id)).toEqual(['gate']);
    expect(s.awaitingApproval).toEqual([]);
  });

  it('treats a MISSING `awaits_approval` as owing nothing — a pass raised before the workflow', () => {
    // Falsy is the safe reading, and it is the true one: a pass with no
    // `pass_approvals` rows is not waiting on anybody but the guard. Every
    // level closed by 058's rollout leaves a pass in exactly this state.
    const s = pendingSplit([NO_LADDER]);
    expect(s.atGate.map((p) => p.id)).toEqual(['old']);
    expect(s.awaitingApproval).toEqual([]);
  });

  it('counts neither an expired pass nor one that has been through the gate', () => {
    // `match_pass` refuses an expired pass forever, so it is dead paperwork and
    // not a queue anybody can shorten — the exclusion `isWaitingAtGate` makes.
    const s = pendingSplit([EXPIRED, CLEARED]);
    expect(s.waiting).toEqual([]);
    expect(s.atGate).toEqual([]);
    expect(s.awaitingApproval).toEqual([]);
  });

  it('SUMS to the figure above it, whatever the mix', () => {
    const s = pendingSplit([CLIMBING, AT_GATE, NO_LADDER, EXPIRED, CLEARED]);
    expect(s.waiting.length).toBe(3);
    expect(s.atGate.length + s.awaitingApproval.length).toBe(s.waiting.length);
  });

});

describe('both boards read the same split', () => {
  const ROWS = [CLIMBING, AT_GATE, NO_LADDER, EXPIRED, CLEARED];

  // REWRITTEN 2026-08-23. The desks have been one card with sub-lines, then a
  // card each, and are now two sub-lines under EACH pass-type card, counting
  // only that type (client: "make the similar type of pending gate approval and
  // pending approval under each NRGP and RGP … remove all those two pending
  // cards completely. Do this across all the views"). Every row in this file is
  // an RGP, so the RGP card carries the whole split and the NRGP card is zeros —
  // which is itself the thing worth pinning: a card that counted the board
  // rather than its own type would read the same on both.
  it("the admin's pass-type cards carry the split, and it sums to what was waiting", () => {
    const cards = buildOverviewCards(ROWS, 30);
    expect(cards.some((c) => c.key === 'pendingGate' || c.key === 'pendingApproval')).toBe(false);
    const rgp = cards.find((c) => c.key === 'rgp');
    const nrgp = cards.find((c) => c.key === 'nrgp');
    expect(rgp?.notes?.map((n) => n.value)).toEqual([2, 1]);
    expect(nrgp?.notes?.map((n) => n.value)).toEqual([0, 0]);
    const total = [rgp, nrgp].flatMap((c) => c?.notes ?? []).reduce((t, n) => t + n.value, 0);
    expect(total).toBe(pendingSplit(ROWS).waiting.length);
  });

  it("the HOD's cards are the same figures, over whatever rows the HOD was served", () => {
    // SCOPE IS NOT THIS MODULE'S. The HOD board is narrowed by RLS to their
    // department and by `.eq('raised_by', …)` to their own passes, both
    // server-side, and this function simply counts what it is handed — which is
    // what makes the same code correct on both boards.
    const cards = buildHodKpis(ROWS, Date.now());
    expect(cards.some((c) => c.key === 'pendingApprovals')).toBe(false);
    expect(cards.find((c) => c.key === 'rgpIssued')?.notes?.map((n) => n.value)).toEqual([2, 1]);
    expect(cards.find((c) => c.key === 'nrgpIssued')?.notes?.map((n) => n.value)).toEqual([0, 0]);
  });

  it('a card and its own drill list can never disagree', () => {
    for (const rows of [[], [CLIMBING], ROWS]) {
      for (const card of buildOverviewCards(rows, 30)) {
        if (card.drill) expect(card.value, card.key).toBe(card.drill.rows.length);
      }
      for (const card of buildHodKpis(rows, Date.now())) {
        if (card.drill) expect(card.value, card.key).toBe(card.drill.rows.length);
      }
    }
  });

  it('the desks under the two type cards still sum to the whole waiting set', () => {
    for (const rows of [[], [CLIMBING], ROWS]) {
      const notes = buildOverviewCards(rows, 30).flatMap((c) => c.notes ?? []);
      expect(notes.reduce((t, n) => t + n.value, 0)).toBe(pendingSplit(rows).waiting.length);
    }
  });
});
