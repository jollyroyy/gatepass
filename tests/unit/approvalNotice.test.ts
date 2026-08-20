// The approval email decision: who is mailed, and what the mail claims.
//
// The value of these cases is that they are the ONLY place the wording and the
// routing are checked at all — an Edge Function cannot be run by this suite, so
// everything worth getting wrong was pushed out of it and into `approvalNotice.ts`.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildApprovalNotices,
  currentApproval,
  joinUrl,
  noticeCurrency,
  NOTICE_ROLE_TITLES,
  passFacts,
  rejectedApproval,
  type NoticeApproval,
  type NoticePass,
} from '../../src/lib/approvalNotice';
import { APPROVAL_ROLE_TITLES } from '../../src/lib/approvalLadder';
import { formatCurrency } from '../../src/lib/formatCurrency';

const BASE = 'https://gatepass.example.com';

const PASS: NoticePass = {
  id: 'pass-1',
  pass_number: 'RGP-20260819-0001',
  type: 'RGP',
  status: 'pending',
  visitor_name: 'Sharma Electricals',
  purpose: 'Chiller pump servicing',
  department_name: 'Engineering / MEP',
  raised_by_name: 'Anita Rao',
  item_count: 3,
  total_value: 48500,
  expected_return_date: '2026-08-26',
  created_at: '2026-08-19T06:30:00.000Z',
};

function approval(over: Partial<NoticeApproval> = {}): NoticeApproval {
  return {
    role_key: 'security_head',
    level_no: 1,
    status: 'pending',
    approver_id: 'u-sec',
    approver_name: 'Ravi Menon',
    approver_email: 'ravi.menon@example.com',
    decided_at: null,
    reason: null,
    ...over,
  };
}

const LADDER: NoticeApproval[] = [
  approval(),
  approval({ role_key: 'coo', level_no: 2, approver_id: 'u-coo', approver_name: 'Vikram Singh', approver_email: 'vikram@example.com' }),
  approval({ role_key: 'ceo', level_no: 3, approver_id: 'u-ceo', approver_name: 'Meera Nair', approver_email: 'meera@example.com' }),
];

describe('approvalNotice — the file itself', () => {
  // The header's hard rule. Deno resolves a local import only WITH a `.ts`
  // extension and the app's tooling only WITHOUT one, so the single way this
  // file can be loaded by both is to import nothing at all. A future import
  // here would break the Edge Function at runtime and nowhere else.
  it('imports nothing, so Deno and Vite can both load it', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/approvalNotice.ts'), 'utf8');
    const code = src.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, '');
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it('spells the four offices exactly as the ladder and the printed slip do', () => {
    expect(NOTICE_ROLE_TITLES).toEqual(APPROVAL_ROLE_TITLES);
  });

  it('formats rupees the way the rest of the app does — exact, never abbreviated', () => {
    expect(noticeCurrency(48500)).toBe(formatCurrency(48500));
    expect(noticeCurrency(3149)).toBe(formatCurrency(3149));
    expect(noticeCurrency(48500)).not.toMatch(/K/);
  });
});

describe('currentApproval / rejectedApproval', () => {
  it('is the LOWEST pending level, which is the only one the RPC will accept', () => {
    const partly = [
      approval({ status: 'approved' }),
      approval({ role_key: 'coo', level_no: 2, approver_id: 'u-coo' }),
      approval({ role_key: 'ceo', level_no: 3, approver_id: 'u-ceo' }),
    ];
    expect(currentApproval(partly)?.role_key).toBe('coo');
  });

  it('is null once every office has signed', () => {
    expect(currentApproval(LADDER.map((a) => ({ ...a, status: 'approved' as const })))).toBeNull();
  });

  it('finds the office that refused it', () => {
    const refused = [approval({ status: 'rejected', reason: 'Invoice missing' })];
    expect(rejectedApproval(refused)?.reason).toBe('Invoice missing');
  });
});

describe('passFacts', () => {
  it('omits a fact the pass does not carry rather than printing an empty row', () => {
    const bare: NoticePass = {
      ...PASS,
      visitor_name: null,
      purpose: null,
      department_name: null,
      total_value: null,
      expected_return_date: null,
    };
    const labels = passFacts(bare).map((f) => f.label);
    expect(labels).not.toContain('Vendor / Person');
    expect(labels).not.toContain('Total Value');
    expect(labels).not.toContain('Return Before');
    expect(labels).toContain('Gate Pass No.');
  });

  // A pass whose lines carry no price must not claim a value of zero — the same
  // rule the record's item table follows.
  it('prints no Total Value when nothing on the pass is priced', () => {
    const free = passFacts({ ...PASS, total_value: 0 });
    expect(free.find((f) => f.label === 'Total Value')).toBeUndefined();
  });
});

describe('buildApprovalNotices — a freshly raised pass', () => {
  const msgs = buildApprovalNotices(PASS, LADDER, BASE);

  it('asks the FIRST office only, never all four', () => {
    expect(msgs).toHaveLength(1);
    expect(msgs[0].to).toBe('ravi.menon@example.com');
    expect(msgs[0].kind).toBe('awaiting_you');
    expect(msgs[0].subject).toContain('Security Head');
  });

  // The client's instruction, 2026-08-19: the HOD raised it, so their approval
  // is already given and no letter is owed to them at any step.
  it('writes NOTHING to the raising HOD', () => {
    expect(msgs.some((m) => m.to === 'anita.rao@example.com')).toBe(false);
  });

  // REWRITTEN 2026-08-20. It used to hold that the letter carried ONE link and
  // that it went to the queue "not to the record". The client asked for the
  // decision itself to be in the inbox — "make sure … it gives this Approve or
  // Reject button in the email approval emails for easy visibility of all the
  // approvers. Once it is clicked on any of those links, it should directly
  // open up the portal" — so the two buttons open the PASS, and the queue is
  // kept as a third, plain link for a reader who wants their whole list.
  it('carries an Approve and a Reject button, both opening this pass', () => {
    for (const body of [msgs[0].html, msgs[0].text]) {
      expect(body).toContain(`${BASE}/pass/pass-1?decide=approve`);
      expect(body).toContain(`${BASE}/pass/pass-1?decide=reject`);
    }
    expect(msgs[0].html).toContain('Approve');
    expect(msgs[0].html).toContain('Reject');
  });

  it('still offers the whole queue', () => {
    expect(msgs[0].html).toContain(`${BASE}/approvals`);
    expect(msgs[0].text).toContain(`${BASE}/approvals`);
  });

  // A LINK IN AN EMAIL IS A GET, AND GETS ARE PREFETCHED — Outlook Safe Links
  // and every other scanner opens a URL before the reader ever does. So the
  // link must not BE the decision: it opens the record, signed in, with the
  // decision offered on screen. Nothing in the URL records anything.
  it('carries no token, and nothing that could decide a pass by being fetched', () => {
    const body = `${msgs[0].html}
${msgs[0].text}`;
    expect(body).not.toMatch(/token=/i);
    expect(body).not.toMatch(/approve_pass_level|rest\/v1|rpc\//i);
  });

  it('carries the facts an approver needs to decide without opening the app', () => {
    const body = msgs[0].text;
    expect(body).toContain('RGP-20260819-0001');
    expect(body).toContain('Sharma Electricals');
    expect(body).toContain('Engineering / MEP');
    expect(body).toContain(noticeCurrency(48500));
  });
});

// ═══ THE LETTER NAMES THE PERSON IT IS ASKING ═══
//
// Client, 2026-08-19: "address the person to whom you are sending it for
// approval — since we are using the same email I want to know whether the
// approval flow is working. Mention the name of the person so I know once he
// approves it goes to the next one and the next email is triggered."
//
// Every letter on this deployment is redirected to ONE inbox by MAIL_OVERRIDE_TO
// (an unverified Resend account may write nowhere else), and the mailer DROPS
// the display name when it redirects — so the recipient's name has to be inside
// the subject and the body or it does not survive the redirect at all.
describe('buildApprovalNotices — naming the office holder', () => {
  it('names the person in the subject, beside their office', () => {
    const [m] = buildApprovalNotices(PASS, LADDER, BASE);
    expect(m.subject).toContain('Ravi Menon');
    expect(m.subject).toContain('Security Head');
    expect(m.subject).toContain('RGP-20260819-0001');
  });

  it('greets them by name in both the text and the HTML body', () => {
    const [m] = buildApprovalNotices(PASS, LADDER, BASE);
    expect(m.text).toContain('Hello Ravi Menon');
    expect(m.html).toContain('Hello Ravi Menon');
    expect(m.toName).toBe('Ravi Menon');
  });

  it('states which rung of which ladder this is, so the chain is followable', () => {
    const [m] = buildApprovalNotices(PASS, LADDER, BASE);
    expect(m.subject).toContain('Level 1 of 3');
    expect(m.text).toContain('Level 1 of 3');
  });

  it('names the offices that have ALREADY signed, and who signed them', () => {
    const moved = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, status: 'approved' as const, decided_at: '2026-08-19T08:00:00.000Z' } : a
    );
    const [m] = buildApprovalNotices(PASS, moved, BASE);
    // It is now the COO's turn, and the letter says who cleared it before them.
    expect(m.subject).toContain('Vikram Singh');
    expect(m.text).toContain('Hello Vikram Singh');
    expect(m.text).toContain('Security Head (Ravi Menon)');
    expect(m.html).toContain('Security Head (Ravi Menon)');
  });

  it('falls back to the office alone when the holder has no name on file', () => {
    const nameless = LADDER.map((a) => (a.level_no === 1 ? { ...a, approver_name: null } : a));
    const [m] = buildApprovalNotices(PASS, nameless, BASE);
    expect(m.subject).toContain('Security Head');
    expect(m.subject).not.toContain('null');
    expect(m.text).not.toContain('Hello ,');
    expect(m.text).not.toContain('null');
  });
});

describe('buildApprovalNotices — the ladder moving one rung at a time', () => {
  it('tells the NEXT office it is their turn, and only that office', () => {
    const moved = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, status: 'approved' as const, decided_at: '2026-08-19T08:00:00.000Z' } : a
    );
    const msgs = buildApprovalNotices(PASS, moved, BASE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].to).toBe('vikram@example.com');
    expect(msgs[0].subject).toContain('COO');
    // The office that just signed is not written to again.
    expect(msgs.some((m) => m.to === 'ravi.menon@example.com')).toBe(false);
  });

  it('asks nobody once the last office has signed', () => {
    const done = LADDER.map((a) => ({ ...a, status: 'approved' as const }));
    expect(buildApprovalNotices(PASS, done, BASE)).toEqual([]);
  });
});

describe('buildApprovalNotices — rejection', () => {
  const refused: NoticeApproval[] = [
    { ...LADDER[0], status: 'approved' },
    {
      ...LADDER[1],
      status: 'rejected',
      decided_at: '2026-08-19T09:00:00.000Z',
      reason: 'Vendor is not on the approved list',
    },
    LADDER[2],
  ];
  const msgs = buildApprovalNotices({ ...PASS, status: 'cancelled' }, refused, BASE);

  // A rejection is terminal (046) and the HOD hears about it through the bell,
  // not by mail. There is therefore no letter at all.
  it('sends no mail once an office has refused the pass', () => {
    expect(msgs).toEqual([]);
  });

  it('does not ask a still-pending lower office to approve a closed pass', () => {
    expect(msgs.some((m) => m.to === 'meera@example.com')).toBe(false);
  });
});

describe('buildApprovalNotices — the edges', () => {
  it('sends nothing when no office is designated and the pass skips the ladder', () => {
    // 046 snapshots no rows when `approval_roles` is empty, so the pass is at
    // the gate already and there is nobody to ask.
    expect(buildApprovalNotices(PASS, [], BASE)).toEqual([]);
  });

  it('drops the message rather than sending to an office with no address', () => {
    const noAddress = LADDER.map((a) => (a.level_no === 1 ? { ...a, approver_email: null } : a));
    expect(buildApprovalNotices(PASS, noAddress, BASE)).toEqual([]);
  });

  it('escapes a vendor name rather than letting it write HTML into the mail', () => {
    const msgs = buildApprovalNotices(
      { ...PASS, visitor_name: '<img src=x onerror=alert(1)>' },
      LADDER,
      BASE
    );
    expect(msgs[0].html).not.toContain('<img src=x');
    expect(msgs[0].html).toContain('&lt;img src=x');
  });

  it('never puts "Invalid Date" in a subject or body', () => {
    const msgs = buildApprovalNotices(
      { ...PASS, created_at: 'not-a-date', expected_return_date: 'nope' },
      LADDER,
      BASE
    );
    for (const m of msgs) {
      expect(m.subject).not.toContain('Invalid Date');
      expect(m.text).not.toContain('Invalid Date');
      expect(m.html).not.toContain('Invalid Date');
    }
  });
});

describe('joinUrl', () => {
  it('does not double the slash when the configured base carries one', () => {
    expect(joinUrl('https://x.example.com/', '/approvals')).toBe('https://x.example.com/approvals');
    expect(joinUrl('https://x.example.com', 'approvals')).toBe('https://x.example.com/approvals');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 054 — the office's STANDING DEPUTY is asked too. Still one office being asked
// one question; a deputy nobody writes to is cover that only helps the person
// who was already watching the screen.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalNotices — the standing deputy (054)', () => {
  it('writes to the deputy as well as the holder, with the same subject', () => {
    const withDeputy = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya Nair', deputy_email: 'priya@example.com' } : a,
    );
    const out = buildApprovalNotices(PASS, withDeputy, BASE);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.to)).toEqual(['ravi.menon@example.com', 'priya@example.com']);
    // One question, so one subject — the two letters are the same ask.
    expect(out[0].subject).toBe(out[1].subject);
    expect(out.every((m) => m.kind === 'awaiting_you')).toBe(true);
  });

  it('tells the deputy WHY they are being asked, rather than that they hold the office', () => {
    // "You hold the Security Head office" is false for a deputy, and a letter
    // that misstates its own reason teaches the reader to distrust the rest.
    const withDeputy = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya Nair', deputy_email: 'priya@example.com' } : a,
    );
    const deputyMsg = buildApprovalNotices(PASS, withDeputy, BASE)[1];
    expect(deputyMsg.text).toMatch(/Hello Priya Nair,/);
    expect(deputyMsg.text).toMatch(/standing deputy for the Security Head office/i);
    expect(deputyMsg.text).not.toMatch(/you hold the Security Head office/i);
  });

  it('sends ONE letter when the holder and deputy share a mailbox', () => {
    // The database refuses to seat one person twice, but it cannot stop two
    // people sharing an inbox. Two identical letters there read as a bug.
    const shared = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya Nair', deputy_email: 'RAVI.MENON@example.com ' } : a,
    );
    expect(buildApprovalNotices(PASS, shared, BASE)).toHaveLength(1);
  });

  it('still writes to the holder when the office has no deputy at all', () => {
    // The ordinary case, and the one every existing pass is in.
    expect(buildApprovalNotices(PASS, LADDER, BASE)).toHaveLength(1);
  });

  it('never writes to a deputy of an office whose turn it is NOT', () => {
    // The ladder is sequential. A deputy for the CEO must not hear about a pass
    // sitting at level 1 any more than the CEO does.
    const ceoDeputy = LADDER.map((a) =>
      a.level_no === 3 ? { ...a, deputy_name: 'Late Arrival', deputy_email: 'late@example.com' } : a,
    );
    const out = buildApprovalNotices(PASS, ceoDeputy, BASE);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('ravi.menon@example.com');
  });
});
