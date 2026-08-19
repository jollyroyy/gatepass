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

const HOD = { email: 'anita.rao@example.com', name: 'Anita Rao' };

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
  const msgs = buildApprovalNotices(PASS, LADDER, HOD, BASE);

  it('asks the FIRST office only, never all four', () => {
    const asked = msgs.filter((m) => m.kind === 'awaiting_you');
    expect(asked).toHaveLength(1);
    expect(asked[0].to).toBe('ravi.menon@example.com');
    expect(msgs.map((m) => m.to)).not.toContain('vikram@example.com');
    expect(msgs.map((m) => m.to)).not.toContain('meera@example.com');
  });

  it('copies the raising HOD, naming where the pass now sits', () => {
    const ack = msgs.find((m) => m.kind === 'raised_ack');
    expect(ack?.to).toBe('anita.rao@example.com');
    expect(ack?.subject).toContain('RGP-20260819-0001');
    expect(ack?.text).toContain('Security Head');
  });

  it('sends the approver to the queue and the HOD to the record', () => {
    expect(msgs.find((m) => m.kind === 'awaiting_you')?.text).toContain(`${BASE}/approvals`);
    expect(msgs.find((m) => m.kind === 'raised_ack')?.text).toContain(`${BASE}/pass/pass-1`);
  });

  it('carries the facts an approver needs to decide without opening the app', () => {
    const body = msgs[0].text;
    expect(body).toContain('Sharma Electricals');
    expect(body).toContain('₹48,500');
    expect(body).toContain('Anita Rao');
  });
});

describe('buildApprovalNotices — the ladder moving', () => {
  it('tells the NEXT office it is their turn, and the HOD who just signed', () => {
    const moved = [
      approval({ status: 'approved', decided_at: '2026-08-19T07:00:00.000Z' }),
      approval({ role_key: 'coo', level_no: 2, approver_id: 'u-coo', approver_name: 'Vikram Singh', approver_email: 'vikram@example.com' }),
    ];
    const msgs = buildApprovalNotices(PASS, moved, HOD, BASE);
    expect(msgs.find((m) => m.kind === 'awaiting_you')?.to).toBe('vikram@example.com');
    const cleared = msgs.find((m) => m.kind === 'level_cleared');
    expect(cleared?.to).toBe('anita.rao@example.com');
    expect(cleared?.subject).toContain('Security Head');
    expect(cleared?.subject).toContain('COO');
  });

  it('tells the HOD when the last office signs, and asks nobody', () => {
    const done = LADDER.map((a) => ({ ...a, status: 'approved' as const }));
    const msgs = buildApprovalNotices(PASS, done, HOD, BASE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('fully_approved');
    expect(msgs[0].to).toBe('anita.rao@example.com');
  });
});

describe('buildApprovalNotices — rejection', () => {
  const refused = [
    approval({ status: 'approved' }),
    approval({
      role_key: 'coo',
      level_no: 2,
      approver_id: 'u-coo',
      approver_name: 'Vikram Singh',
      approver_email: 'vikram@example.com',
      status: 'rejected',
      reason: 'Invoice reference does not match the material.',
    }),
    approval({ role_key: 'ceo', level_no: 3, approver_id: 'u-ceo', approver_email: 'meera@example.com' }),
  ];
  const msgs = buildApprovalNotices({ ...PASS, status: 'cancelled' }, refused, HOD, BASE);

  it('tells the HOD alone, with the reason', () => {
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('rejected');
    expect(msgs[0].to).toBe('anita.rao@example.com');
    expect(msgs[0].text).toContain('Invoice reference does not match the material.');
    expect(msgs[0].subject).toContain('COO');
  });

  // The levels below a rejection are still `pending` rows in the table — 046
  // leaves them alone deliberately. Mailing them would ask somebody to decide a
  // pass their own RPC now refuses, on a pass that is closed.
  it('does not ask a still-pending lower office to approve a closed pass', () => {
    expect(msgs.map((m) => m.to)).not.toContain('meera@example.com');
  });
});

describe('buildApprovalNotices — the edges', () => {
  it('says so plainly when no office is designated and the pass skips the ladder', () => {
    const msgs = buildApprovalNotices(PASS, [], HOD, BASE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('raised_ack');
    expect(msgs[0].subject).toContain('no approval required');
  });

  it('drops a message whose recipient has no address, and keeps the rest', () => {
    const msgs = buildApprovalNotices(PASS, LADDER, { email: null, name: 'Anita Rao' }, BASE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('awaiting_you');
  });

  it('sends one mail, not two, when the approver is also the raising HOD', () => {
    const msgs = buildApprovalNotices(PASS, LADDER, { email: 'ravi.menon@example.com', name: 'Ravi Menon' }, BASE);
    expect(msgs).toHaveLength(1);
    // The actionable one survives, not the receipt.
    expect(msgs[0].kind).toBe('awaiting_you');
  });

  it('escapes a rejection reason rather than letting it write HTML into the mail', () => {
    const nasty = [
      approval({ status: 'rejected', reason: '<script>alert(1)</script>' }),
    ];
    const msgs = buildApprovalNotices(PASS, nasty, HOD, BASE);
    expect(msgs[0].html).not.toContain('<script>');
    expect(msgs[0].html).toContain('&lt;script&gt;');
  });

  it('never puts "Invalid Date" in a subject or body', () => {
    const msgs = buildApprovalNotices({ ...PASS, created_at: 'not-a-date', expected_return_date: 'nope' }, LADDER, HOD, BASE);
    for (const m of msgs) {
      expect(m.subject).not.toContain('Invalid Date');
      expect(m.text).not.toContain('Invalid Date');
    }
  });
});

describe('joinUrl', () => {
  it('does not double the slash when the configured base carries one', () => {
    expect(joinUrl('https://x.example.com/', '/approvals')).toBe('https://x.example.com/approvals');
    expect(joinUrl('https://x.example.com', 'approvals')).toBe('https://x.example.com/approvals');
  });
});
