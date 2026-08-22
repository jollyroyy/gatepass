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
// WHAT IS DELIBERATELY NOT MAILED, and this is the whole of it:
//
//   * every office but the one whose TURN it is. 046 makes the ladder
//     sequential, so mailing all four would send three people a pass they
//     cannot act on and train them to ignore the fourth mail that matters.
//   * THE RAISING HOD, at every step BUT THE LAST — raised, level cleared,
//     rejected. Client, 2026-08-19: "the hod who raises the pass should not get
//     any email because he or she already raised it. That means approval is
//     already taken."
//     ⚠ ONE RECEIPT CAME BACK ON 2026-08-22, ON THE CLIENT'S OWN INSTRUCTION:
//     "whenever any pass gets fully approved by all the approvers, the hod
//     should receive an email that your pass has been approved fully. Now it is
//     waiting … at the gate." That is `fully_approved`, and it is the ONE
//     moment the ladder has news the HOD does not already have — every other
//     receipt restated something they had just done themselves. It is sent
//     when the LAST rung is signed and never before, so it cannot be confused
//     with the per-level chatter that was removed.
//     SINCE 054 THAT ONE REQUEST MAY GO TO TWO PEOPLE — the office's holder and
//     its standing deputy — because either of them may sign it. That is still
//     one office being asked one question; it is not a second kind of letter,
//     and nobody who cannot act on the pass is written to.
//     COST, STATED: the HOD learns of a rejection in the app alone — the bell's
//     notice, derived on mount from `status = 'cancelled' and flag_reason is
//     null` — and hears nothing by mail. That is the client's instruction; if
//     receipts are ever wanted back, this is the file and `NoticeKind` is the
//     union to widen.

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
  /** The raising HOD's address, for the `fully_approved` receipt alone
   *  (client, 2026-08-22). Nullable and optional: `approval_notice_payload`
   *  LEFT JOINs it out of VMS's `public.profiles`, and a missing address must
   *  drop that one message rather than the send. */
  raised_by_email?: string | null;
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
  status: 'pending' | 'approved' | 'rejected' | 'not_required';
  approver_id: string;
  approver_name: string | null;
  approver_email: string | null;
  /** The office's STANDING DEPUTY (migration 054), resolved TODAY exactly as
   *  the holder is — authority is read at the moment of the press, so the
   *  address has to be too. Null is the ordinary case: an office with no cover. */
  deputy_name?: string | null;
  deputy_email?: string | null;
  decided_at: string | null;
  reason: string | null;
}

/**
 * `awaiting_you` — it is this office's turn, and the mail asks for a decision.
 * `fully_approved` — the LAST rung has been signed, and the raising HOD is
 * told once that their pass is now waiting at the gate (client, 2026-08-22).
 *
 * A union rather than a bare string so that adding a kind stays a typed change
 * and `email_log.kind` keeps meaning something.
 */
export type NoticeKind = 'awaiting_you' | 'fully_approved' | 'emergency_release';

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
    facts.push({ label: 'Expected Return Date', value: noticeDate(pass.expected_return_date) });
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

/** A call to action in a letter. `primary` is the solid button, `secondary` the
 *  outlined one, `plain` a link that gets no button at all — every one of them
 *  is also printed as a bare URL underneath.
 *
 *  COLOUR CARRIES NOTHING HERE, the same rule the printed slip follows: Approve
 *  and Reject are told apart by their WORDS, so the letter still works in a
 *  client that renders no styles at all. */
export interface Cta {
  href: string;
  label: string;
  kind: 'primary' | 'secondary' | 'plain';
}

/**
 * THE DECISION LINKS THAT GO IN THE LETTER (client, 2026-08-20: "make sure …
 * it gives this Approve or Reject button in the email approval emails for easy
 * visibility of all the approvers. Once it is clicked on any of those links, it
 * should directly open up the portal or it should open up the PWA application
 * if done from mobile … of course it will ask for the username and password").
 *
 * ⚠ NEITHER LINK DECIDES ANYTHING BY BEING FETCHED, and that is deliberate.
 * A link in an email is a GET, and GETs are prefetched: Outlook Safe Links and
 * every other scanner opens a URL before its reader ever does, so a URL that
 * approved a pass would approve passes nobody had read. These open the RECORD,
 * with `?decide=` naming which button was pressed; the app signs the reader in,
 * shows them the whole pass, and offers the decision on screen. The signature
 * is still `approve_pass_level` / `reject_pass_level` under their own JWT, and
 * a rejection still needs the written reason the modal asks for.
 *
 * They are ordinary in-app paths, so on a phone with the PWA installed the
 * scope match hands them to the installed app rather than to the browser; and
 * `postLoginRedirect.ts` is what carries the destination across the sign-in.
 */
export function decisionLinks(baseUrl: string, passId: string): Cta[] {
  const record = joinUrl(baseUrl, `/pass/${passId}`);
  return [
    { href: `${record}?decide=approve`, label: 'Approve', kind: 'primary' },
    { href: `${record}?decide=reject`, label: 'Reject', kind: 'secondary' },
  ];
}

/** The house wrapper. Black on white with no colour-dependent information — the
 *  same rule the printed slip follows, and for the same reason: this is read on
 *  whatever client the reader has, including one that strips styles entirely. */
function wrapHtml(heading: string, lead: string, pass: NoticePass, ctas: Cta[], tail: string): string {
  const buttons = ctas.filter((c) => c.kind !== 'plain');
  // Each button is its own inline-block anchor with its own margin — no float
  // and no flexbox, neither of which Outlook renders, and a decision an
  // approver cannot press is the whole letter wasted.
  const row = buttons.length
    ? `<p style="margin:24px 0;">` +
      buttons
        .map((c) =>
          c.kind === 'secondary'
            ? `<a href="${escapeHtml(c.href)}" style="border:2px solid #16161A;color:#16161A;` +
              `padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;` +
              `display:inline-block;margin:0 8px 8px 0;">${escapeHtml(c.label)}</a>`
            : `<a href="${escapeHtml(c.href)}" style="background:#16161A;color:#ffffff;` +
              `padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;` +
              `display:inline-block;margin:0 8px 8px 0;">${escapeHtml(c.label)}</a>`
        )
        .join('') +
      `</p>`
    : '';
  // EVERY LINK IS ALSO PRINTED AS A BARE URL. A mail client that strips anchors
  // is not unusual, and this is the one letter whose whole purpose is a press.
  const fallback = ctas.length
    ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">If a button does not work, open:<br>` +
      ctas
        .map(
          (c) =>
            `${escapeHtml(c.label)}: <a href="${escapeHtml(c.href)}" style="color:#2B3FA0;">` +
            `${escapeHtml(c.href)}</a>`
        )
        .join('<br>') +
      `</p>`
    : '';
  const button = row + fallback;
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

function wrapText(heading: string, lead: string, pass: NoticePass, ctas: Cta[], tail: string): string {
  return (
    `${heading}\n\n${lead}\n\n${factsText(pass)}\n` +
    (ctas.length ? `\n${ctas.map((c) => `${c.label}: ${c.href}`).join('\n')}\n` : '') +
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
  const lowest = pending.reduce((low, a) => (a.level_no < low.level_no ? a : low));
  const here = pending.filter((a) => a.level_no === lowest.level_no);
  if (here.length === 1) return here[0];
  // TWO OFFICES ON ONE RUNG (063): the COO gets first refusal and the CEO only
  // gets it if the window runs out. The letter goes to whoever may act NOW, and
  // at the moment a rung is reached that is always the COO — this letter is
  // sent by the decision that opened the rung, so no time has passed yet.
  //
  // ⚠ NOBODY IS WRITTEN TO WHEN THE WINDOW LATER ELAPSES. There is no scheduler
  // on this deployment, so the CEO learns the pass has escalated by opening
  // their queue. See migration 063.
  return here.find((a) => a.role_key === 'coo') ?? here[0];
}

/** "Security Head (Ravi Menon)" — the app's own bracket form, the same one the
 *  record's approval rail prints — or just "Security Head" when VMS holds no
 *  name for the holder. Never "Security Head (null)": a missing name is a
 *  missing fact, and the word null in a subject line is how a real letter gets
 *  read as a broken one. */
export function holderLabel(a: NoticeApproval): string {
  const name = (a.approver_name ?? '').trim();
  return name ? `${titleOf(a.role_key)} (${name})` : titleOf(a.role_key);
}

/** The offices that have ALREADY approved, oldest rung first, each with the
 *  name of whoever signed it — or '' when this is the first rung. */
export function signedSoFar(approvals: NoticeApproval[]): string {
  return approvals
    .filter((a) => a.status === 'approved')
    .sort((x, y) => x.level_no - y.level_no)
    .map((a) => holderLabel(a))
    .join(', ');
}

/** The office that refused it, or null. */
export function rejectedApproval(approvals: NoticeApproval[]): NoticeApproval | null {
  return approvals.find((a) => a.status === 'rejected') ?? null;
}


/**
 * The receipt the RAISING HOD gets when the last office signs (client,
 * 2026-08-22: "whenever any pass gets fully approved by all the approvers, the
 * hod should receive an email that your pass has been approved fully. Now it is
 * waiting … at the gate").
 *
 * Silent unless every rung of a REAL ladder is approved. Three ways it stays
 * silent, each a case where the letter would say something untrue:
 *   * no ladder at all — a pre-046 pass, or one 058 closed on rollout. Nobody
 *     approved anything, and the pass never left the gate queue.
 *   * a rung still pending or rejected — the caller has already returned above,
 *     but the check is restated here so this function is safe on its own.
 *   * no address on file for the HOD. One dropped message, never a failed send.
 *
 * WHAT IT SAYS NEXT is the honest state of the pass, not "done": since 046 a
 * fully approved pass becomes VISIBLE to the gate, and the guard has still to
 * verify the material and clear it out. Saying "approved" alone is how an HOD
 * comes to believe their lorry has left.
 */
export function fullyApprovedNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  if (approvals.length === 0) return [];
  if (!approvals.every((a) => a.status === 'approved')) return [];

  const to = pass.raised_by_email?.trim();
  if (!to) return [];

  const heading = `Gate pass ${pass.pass_number} is fully approved`;
  const greeting = pass.raised_by_name ? `Hello ${pass.raised_by_name},` : 'Hello,';
  const lead =
    `${greeting} every approval office has signed gate pass ${pass.pass_number}. ` +
    'It is now with the security gate, which will verify the material and clear it out.';
  const cleared = signedSoFar(approvals);
  const tail =
    (cleared ? `Approved by ${cleared}. ` : '') +
    'Nothing further is needed from you — the pass is waiting for gate review, and its ' +
    'record shows every signature and, once the material moves, the gate’s own entry.';

  // NO DECISION LINKS. The HOD has nothing to decide; the record is the one
  // place there is anything to read, and a letter offering Approve to somebody
  // the RPC would refuse teaches them to distrust the buttons that do work.
  const link: Cta[] = [
    { href: joinUrl(baseUrl, `/pass/${pass.id}`), label: 'Open the gate pass', kind: 'plain' },
  ];

  return [
    {
      to,
      toName: pass.raised_by_name,
      kind: 'fully_approved',
      subject: `Fully approved — ${pass.pass_number} (${pass.type}) is now waiting for gate review`,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    },
  ];
}

/**
 * The email this pass's current state calls for — AT MOST ONE, addressed to the
 * office whose turn it is.
 *
 * Nothing goes to the raising HOD (see the header), and nothing goes to an
 * office above or below the current rung: 046's `approve_pass_level` accepts
 * only the LOWEST pending level, so any other letter would ask for a decision
 * the database refuses to record.
 *
 * When every office HAS signed there is nobody left to ask, and the one letter
 * that goes out instead is the raising HOD's receipt — see
 * `fullyApprovedNotices` directly above.
 *
 * Returns an empty array — never a fabricated message — in every other case
 * where there is nobody to write to: no office was designated, an office has
 * already rejected it, or the office holder has no address on file.
 */
export function buildApprovalNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  // A rejection is terminal (046): the pass is cancelled and the levels below
  // it stay `pending` because nobody signed them. Asking one of them to approve
  // a closed pass is the exact mail this guard exists to prevent.
  if (rejectedApproval(approvals)) return [];

  const current = currentApproval(approvals);
  // NOTHING PENDING AND NOTHING REJECTED = THE LADDER IS FINISHED, so the one
  // receipt the raising HOD gets goes out here (client, 2026-08-22).
  //
  // `approvals.length > 0` is load-bearing: a pass with NO ladder at all — every
  // pass raised before an office was designated (046 snapshots on insert and
  // backfills nothing), and every level closed by 058's rollout — also has
  // nothing pending, and telling that HOD their pass "has now been approved by
  // every office" would be describing approvals nobody gave. Such a pass went
  // straight to the gate and its HOD learns nothing new from a letter.
  if (!current) return fullyApprovedNotices(pass, approvals, baseUrl);
  if (!current.approver_email) return [];

  const queueLink = joinUrl(baseUrl, '/approvals');
  const title = titleOf(current.role_key);
  // WHO, BY NAME. Every letter on this deployment is redirected to one inbox
  // (MAIL_OVERRIDE_TO, because the Resend account is unverified) and the mailer
  // drops the display name when it redirects — so if the person's name is not
  // in the subject and in the body, the reader of that inbox cannot tell the
  // Security Head's letter from the CEO's. Client, 2026-08-19.
  const who = holderLabel(current);
  // LEVELS, NOT ROWS: the COO and the CEO share level 3 (063), so a pass with
  // all four offices designated has four rows and three rungs.
  const rung = `Level ${current.level_no} of ${new Set(approvals.map((a) => a.level_no)).size}`;
  const heading = `Gate pass ${pass.pass_number} is waiting for your approval`;
  const greeting = current.approver_name ? `Hello ${current.approver_name},` : 'Hello,';
  const lead =
    `${greeting} you hold the ${title} office. This gate pass has reached your level ` +
    `(${rung}) and cannot leave the gate until you approve it.`;
  // WHAT HAS ALREADY BEEN SIGNED, and by whom. This is what makes the chain
  // readable from the inbox alone: each letter names the rung it is asking for
  // and the rungs behind it, so "Demi approved, and the COO's letter went out"
  // is visible without opening the app.
  const cleared = signedSoFar(approvals);
  const tail =
    (cleared ? `Already approved by ${cleared}. ` : '') +
    'Approving passes it to the next office on the ladder, or releases it to the gate if you are the last. ' +
    'Rejecting closes the pass permanently and needs a written reason.';

  const subject = `Approval needed by ${who} — ${pass.pass_number} (${pass.type}), ${rung}`;
  // The two decisions first, then the whole queue as a plain link for a reader
  // who would rather work through their list than answer one letter.
  const link: Cta[] = [
    ...decisionLinks(baseUrl, pass.id),
    { href: queueLink, label: 'Open your Pending Approvals', kind: 'plain' },
  ];

  const messages: NoticeMessage[] = [
    {
      to: current.approver_email,
      toName: current.approver_name,
      kind: 'awaiting_you',
      subject,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    },
  ];

  // THE STANDING DEPUTY IS ASKED TOO (054). Either seat may sign, so a deputy
  // who is never written to is cover that only works for somebody already
  // watching the screen — which is precisely the person who did not need cover.
  //
  // Its own lead, not a copy of the holder's: "you hold the CEO office" is
  // false for a deputy, and a letter that misstates why it is asking is how a
  // reader learns to distrust the rest of it.
  //
  // The address is compared case-insensitively before sending twice. One person
  // seated as both is already refused by the database, but a holder and deputy
  // sharing a mailbox is not — and two identical letters in one inbox reads as
  // a bug in the system rather than a quirk of the mailbox.
  const deputyEmail = current.deputy_email?.trim();
  if (deputyEmail && deputyEmail.toLowerCase() !== current.approver_email.trim().toLowerCase()) {
    const dGreeting = current.deputy_name ? `Hello ${current.deputy_name},` : 'Hello,';
    const dLead =
      `${dGreeting} you are the standing deputy for the ${title} office` +
      `${current.approver_name ? `, held by ${current.approver_name}` : ''}. This gate pass has ` +
      `reached that level (${rung}) and cannot leave the gate until it is approved. ` +
      'You may approve or reject it yourself.';
    messages.push({
      to: deputyEmail,
      toName: current.deputy_name ?? null,
      kind: 'awaiting_you',
      subject,
      text: wrapText(heading, dLead, pass, link, tail),
      html: wrapHtml(heading, dLead, pass, link, tail),
    });
  }

  return messages;
}


/**
 * THE PASS WAS RELEASED WITHOUT YOU (migration 055).
 *
 * A super admin can clear a stuck ladder when nobody on it can be reached. The
 * people whose signatures were skipped are exactly the people who must hear
 * about it, and hear about it from the system rather than from whoever
 * remembers to mention it — NIST AU-6 and SAP GRC's Firefighter controller step
 * both put alerting at the moment of use, not in a monthly report.
 *
 * WHO IS WRITTEN TO: every office the pass owed, holder and standing deputy
 * alike, deduplicated by address. NOT the raising HOD — the same client rule
 * that removed every other receipt (see the header); their pass moved, which is
 * what they wanted, and the record carries the banner.
 *
 * The reason is quoted verbatim and is not summarised. It is the entire
 * justification, and a reader deciding whether to challenge the release needs
 * the actual words.
 */
export function buildEmergencyNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  releasedBy: string | null,
  reason: string,
  baseUrl: string
): NoticeMessage[] {
  const heading = `Gate pass ${pass.pass_number} was released without approval`;
  const who = releasedBy ? `${releasedBy} (super admin)` : 'A super admin';
  const link: Cta[] = [
    { href: joinUrl(baseUrl, `/pass/${pass.id}`), label: 'Open the gate pass', kind: 'primary' },
  ];
  const tail =
    'This was recorded on the pass permanently, and another admin has to review it. ' +
    'If it should not have happened, say so now rather than later.';

  const seen = new Set<string>();
  const messages: NoticeMessage[] = [];

  for (const a of approvals) {
    // Both seats of every office, in ladder order. `to` is deduplicated because
    // a holder and deputy may share a mailbox, and two identical letters read
    // as a bug rather than as thoroughness.
    for (const [addr, name] of [
      [a.approver_email, a.approver_name] as const,
      [a.deputy_email ?? null, a.deputy_name ?? null] as const,
    ]) {
      const clean = addr?.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const greeting = name ? `Hello ${name},` : 'Hello,';
      const lead =
        `${greeting} ${who} released this gate pass past the approval ladder, so it can leave ` +
        `the gate without the ${titleOf(a.role_key)} approval you would normally give. ` +
        `The reason recorded was: "${reason}"`;
      messages.push({
        to: clean,
        toName: name,
        kind: 'emergency_release',
        subject: `Released without approval — ${pass.pass_number} (${pass.type})`,
        text: wrapText(heading, lead, pass, link, tail),
        html: wrapHtml(heading, lead, pass, link, tail),
      });
    }
  }

  return messages;
}
