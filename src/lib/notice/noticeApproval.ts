// THE TWO LETTERS THE LADDER ITSELF SENDS: the request for a signature, and
// the receipt when the last one is given.
import type { NoticeApproval, NoticeMessage, NoticePass } from './noticeTypes.ts';
import { decisionLinks, joinUrl, recordLink, wrapHtml, wrapText } from './noticeFormat.ts';
import { titleOf } from './noticeFormat.ts';
import {
  ccOf,
  currentApproval,
  rejectedApproval,
  holderLabel,
  officeRecipients,
  raiserRecipient,
  signedSoFar,
} from './noticeLadder.ts';

/**
 * ASK THE OFFICE WHOSE TURN IT IS, AND NOBODY ELSE.
 *
 * 046's `approve_pass_level` accepts only the LOWEST pending level, so a letter
 * to any other office would ask for a decision the database refuses to record.
 * The raiser is copied — they are on every letter about their own pass — and
 * no other office is, which is the client's rule stated in `ccOf`.
 *
 * Returns an empty array — never a fabricated message — when there is nobody to
 * write to: no office was designated, or the office holder has no address on
 * file. The pass still waits for them in `/approvals`.
 */
export function awaitingNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  const current = currentApproval(approvals);
  if (!current || !current.approver_email) return [];

  const queueLink = joinUrl(baseUrl, '/approvals');
  const title = titleOf(current.role_key);
  // WHO, BY NAME. A deployment whose letters are redirected to one inbox
  // (MAIL_OVERRIDE_TO, before a sending domain is authenticated) drops the
  // display name — so if the person is not named in the subject and in the
  // body, the reader of that inbox cannot tell the Security Head's letter from
  // the CEO's. Client, 2026-08-19.
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
  const link = [
    ...decisionLinks(baseUrl, pass.id),
    { href: queueLink, label: 'Open your Pending Approvals', kind: 'plain' as const },
  ];

  return [
    {
      to: current.approver_email,
      toName: current.approver_name,
      cc: ccOf(current.approver_email, [raiserRecipient(pass)]),
      kind: 'awaiting_you',
      subject,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    },
  ];
}

/**
 * The receipt the RAISING HOD gets when the last office signs (client,
 * 2026-08-22: "whenever any pass gets fully approved by all the approvers, the
 * hod should receive an email that your pass has been approved fully. Now it is
 * waiting … at the gate"). Every office that signed is copied, because this is
 * an OUTCOME and not a request — the client's 2026-09-01 rule.
 *
 * Silent unless every rung of a REAL ladder is approved. Three ways it stays
 * silent, each a case where the letter would say something untrue:
 *   * no ladder at all — a pre-046 pass, or one 058 closed on rollout. Nobody
 *     approved anything, and the pass never entered the ladder.
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
  // ⚠ `not_required` COUNTS AS CLOSED, and getting this wrong made this receipt
  // silent on most passes. 063 puts the COO and the CEO on ONE rung that takes
  // ONE signature, and writes the OTHER row off as `not_required` the moment
  // either of them signs — so a fully signed pass whose level 3 the COO cleared
  // carries an `approved` row and a `not_required` one, and a test for
  // `every(approved)` finds a rung outstanding that nobody is waiting on. This
  // is 063's and 072's own predicate, `status not in ('approved',
  // 'not_required')`, stated the positive way round.
  if (!approvals.every((a) => a.status === 'approved' || a.status === 'not_required')) return [];
  // …and at least one office actually signed. An all-`not_required` ladder is
  // not a thing 063 can produce, but "approved by nobody" is the one sentence
  // this letter must never be able to say.
  if (!approvals.some((a) => a.status === 'approved')) return [];

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
  const link = recordLink(baseUrl, pass.id);

  return [
    {
      to,
      toName: pass.raised_by_name,
      cc: ccOf(to, officeRecipients(approvals, (a) => a.status === 'approved')),
      kind: 'fully_approved',
      subject: `Fully approved — ${pass.pass_number} (${pass.type}) is now waiting for gate review`,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    },
  ];
}

/**
 * THE LADDER'S OWN LETTERS, and only those: ask the office whose turn it is,
 * or — when the ladder has finished — send the requester their receipt.
 *
 * Kept as its own function, separate from `buildNotices`, because this is the
 * question "what does the APPROVAL CHAIN owe anybody right now". The gate's
 * letters and the raising receipt are about the pass's life either side of the
 * chain, and folding them in here would make a rejection or a flag look like a
 * rung.
 *
 * Returns an empty array — never a fabricated message — whenever there is
 * nobody to write to: an office already refused it, no office was designated,
 * or the office holder has no address on file.
 */
export function buildApprovalNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  // A rejection is terminal (046): the pass is cancelled and the rungs below it
  // stay `pending` because nobody signed them. Asking one of them to approve a
  // closed pass is the exact mail this guard exists to prevent. The letter that
  // DOES go out for a rejection is `rejectedNotices`, which `buildNotices`
  // reaches first — it is not the ladder asking for anything.
  if (rejectedApproval(approvals)) return [];

  const awaiting = awaitingNotices(pass, approvals, baseUrl);
  if (awaiting.length > 0) return awaiting;
  // NOTHING PENDING AND NOTHING REJECTED = THE LADDER IS FINISHED. `approvals.
  // length > 0` inside `fullyApprovedNotices` is load-bearing: a pass with NO
  // ladder at all also has nothing pending, and telling that HOD their pass
  // "has now been approved by every office" would describe approvals nobody
  // gave.
  return fullyApprovedNotices(pass, approvals, baseUrl);
}
