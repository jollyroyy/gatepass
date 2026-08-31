// A DELEGATION MOVES THE RUNG — the COO/CEO case, which is the one that broke.
//
// Client, 2026-08-31: "whenever any delegation of approval is created in either
// ceo/coo, it should appropriately go to the respective approver. I can see
// it's still going to coo for approval when he is on absence and has raised
// delegation for a particular time period, same for ceo."
//
// WHAT WAS ACTUALLY WRONG (migration 072). `gatepass.my_approval_role()` was a
// SCALAR over a two-arm union — the office you hold, and the office you cover
// under a live delegation — and 067 let the COO and the CEO delegate to each
// other, so one person could legitimately be both. Postgres returns the first
// row of a multi-row scalar body without erroring, so the covered office was
// dropped: the CEO read as `ceo`, hit 063's escalation window, and the pass sat
// with a COO who had declared themselves away.
//
// The client half of that fix is here: every predicate that asks "may I sign
// this" takes the whole LIST of offices, so the queue lists the pass and the
// record draws the button — and draws it against the office whose rung it
// actually is. Each case below is false with `'ceo'` alone, which is precisely
// what the screens were passing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  canDecideApproval,
  heldByOffice,
  myStep,
  withEscalation,
} from '../../src/lib/approvalDecision';
import { inMyQueue, type PassApproval } from '../../src/lib/pendingApprovals';
import { buildApprovalNotices } from '../../src/lib/approvalNotices';
import type { GatePassView } from '../../src/types';

afterEach(() => {
  vi.useRealTimers();
});

const RAISED = '2026-08-20T09:00:00.000Z';
const REACHED = '2026-08-21T09:00:00.000Z';
/** One hour after the pass reached level 3 — well inside the 48h window the COO
 *  gets, which is the whole point: the delegate must not have to wait it out. */
const NOW = '2026-08-21T10:00:00.000Z';

const PASS = {
  id: 'p1',
  status: 'pending',
  pass_number: 'RGP-IT-0001',
  created_at: RAISED,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as GatePassView;

const ON_LAST_RUNG: PassApproval[] = [
  { gate_pass_id: 'p1', role_key: 'security_head', level_no: 1, status: 'approved', decided_at: RAISED },
  { gate_pass_id: 'p1', role_key: 'finance_head', level_no: 2, status: 'approved', decided_at: REACHED },
  { gate_pass_id: 'p1', role_key: 'coo', level_no: 3, status: 'pending' },
  { gate_pass_id: 'p1', role_key: 'ceo', level_no: 3, status: 'pending' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any as PassApproval[];

/** The ladder as the record sees it, with 063's window filled in. */
const withWindow = () => withEscalation(ON_LAST_RUNG, RAISED, 48);

describe('the CEO covering an absent COO, on the shared level-3 rung', () => {
  it('may sign at once — the delegated rung carries no escalation window', () => {
    vi.setSystemTime(new Date(NOW));
    expect(canDecideApproval('pending', withWindow(), ['ceo', 'coo'])).toBe(true);
  });

  it('is the exact case that was refused when only their own office was known', () => {
    vi.setSystemTime(new Date(NOW));
    expect(canDecideApproval('pending', withWindow(), 'ceo')).toBe(false);
  });

  it('signs the COO`s row, not their own — the rung being covered', () => {
    vi.setSystemTime(new Date(NOW));
    // The same choice `gatepass.my_acting_role` makes server-side: of my
    // offices on the lowest open rung, the one that is free to act. Pressing
    // against the CEO row would only return the escalation refusal.
    expect(myStep(withWindow(), ['ceo', 'coo'])?.role_key).toBe('coo');
  });

  it('is told nobody is holding it up, because nobody is', () => {
    vi.setSystemTime(new Date(NOW));
    expect(heldByOffice(withWindow(), ['ceo', 'coo'])).toBeNull();
    // With their own office alone the screen named the COO — true then, and the
    // reason the pass looked stuck rather than theirs to sign.
    expect(heldByOffice(withWindow(), 'ceo')).toBe('coo');
  });

  it('carries the pass in the approver queue', () => {
    vi.setSystemTime(new Date(NOW));
    expect(inMyQueue([PASS], ON_LAST_RUNG, ['ceo', 'coo'], 48)).toHaveLength(1);
    expect(inMyQueue([PASS], ON_LAST_RUNG, ['ceo'], 48)).toHaveLength(0);
  });

  it('is asked, by name, for the office it is covering', () => {
    vi.setSystemTime(new Date(NOW));
    const [notice] = buildApprovalNotices([PASS], ON_LAST_RUNG, ['ceo', 'coo']);
    // "as COO" and not "as CEO": being asked to sign for somebody else is the
    // whole message, and the bell is the only push an approver gets in the app.
    expect(notice.message).toContain('as COO');
  });
});

describe('the ordinary approver, who covers nothing', () => {
  it('reads exactly as they did before — one office, passed as a bare key', () => {
    vi.setSystemTime(new Date(NOW));
    expect(canDecideApproval('pending', withWindow(), 'coo')).toBe(true);
    expect(myStep(withWindow(), 'coo')?.role_key).toBe('coo');
    expect(inMyQueue([PASS], ON_LAST_RUNG, 'coo', 48)).toHaveLength(1);
  });

  it('holds nothing when it holds no office, list or scalar', () => {
    expect(canDecideApproval('pending', withWindow(), [])).toBe(false);
    expect(canDecideApproval('pending', withWindow(), null)).toBe(false);
    expect(myStep(withWindow(), [])).toBeNull();
  });

  it('still waits for a rung BELOW it, however many offices it may act for', () => {
    vi.setSystemTime(new Date(NOW));
    const unsigned = ON_LAST_RUNG.map((r) => (r.role_key === 'finance_head'
      ? { ...r, status: 'pending' as const, decided_at: null }
      : r));
    expect(canDecideApproval('pending', withEscalation(unsigned, RAISED, 48), ['ceo', 'coo'])).toBe(false);
    expect(heldByOffice(withEscalation(unsigned, RAISED, 48), ['ceo', 'coo'])).toBe('finance_head');
  });
});
