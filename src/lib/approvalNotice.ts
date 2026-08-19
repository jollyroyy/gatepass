// WHO GETS AN EMAIL WHEN A PASS MOVES THROUGH THE APPROVAL LADDER, and what it
// says. The whole decision, as pure functions over plain data.
//
// ═══ THIS FILE MUST IMPORT NOTHING. ═══
//
// It is loaded twice, by two different runtimes:
//
//   * the app, through Vite and Vitest, where `./formatDate` resolves;
//   * `supabase/functions/notify-approval/index.ts`, which is DENO, where a
//     local import must carry its `.ts` extension or it does not resolve at all.
//
// One file cannot satisfy both import styles, so it satisfies neither: no
// imports, no types borrowed from `../types`, and the two or three formatters it
// needs are written out below rather than pulled from `formatCurrency.ts`.
// `tests/unit/approvalNotice.test.ts` FAILS on an import line appearing here, and
// separately asserts that the duplicated titles and money format still agree
// with the modules they were copied from — the duplication is contained and
// checked, which is the trade for one source of truth about what the mail says.
//
// WHY THE EVENT IS NOT AN INPUT. The caller sends a pass id and nothing else.
// Everything below is derived from the pass's own approval rows, so a browser
// cannot ask this system to tell the CEO that a pass was approved when it was
// not. "Just raised" is `no row has been decided yet`, not a word in a payload.
//
// WHAT IS DELIBERATELY NOT MAILED. Only the office whose TURN it is hears about
// a pass — 046 makes the ladder sequential, so mailing all four would send three
// people a pass they cannot act on and train them to ignore the fourth mail that
// matters. The client asked for "the designated ladder holders"; this is that,
// one at a time, plus the raising HOD's copy of every step.

/** The four offices between the issuing HOD and the gate. Mirrors
 *  `ApprovalRoleKey` in `approvalLadder.ts` and the `approval_roles_key_known`
 *  check in migration 043. Restated rather than imported — see the header. */
export type NoticeRoleKey = 'security_head' | 'coo' | 'ceo' | 'finance_head';

/** Office titles, as the printed slip spells them. Must equal
 *  `APPROVAL_ROLE_TITLES` in `approvalLadder.ts`; the test asserts it. */
export const NOTICE_ROLE_TITLES: Record<NoticeRoleKey, string> = {
  security_head: 'Security Head',
  coo: 'COO',
  ceo: 'CEO',
  finance_head: 'Finance HOD',
};

/** The pass, as much of it as an email needs. A subset of `GatePassView`, named
 *  separately because this module cannot import that type. */
export interface NoticePass {
  id: string;
  pass_number: string;
  type: string;
  status: string;
  visitor_name: string | null;
  purpose: string | null;
  department_name: string | null;
  raised_by_name: string | null;
  item_count: number;
  total_value: number | null;
  expected_return_date: string | null;
  created_at: string;
}

/** One row of `gatepass.pass_approvals`, with the holder's name and address
 *  joined on. `approver_email` is nullable because the join reaches VMS's
 *  `public.profiles`: a missing address must drop one message, never the send. */
export interface NoticeApproval {
  role_key: NoticeRoleKey;
  level_no: number;
  status: 'pending' | 'approved' | 'rejected';
  approver_id: string;
  approver_name: string | null;
  approver_email: string | null;
  decided_at: string | null;
  reason: string | null;
}

/** The person who raised the pass. */
export interface NoticePerson {
  email: string | null;
  name: string | null;
}

/**
 * `awaiting_you`    — it is this office's turn. The only mail that asks for an action.
 * `raised_ack`      — receipt to the HOD: raised, and here is where it now sits.
 * `level_cleared`   — receipt to the HOD: one office signed, another now holds it.
 * `fully_approved`  — receipt to the HOD: the ladder is done, the gate can see it.
 * `rejected`        — receipt to the HOD: an office refused it, with the reason.
 */
export type NoticeKind =
  | 'awaiting_you'
  | 'raised_ack'
  | 'level_cleared'
  | 'fully_approved'
  | 'rejected';

export interface NoticeMessage {
  to: string;
  toName: string | null;
  kind: NoticeKind;
  subject: string;
  text: string;
  html: string;
}

// ─── Formatters, written out because this file imports nothing ──────────────

/** `formatCurrency`'s rule, restated: exact rupees, Indian grouping, never a
 *  `₹3.1K` abbreviation. The test asserts it still matches that module. */
export function noticeCurrency(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** `15 Aug 2026`. A date only — an email is read hours later and a clock time
 *  in it is noise. Returns '' for anything unparseable rather than 'Invalid
 *  Date', which is the one string that must never reach a printed subject. */
export function noticeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Minimal HTML escaping. Every value below is user-typed — a vendor name, a
 *  rejection reason — and lands inside an HTML mail body. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleOf(key: NoticeRoleKey): string {
  return NOTICE_ROLE_TITLES[key] ?? key;
}

// ─── The facts every mail repeats ───────────────────────────────────────────

/** The pass, as label/value pairs. ONE list, so the plain-text and the HTML
 *  halves of a message cannot describe the pass differently. A fact this pass
 *  does not carry is omitted rather than printed with an em dash — an empty row
 *  in an email is noise a reader has to decode. */
export function passFacts(pass: NoticePass): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: 'Gate Pass No.', value: pass.pass_number },
    { label: 'Type', value: pass.type },
  ];
  if (pass.raised_by_name) facts.push({ label: 'Requested By', value: pass.raised_by_name });
  if (pass.department_name) facts.push({ label: 'Department', value: pass.department_name });
  if (pass.visitor_name) facts.push({ label: 'Vendor / Person', value: pass.visitor_name });
  facts.push({ label: 'Items', value: String(pass.item_count) });
  if (pass.total_value != null && pass.total_value > 0) {
    facts.push({ label: 'Total Value', value: noticeCurrency(pass.total_value) });
  }
  if (pass.purpose) facts.push({ label: 'Purpose', value: pass.purpose });
  if (pass.expected_return_date) {
    facts.push({ label: 'Return Before', value: noticeDate(pass.expected_return_date) });
  }
  const raised = noticeDate(pass.created_at);
  if (raised) facts.push({ label: 'Raised On', value: raised });
  return facts;
}

function factsText(pass: NoticePass): string {
  return passFacts(pass)
    .map((f) => `  ${f.label}: ${f.value}`)
    .join('\n');
}

function factsHtml(pass: NoticePass): string {
  const rows = passFacts(pass)
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 0;color:#111;font-weight:600;">${escapeHtml(f.value)}</td></tr>`
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows}</table>`;
}

/** The house wrapper. Black on white with no colour-dependent information — the
 *  same rule the printed slip follows, and for the same reason: this is read on
 *  whatever client the reader has, including one that strips styles entirely. */
function wrapHtml(heading: string, lead: string, pass: NoticePass, cta: { href: string; label: string } | null, tail: string): string {
  const button = cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(cta.href)}" style="background:#16161A;color:#ffffff;` +
      `padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">` +
      `${escapeHtml(cta.label)}</a></p>` +
      `<p style="font-size:12px;color:#666;margin:0 0 16px;">If the button does not work, open:<br>` +
      `<a href="${escapeHtml(cta.href)}" style="color:#2B3FA0;">${escapeHtml(cta.href)}</a></p>`
    : '';
  return (
    `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">` +
    `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(heading)}</h1>` +
    `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;">${escapeHtml(lead)}</p>` +
    factsHtml(pass) +
    button +
    (tail ? `<p style="font-size:13px;color:#555;line-height:1.5;">${escapeHtml(tail)}</p>` : '') +
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px;">` +
    `<p style="font-size:12px;color:#888;margin:0;">Quest GatePass — material gate pass control. ` +
    `This message was sent automatically; replies are not monitored.</p>` +
    `</div>`
  );
}

function wrapText(heading: string, lead: string, pass: NoticePass, cta: { href: string; label: string } | null, tail: string): string {
  return (
    `${heading}\n\n${lead}\n\n${factsText(pass)}\n` +
    (cta ? `\n${cta.label}: ${cta.href}\n` : '') +
    (tail ? `\n${tail}\n` : '') +
    `\n--\nQuest GatePass. This message was sent automatically; replies are not monitored.\n`
  );
}

/** `https://host` + path, with exactly one slash between them. A trailing slash
 *  on the configured base URL is the likeliest configuration slip, and must not
 *  produce a `//approvals` link that some mail clients mangle. */
export function joinUrl(base: string, path: string): string {
  const b = (base || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

// ─── The decision ───────────────────────────────────────────────────────────

/** The office the pass is waiting on right now, or null. The LOWEST pending
 *  level, which is what 046's `approve_pass_level` enforces — mailing any other
 *  pending office would send somebody a pass its own RPC refuses to let them
 *  decide. */
export function currentApproval(approvals: NoticeApproval[]): NoticeApproval | null {
  const pending = approvals.filter((a) => a.status === 'pending');
  if (pending.length === 0) return null;
  return pending.reduce((lowest, a) => (a.level_no < lowest.level_no ? a : lowest));
}

/** The office that refused it, or null. */
export function rejectedApproval(approvals: NoticeApproval[]): NoticeApproval | null {
  return approvals.find((a) => a.status === 'rejected') ?? null;
}

/**
 * Every email this pass's current state calls for, in send order.
 *
 * `hod` is the raising HOD's copy. A message whose recipient has no address on
 * file is DROPPED, not faked: a pass whose HOD has no email must still notify
 * the approver.
 *
 * DE-DUPLICATED BY ADDRESS. One person may hold an office and have raised the
 * pass — plausible on a small site — and two mails about one event, one of them
 * asking them to approve their own pass, reads as a broken system.
 */
export function buildApprovalNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  hod: NoticePerson,
  baseUrl: string
): NoticeMessage[] {
  const messages: NoticeMessage[] = [];
  const passLink = joinUrl(baseUrl, `/pass/${pass.id}`);
  const queueLink = joinUrl(baseUrl, '/approvals');

  const rejected = rejectedApproval(approvals);
  if (rejected) {
    const who = rejected.approver_name
      ? `${titleOf(rejected.role_key)} (${rejected.approver_name})`
      : titleOf(rejected.role_key);
    const heading = `Gate pass ${pass.pass_number} was rejected`;
    const lead = `${who} rejected this gate pass. It is closed and cannot be cleared at the gate.`;
    const tail = rejected.reason ? `Reason given: ${rejected.reason}` : 'No reason was recorded.';
    messages.push({
      to: hod.email ?? '',
      toName: hod.name,
      kind: 'rejected',
      subject: `Rejected: ${pass.pass_number} — ${who}`,
      text: wrapText(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, tail),
      html: wrapHtml(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, tail),
    });
    return messages.filter((m) => m.to);
  }

  const current = currentApproval(approvals);
  const decided = approvals.filter((a) => a.status !== 'pending');

  if (current) {
    const title = titleOf(current.role_key);
    const heading = `Gate pass ${pass.pass_number} is waiting for your approval`;
    const lead =
      `You hold the ${title} office. This gate pass has reached your level ` +
      `(Level ${current.level_no}) and cannot leave the gate until you approve it.`;
    const tail =
      'Approving passes it to the next office on the ladder, or releases it to the gate if you are the last. ' +
      'Rejecting closes the pass permanently and needs a written reason.';
    messages.push({
      to: current.approver_email ?? '',
      toName: current.approver_name,
      kind: 'awaiting_you',
      subject: `Approval needed: ${pass.pass_number} (${pass.type}) — ${title}`,
      text: wrapText(heading, lead, pass, { href: queueLink, label: 'Open your Pending Approvals' }, tail),
      html: wrapHtml(heading, lead, pass, { href: queueLink, label: 'Open your Pending Approvals' }, tail),
    });
  }

  const hodMessage = ((): NoticeMessage | null => {
    // Nothing to approve at all — no office was designated when this pass was
    // raised, so 046 snapshotted no rows and it went straight to the gate. Say
    // that plainly rather than sending nothing: silence would read as a lost mail.
    if (approvals.length === 0) {
      const heading = `Gate pass ${pass.pass_number} has been raised`;
      const lead =
        'No approval offices are designated, so this pass needs no approval and is already visible at the gate.';
      return {
        to: hod.email ?? '',
        toName: hod.name,
        kind: 'raised_ack',
        subject: `Raised: ${pass.pass_number} (${pass.type}) — no approval required`,
        text: wrapText(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
        html: wrapHtml(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
      };
    }

    if (!current) {
      const heading = `Gate pass ${pass.pass_number} is fully approved`;
      const lead =
        `Every approval office has signed this pass. It is now visible to security and can be cleared at the gate.`;
      return {
        to: hod.email ?? '',
        toName: hod.name,
        kind: 'fully_approved',
        subject: `Fully approved: ${pass.pass_number} (${pass.type})`,
        text: wrapText(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
        html: wrapHtml(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
      };
    }

    const waitingOn = current.approver_name
      ? `${titleOf(current.role_key)} (${current.approver_name})`
      : titleOf(current.role_key);

    if (decided.length === 0) {
      const heading = `Gate pass ${pass.pass_number} has been raised`;
      const lead =
        `It has entered the approval ladder and is now with the ${waitingOn}. ` +
        `The gate cannot see this pass until every office has approved it.`;
      return {
        to: hod.email ?? '',
        toName: hod.name,
        kind: 'raised_ack',
        subject: `Raised: ${pass.pass_number} (${pass.type}) — awaiting ${titleOf(current.role_key)}`,
        text: wrapText(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
        html: wrapHtml(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
      };
    }

    const last = decided.reduce((a, b) => (a.level_no > b.level_no ? a : b));
    const lastWho = last.approver_name
      ? `${titleOf(last.role_key)} (${last.approver_name})`
      : titleOf(last.role_key);
    const heading = `Gate pass ${pass.pass_number} cleared one approval level`;
    const lead = `${lastWho} approved this pass. It is now with the ${waitingOn}.`;
    return {
      to: hod.email ?? '',
      toName: hod.name,
      kind: 'level_cleared',
      subject: `Approved by ${titleOf(last.role_key)}: ${pass.pass_number} — now with ${titleOf(current.role_key)}`,
      text: wrapText(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
      html: wrapHtml(heading, lead, pass, { href: passLink, label: 'Open the pass record' }, ''),
    };
  })();

  if (hodMessage) messages.push(hodMessage);

  // Drop the addressless, then the duplicates. Order matters: `awaiting_you` is
  // pushed first, so when one person is both the approver and the raising HOD
  // it is the actionable mail that survives.
  const seen = new Set<string>();
  return messages.filter((m) => {
    const key = m.to.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
