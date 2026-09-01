// THE TWO LETTERS ABOUT A PASS'S OWN FATE: it was raised, or an approval
// office refused it. Both are addressed to the person who raised it, because
// both are answers to a request they made.
import type { NoticeApproval, NoticeMessage, NoticePass } from './noticeTypes.ts';
import { recordLink, titleOf, wrapHtml, wrapText } from './noticeFormat.ts';
import {
  ccOf,
  currentApproval,
  holderLabel,
  officeRecipients,
  raiserRecipient,
  rejectedApproval,
  signedSoFar,
} from './noticeLadder.ts';

/**
 * "YOUR GATE PASS WAS RAISED" — the receipt the requester gets the moment they
 * raise one (client, 2026-09-01: "I, as an HOD, have created one gate pass. I
 * want to be notified that I have created the gate pass. Now it is awaiting the
 * approval from the first-level approver").
 *
 * ⚠ THIS REVERSES A STANDING INSTRUCTION, AND THE REVERSAL IS DELIBERATE.
 * Client, 2026-08-19: "the hod who raises the pass should not get any email
 * because he or she already raised it." Every per-step receipt was removed on
 * that instruction and MUST STAY REMOVED — this is not licence to restore them.
 * What came back on 2026-09-01 is the ONE letter at the moment of raising, and
 * what it adds over "you already know, you just did it" is the pass NUMBER and
 * the NAME OF THE OFFICE it went to, neither of which the raiser knows until
 * the server has allocated and routed them.
 *
 * NOBODY IS COPIED. The office whose turn it is gets its own letter from the
 * same invocation (`awaitingNotices`); copying them here would put two mails
 * about one event in one inbox a second apart.
 */
export function raisedNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  const to = pass.raised_by_email?.trim();
  if (!to) return [];

  const next = currentApproval(approvals);
  // A PASS WITH NO LADDER GOES STRAIGHT TO THE GATE, and the letter must say so
  // rather than name an office that was never designated. That is every pass
  // raised before an office existed (046 snapshots on insert and backfills
  // nothing) and every one 058 closed on rollout.
  const whereItIs = next
    ? `It is now waiting for approval from the ${titleOf(next.role_key)}` +
      (next.approver_name ? ` (${next.approver_name})` : '') +
      '.'
    : 'No approval office is designated for it, so it has gone straight to the security gate.';

  const heading = `Gate pass ${pass.pass_number} was raised`;
  const greeting = pass.raised_by_name ? `Hello ${pass.raised_by_name},` : 'Hello,';
  const lead = `${greeting} your gate pass has been raised as ${pass.pass_number}. ${whereItIs}`;
  const tail =
    'You will be written to again when it is fully approved, if an office rejects it, and ' +
    'when the gate either clears the material or stops it. Nothing further is needed from ' +
    'you now.';

  return [
    {
      to,
      toName: pass.raised_by_name,
      kind: 'raised',
      subject: `Raised — ${pass.pass_number} (${pass.type})` + (next ? `, now with the ${titleOf(next.role_key)}` : ''),
      text: wrapText(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
      html: wrapHtml(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
    },
  ];
}

/**
 * AN APPROVAL OFFICE REFUSED IT (client, 2026-09-01).
 *
 * A rejection is terminal in 046: the pass is cancelled, and the rungs below it
 * stay `pending` because nobody ever signed them. Until now the raiser learnt
 * this only from the in-app bell, which is a notification they have to be
 * logged in to see — for the one outcome that means their material is not
 * going anywhere and a new pass has to be raised.
 *
 * THE REASON IS QUOTED VERBATIM, not summarised: it is the whole of what the
 * requester needs in order to decide what to do next, and 065 made writing it
 * compulsory precisely so it would exist to quote.
 *
 * Addressed to the raiser and copied to every office on the ladder — an
 * outcome, so there is no wrong reader. When VMS holds no address for the
 * raiser the letter is still sent, to the office that refused it, so that the
 * ladder is never silent about a pass it closed.
 */
export function rejectedNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  const refused = rejectedApproval(approvals);
  if (!refused) return [];

  const raiser = raiserRecipient(pass);
  const offices = officeRecipients(approvals);
  const to = raiser ?? offices[0] ?? null;
  if (!to) return [];

  const who = holderLabel(refused);
  const reason = (refused.reason ?? '').trim();
  const heading = `Gate pass ${pass.pass_number} was rejected by the ${titleOf(refused.role_key)}`;
  const greeting = raiser?.name ? `Hello ${raiser.name},` : 'Hello,';
  const lead =
    `${greeting} ${who} rejected gate pass ${pass.pass_number}, so it is now closed and the ` +
    'material cannot leave the gate on it. ' +
    (reason ? `The reason recorded was: "${reason}"` : 'No reason was recorded.');
  const cleared = signedSoFar(approvals);
  const tail =
    (cleared ? `It had been approved by ${cleared} before this. ` : '') +
    'A rejected pass cannot be reopened or sent back — if the material still has to move, ' +
    'raise a new gate pass.';

  return [
    {
      to: to.email,
      toName: to.name,
      cc: ccOf(to.email, [raiser, ...offices]),
      kind: 'rejected',
      subject: `Rejected by ${who} — ${pass.pass_number} (${pass.type})`,
      text: wrapText(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
      html: wrapHtml(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
    },
  ];
}
