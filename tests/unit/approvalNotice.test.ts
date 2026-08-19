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

  it('sends the approver to their queue, not to the record', () => {
    expect(msgs[0].html).toContain(`${BASE}/approvals`);
    expect(msgs[0].text).toContain(`${BASE}/approvals`);
  });

  it('carries the facts an approver needs to decide without opening the app', () => {
    const body = msgs[0].text;
    expect(body).toContain('RGP-20260819-0001');
    expect(body).toContain('Sharma Electricals');
    expect(body).toContain('Engineering / MEP');
    expect(body).toContain(noticeCurrency(48500));
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
