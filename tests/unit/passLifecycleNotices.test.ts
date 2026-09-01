// THE WHOLE LIFE OF A PASS, AS LETTERS (client, 2026-09-01: "I want to send it
// to multiple email IDs about the lifecycle notification or status changes of
// that same gate pass").
//
// These cases are the only place the new routing is checked at all — an Edge
// Function cannot be run by this suite, so everything worth getting wrong was
// pushed out of it and into `src/lib/notice/*`.
//
// THE RULE UNDER TEST, in the client's own words: "put the one who raised the
// pass in all the communication, but for the approval emails the approver
// should be only notified about their own approval. Once it is approved by
// others and once it is completed, similarly do this for everybody."
import { describe, expect, it } from 'vitest';
import {
  buildNotices,
  ccOf,
  type NoticeApproval,
  type NoticePass,
} from '../../src/lib/approvalNotice';

const BASE = 'https://gatepass.example.com';

const PASS: NoticePass = {
  id: 'pass-1',
  pass_number: 'RGP-IT-0007',
  type: 'RGP',
  status: 'pending',
  visitor_name: 'Sharma Electricals',
  purpose: 'Chiller pump servicing',
  department_name: 'Engineering / MEP',
  raised_by_name: 'Anita Rao',
  raised_by_email: 'anita@example.com',
  item_count: 3,
  total_value: 48500,
  expected_return_date: '2026-09-10',
  created_at: '2026-09-01T06:30:00.000Z',
};

function approval(over: Partial<NoticeApproval> = {}): NoticeApproval {
  return {
    role_key: 'security_head',
    level_no: 1,
    status: 'pending',
    approver_id: 'u-sec',
    approver_name: 'Ravi Menon',
    approver_email: 'ravi@example.com',
    decided_at: null,
    reason: null,
    ...over,
  };
}

const COO = approval({
  role_key: 'coo',
  level_no: 3,
  approver_id: 'u-coo',
  approver_name: 'Vikram Singh',
  approver_email: 'vikram@example.com',
});
const CEO = approval({
  role_key: 'ceo',
  level_no: 3,
  approver_id: 'u-ceo',
  approver_name: 'Meera Nair',
  approver_email: 'meera@example.com',
});
const LADDER: NoticeApproval[] = [approval(), COO, CEO];

const signed = (a: NoticeApproval) => ({
  ...a,
  status: 'approved' as const,
  decided_at: '2026-09-01T08:00:00.000Z',
});
const ccAddresses = (m: { cc?: { email: string }[] }) => (m.cc ?? []).map((c) => c.email);

// ─────────────────────────────────────────────────────────────────────────────
describe('a pass that has just been raised', () => {
  const msgs = buildNotices(PASS, LADDER, BASE);

  // Client, 2026-09-01: "I, as an HOD, have created one gate pass. I want to be
  // notified that I have created the gate pass. Now it is awaiting the approval
  // from the first-level approver."
  it('sends TWO letters: the requester’s receipt and the first office’s request', () => {
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.kind)).toEqual(['raised', 'awaiting_you']);
    expect(msgs[0].to).toBe('anita@example.com');
    expect(msgs[1].to).toBe('ravi@example.com');
  });

  it('tells the requester the pass NUMBER and which office has it', () => {
    // The two facts they cannot know until the server has allocated and routed
    // them — which is the whole reason this letter is worth sending to somebody
    // who just pressed the button themselves.
    expect(msgs[0].subject).toContain('RGP-IT-0007');
    expect(msgs[0].subject).toContain('Security Head');
    expect(msgs[0].text).toContain('Ravi Menon');
  });

  it('does not copy the approver on the receipt, having just written to them', () => {
    expect(ccAddresses(msgs[0])).toEqual([]);
  });

  // "the approver should be only notified about their own approval"
  it('asks the first office alone, copying the requester and no other office', () => {
    expect(ccAddresses(msgs[1])).toEqual(['anita@example.com']);
    expect(ccAddresses(msgs[1])).not.toContain('vikram@example.com');
    expect(ccAddresses(msgs[1])).not.toContain('meera@example.com');
  });

  it('still sends the receipt when no office is designated, saying so honestly', () => {
    const [only, ...rest] = buildNotices(PASS, [], BASE);
    expect(rest).toEqual([]);
    expect(only.kind).toBe('raised');
    expect(only.text).toMatch(/straight to the security gate/i);
    expect(only.text).not.toMatch(/waiting for approval from/i);
  });

  it('sends nothing at all when VMS holds no address for the requester', () => {
    const anon = { ...PASS, raised_by_email: null };
    const out = buildNotices(anon, LADDER, BASE);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('awaiting_you');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('an approval office rejects it', () => {
  const refused = [
    { ...approval(), status: 'rejected' as const, reason: 'Serial numbers do not match the invoice.', decided_at: '2026-09-01T09:00:00.000Z' },
    COO,
    CEO,
  ];
  const [m] = buildNotices({ ...PASS, status: 'cancelled' }, refused, BASE);

  it('writes to the requester and copies every office on the ladder', () => {
    expect(m.kind).toBe('rejected');
    expect(m.to).toBe('anita@example.com');
    expect(ccAddresses(m)).toEqual(['ravi@example.com', 'vikram@example.com', 'meera@example.com']);
  });

  it('quotes the written reason verbatim rather than summarising it', () => {
    expect(m.text).toContain('Serial numbers do not match the invoice.');
    expect(m.html).toContain('Serial numbers do not match the invoice.');
  });

  it('says plainly that it cannot be reopened, and a new pass is the only route', () => {
    expect(m.text).toMatch(/cannot be reopened/i);
    expect(m.text).toMatch(/raise a new gate pass/i);
  });

  it('asks no still-pending office to approve a closed pass', () => {
    expect(buildNotices({ ...PASS, status: 'cancelled' }, refused, BASE)).toHaveLength(1);
    expect(m.kind).not.toBe('awaiting_you');
  });

  it('still tells the offices when VMS holds no address for the requester', () => {
    const [only] = buildNotices({ ...PASS, status: 'cancelled', raised_by_email: null }, refused, BASE);
    expect(only.kind).toBe('rejected');
    expect(only.to).toBe('ravi@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ THE BUG THIS FILE WAS WRITTEN TO CATCH. 063 puts the COO and the CEO on ONE
// rung that takes ONE signature and writes the OTHER row off as `not_required`
// the moment either signs — so on the majority of real passes the ladder ends
// `approved, not_required`, and the old `every(status === 'approved')` test
// found a rung outstanding that nobody was waiting on. The receipt never sent.
describe('the last rung is signed', () => {
  const done = [signed(approval()), signed(COO), { ...CEO, status: 'not_required' as const, decided_at: '2026-09-01T10:00:00.000Z', reason: 'Covered by the COO.' }];
  const [m] = buildNotices(PASS, done, BASE);

  it('sends the receipt even though the CEO’s rung closed as not_required', () => {
    expect(m).toBeDefined();
    expect(m.kind).toBe('fully_approved');
    expect(m.to).toBe('anita@example.com');
  });

  it('copies the offices that actually SIGNED, and not the one that did not', () => {
    expect(ccAddresses(m)).toEqual(['ravi@example.com', 'vikram@example.com']);
    expect(ccAddresses(m)).not.toContain('meera@example.com');
  });

  it('never claims the pass has left — the gate has still to clear it', () => {
    expect(m.text).toMatch(/waiting for gate review|verify the material/i);
  });

  it('stays silent on a ladder nobody signed at all', () => {
    const none = LADDER.map((a) => ({ ...a, status: 'not_required' as const, decided_at: '2026-09-01T10:00:00.000Z', reason: 'x' }));
    expect(buildNotices(PASS, none, BASE).every((x) => x.kind !== 'fully_approved')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the gate has the last word', () => {
  const done = [signed(approval()), signed(COO), signed(CEO)];
  const GATE = { verified_by_name: 'Suresh Kumar', verified_at: '2026-09-02T11:00:00.000Z' };

  it('tells everyone the material was cleared out, naming the guard and the day', () => {
    const [m] = buildNotices({ ...PASS, status: 'matched', ...GATE }, done, BASE);
    expect(m.kind).toBe('gate_cleared');
    expect(m.to).toBe('anita@example.com');
    expect(ccAddresses(m)).toEqual(['ravi@example.com', 'vikram@example.com', 'meera@example.com']);
    expect(m.text).toContain('Suresh Kumar');
    // `noticeDate`'s own format, not a hand-written one: en-IN's short month
    // for September is "Sept", and pinning the literal here is how a date
    // format change becomes a red test rather than a wrong letter.
    expect(m.text).toContain('2 Sept 2026');
  });

  // Two axes, only one moves after the gate: `status` freezes at `matched` and
  // the return leg is `return_status`. A cleared RGP is NOT finished.
  it('says an RGP is still expected back, and an NRGP is not', () => {
    const [rgp] = buildNotices({ ...PASS, status: 'matched', ...GATE }, done, BASE);
    expect(rgp.text).toMatch(/still expected back/i);
    const [nrgp] = buildNotices({ ...PASS, type: 'NRGP', status: 'matched', ...GATE }, done, BASE);
    expect(nrgp.text).toMatch(/nothing further is expected/i);
    expect(nrgp.text).not.toMatch(/still expected back/i);
  });

  // It must never claim a return that has NOT happened — a cleared pass with
  // nothing back is not "partially returned", which is the exact defect the
  // status-badge work was fixing at the same time. Note what is deliberately
  // NOT banned: "closes only when every line is fully returned" is a future
  // condition, and stating it is the point of the letter.
  it('never claims anything has come back yet', () => {
    const [m] = buildNotices({ ...PASS, status: 'matched', ...GATE }, done, BASE);
    expect(m.text).not.toMatch(/partially returned/i);
    expect(m.text).not.toMatch(/has been returned|was returned|have been returned/i);
  });

  it('quotes the guard’s reason and states that a flag is final', () => {
    const [m] = buildNotices(
      { ...PASS, status: 'flagged', flag_reason: 'Two cartons short of the declared count.', ...GATE },
      done,
      BASE,
    );
    expect(m.kind).toBe('gate_flagged');
    expect(m.subject).toMatch(/closed/i);
    expect(m.text).toContain('Two cartons short of the declared count.');
    expect(m.text).toMatch(/closed permanently/i);
    expect(m.text).toMatch(/raise a new gate pass/i);
  });

  it('carries no Approve or Reject link — there is nothing left to decide', () => {
    const [m] = buildNotices({ ...PASS, status: 'matched', ...GATE }, done, BASE);
    expect(m.html).not.toMatch(/decide=approve|decide=reject/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ccOf — one person, one copy', () => {
  // One person can hold an office AND cover the other half of level 3 (072),
  // and a vacant office falls back to the holder snapshotted at raise, so two
  // rungs routinely resolve to one address.
  it('drops a copy that is already the addressee, whatever the casing', () => {
    expect(ccOf('Anita@Example.com', [{ email: 'anita@example.com', name: 'Anita Rao' }])).toEqual([]);
  });

  it('drops a repeated address, keeping the first name it was given', () => {
    const out = ccOf('gate@example.com', [
      { email: 'vikram@example.com', name: 'Vikram Singh' },
      { email: 'VIKRAM@example.com', name: 'The COO' },
    ]);
    expect(out).toEqual([{ email: 'vikram@example.com', name: 'Vikram Singh' }]);
  });

  it('skips an office with no address rather than inventing one', () => {
    expect(ccOf('gate@example.com', [null, { email: 'x@example.com', name: null }])).toEqual([
      { email: 'x@example.com', name: null },
    ]);
  });

  it('does not copy the requester twice when they are also an approver', () => {
    const selfRaised = { ...PASS, raised_by_email: 'vikram@example.com', raised_by_name: 'Vikram Singh' };
    const done = [signed(approval()), signed(COO), signed(CEO)];
    const [m] = buildNotices({ ...selfRaised, status: 'matched' }, done, BASE);
    expect(ccAddresses(m).filter((e) => e === 'vikram@example.com')).toHaveLength(0);
    expect(m.to).toBe('vikram@example.com');
  });
});
