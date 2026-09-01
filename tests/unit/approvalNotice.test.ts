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
// RUNG_TITLES, not APPROVAL_ROLE_TITLES. The four offices are the SEATS; a
// pass's ladder can also carry `department_hod` (077), and a letter is written
// about a pass's rungs rather than about the seating plan.
import { RUNG_TITLES } from '../../src/lib/approvalLadder';
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

describe('approvalNotice — the modules themselves', () => {
  // ═══ THE RULE THAT REPLACED "IMPORT NOTHING" (2026-09-01) ═══
  //
  // These modules are loaded by TWO runtimes: Vite/Vitest here, and Deno in
  // `supabase/functions/notify-approval`. Deno resolves a local import only
  // WITH a `.ts` suffix, so every relative import in this folder must carry
  // one — `allowImportingTsExtensions` in `tsconfig.app.json` is what lets the
  // app's own tooling accept the same form.
  //
  // Until this date the rule was harder — `approvalNotice.ts` could import
  // NOTHING AT ALL — which worked, and pinned every letter this system sends
  // into one 567-line file, against the repo's 300-line cap.
  //
  // A miss here breaks the Edge Function AT RUNTIME and nowhere else: the app
  // builds, this suite passes, and the mail silently stops.
  const NOTICE_FILES = [
    'src/lib/approvalNotice.ts',
    'src/lib/notice/noticeTypes.ts',
    'src/lib/notice/noticeFormat.ts',
    'src/lib/notice/noticeLadder.ts',
    'src/lib/notice/noticeApproval.ts',
    'src/lib/notice/noticeLifecycle.ts',
    'src/lib/notice/noticeGate.ts',
    'src/lib/notice/noticeEmergency.ts',
    'src/lib/notice/noticeDispatch.ts',
  ];

  it.each(NOTICE_FILES)('%s imports only siblings, always with a .ts suffix', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    const code = src.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, '');
    expect(code).not.toMatch(/\brequire\s*\(/);
    // ANCHORED, because these files are full of English prose in string
    // literals and a bare /from\s+['"]/ matches "…is needed from ' + '…". A
    // module specifier only ever follows the start of a line (a side-effect
    // import) or the `}` that closes a named list.
    const specifiers = [
      ...code.matchAll(/(?:^|})\s*from\s+['"]([^'"]+)['"]/gm),
      ...code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThanOrEqual(file.endsWith('noticeTypes.ts') ? 0 : 1);
    for (const spec of specifiers) {
      // A bare specifier is a PACKAGE, which Deno would have to resolve from a
      // registry these files must never depend on.
      expect(spec.startsWith('.')).toBe(true);
      expect(spec.endsWith('.ts')).toBe(true);
    }
  });

  it('spells the four offices exactly as the ladder and the printed slip do', () => {
    expect(NOTICE_ROLE_TITLES).toEqual(RUNG_TITLES);
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
// 068 — one office, one letter. 054's standing deputy was a second address on
// every rung; it is gone, and the only stand-in left is a delegation, which the
// database resolves into `approver_id` itself.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalNotices — one address per office (068)', () => {
  it('writes to the office holder alone', () => {
    const out = buildApprovalNotices(PASS, LADDER, BASE);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('ravi.menon@example.com');
    expect(out[0].kind).toBe('awaiting_you');
  });

  it('ignores a stray deputy address left on a row by an older payload', () => {
    // The RPC no longer sends these keys. If a cached Edge Function ever did,
    // a letter must not go to somebody who cannot sign the pass.
    const stray = LADDER.map((a) =>
      a.level_no === 1 ? { ...a, deputy_name: 'Priya Nair', deputy_email: 'priya@example.com' } : a,
    );
    const out = buildApprovalNotices(PASS, stray, BASE);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('ravi.menon@example.com');
  });

  it('never writes to an office whose turn it is NOT', () => {
    // The ladder is sequential. The CEO must not hear about a pass sitting at
    // level 1.
    const out = buildApprovalNotices(PASS, LADDER, BASE);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('ravi.menon@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RECEIPT THE RAISING HOD GETS (client, 2026-08-22: "whenever any pass
// gets fully approved by all the approvers, the hod should receive an email
// that your pass has been approved fully. Now it is waiting … at the gate").
//
// It is the exception to the 2026-08-19 rule that the HOD is never written to,
// and the cases below hold BOTH halves: this letter goes out when the last rung
// is signed, and nothing else about the HOD's silence changed.
// ─────────────────────────────────────────────────────────────────────────────
describe('buildApprovalNotices — the fully approved receipt (2026-08-22)', () => {
  const SIGNED = LADDER.map((a) => ({ ...a, status: 'approved' as const, decided_at: '2026-08-20T10:00:00.000Z' }));
  const HOD = { ...PASS, raised_by_email: 'anita@example.com' };

  it('writes to the raising HOD, and to NOBODY else, once every rung is approved', () => {
    const msgs = buildApprovalNotices(HOD, SIGNED, BASE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].to).toBe('anita@example.com');
    expect(msgs[0].kind).toBe('fully_approved');
    // No office is asked for anything — there is nothing left to ask.
    for (const a of SIGNED) {
      expect(msgs[0].to).not.toBe(a.approver_email);
    }
  });

  // "Approved" alone is how an HOD comes to believe their lorry has left. The
  // pass is VISIBLE to the gate now; the guard has still to verify and clear it.
  it('says what actually happens next, not just that it is approved', () => {
    const [m] = buildApprovalNotices(HOD, SIGNED, BASE);
    expect(m.subject).toMatch(/fully approved/i);
    expect(m.subject).toMatch(/gate review/i);
    expect(m.text).toMatch(/security gate/i);
  });

  // The HOD has nothing to decide, and a letter offering Approve to somebody
  // the RPC would refuse teaches them to distrust the buttons that do work.
  it('carries no Approve or Reject link', () => {
    const [m] = buildApprovalNotices(HOD, SIGNED, BASE);
    expect(m.text).not.toContain('?decide=approve');
    expect(m.text).not.toContain('?decide=reject');
    expect(m.html).not.toContain('?decide=');
    expect(m.text).toContain(`${BASE}/pass/${PASS.id}`);
  });

  it('names the offices that signed it', () => {
    const [m] = buildApprovalNotices(HOD, SIGNED, BASE);
    expect(m.text).toMatch(/Security Head \(Demi\)|Security Head/);
    expect(m.text).toMatch(/COO \(Vikram Singh\)/);
  });

  // ⚠ THE CASE THAT KEEPS THIS HONEST. A pass with NO ladder also has nothing
  // pending — every pass raised before an office was designated, and every
  // level 058 closed on rollout. Telling that HOD their pass "has now been
  // approved by every office" would be describing approvals nobody gave.
  it('stays silent on a pass that never had a ladder at all', () => {
    expect(buildApprovalNotices(HOD, [], BASE)).toEqual([]);
  });

  it('stays silent while any rung is still pending', () => {
    const half = SIGNED.map((a) => (a.level_no === 3 ? { ...a, status: 'pending' as const } : a));
    const msgs = buildApprovalNotices(HOD, half, BASE);
    expect(msgs.every((m) => m.kind !== 'fully_approved')).toBe(true);
  });

  // A rejection is terminal and closes the pass; the HOD learns of that in the
  // app, which is the client's own 2026-08-19 instruction and is unchanged.
  it('stays silent on a rejected ladder', () => {
    const refused = SIGNED.map((a) => (a.level_no === 2 ? { ...a, status: 'rejected' as const } : a));
    expect(buildApprovalNotices(HOD, refused, BASE)).toEqual([]);
  });

  it('drops the message rather than sending when VMS holds no address for the HOD', () => {
    expect(buildApprovalNotices({ ...PASS, raised_by_email: null }, SIGNED, BASE)).toEqual([]);
    expect(buildApprovalNotices(PASS, SIGNED, BASE)).toEqual([]);
  });

  // The HOD's silence at EVERY OTHER step is unchanged (client, 2026-08-19).
  it('still writes nothing to the HOD while the ladder is climbing', () => {
    const msgs = buildApprovalNotices(HOD, LADDER, BASE);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m.to).not.toBe('anita@example.com');
      expect(m.kind).toBe('awaiting_you');
    }
  });
});
