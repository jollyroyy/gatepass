// WHAT THE GATE DID. The two letters that close the outward trip: security
// matched the material and let it out, or stopped it at the barrier.
//
// Both are OUTCOMES, so everybody involved is told (client, 2026-09-01) —
// addressed to the requester, copying every office that signed. Neither asks
// for anything, so neither carries a decision button.
import type { NoticeApproval, NoticeMessage, NoticePass } from './noticeTypes.ts';
import { noticeDate, recordLink, wrapHtml, wrapText } from './noticeFormat.ts';
import { ccOf, officeRecipients, raiserRecipient } from './noticeLadder.ts';

/** Who to address a gate letter to: the requester, or — when VMS holds no
 *  address for them — the first office that signed, so that a pass the gate has
 *  decided is never silent. Null only when nobody at all has an address. */
function gateAddressee(pass: NoticePass, approvals: NoticeApproval[]) {
  const raiser = raiserRecipient(pass);
  const signed = officeRecipients(approvals, (a) => a.status === 'approved');
  return { to: raiser ?? signed[0] ?? null, raiser, signed };
}

/** "who, when" for the gate's own line, or '' when VMS holds neither. */
function gateStamp(pass: NoticePass): string {
  const who = (pass.verified_by_name ?? '').trim();
  const when = noticeDate(pass.verified_at);
  if (who && when) return ` by ${who} on ${when}`;
  if (who) return ` by ${who}`;
  if (when) return ` on ${when}`;
  return '';
}

/**
 * THE MATERIAL LEFT (`match_pass`).
 *
 * WHAT IT DOES NOT SAY IS "closed". `status` freezes at `matched` and the
 * RETURN leg is a separate axis (`return_status`), so on an RGP the pass is
 * very much still open and somebody has to bring the material back by the
 * expected return date — which `passFacts` has already printed above the tail.
 * An NRGP is outward-only and genuinely finished, and the letter says so.
 */
export function gateClearedNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  const { to, raiser, signed } = gateAddressee(pass, approvals);
  if (!to) return [];

  const returns = pass.type.toUpperCase().startsWith('RGP');
  const heading = `Gate pass ${pass.pass_number} was cleared at the gate`;
  const greeting = raiser?.name ? `Hello ${raiser.name},` : 'Hello,';
  const lead =
    `${greeting} security verified the material on gate pass ${pass.pass_number} and cleared ` +
    `it out of the gate${gateStamp(pass)}.`;
  const tail = returns
    ? 'This is a returnable pass, so it is not finished: the material is still expected back, ' +
      'and the gate records each line as it returns. The pass closes only when every line is ' +
      'fully returned.'
    : 'This is a non-returnable pass, so nothing further is expected — the record is complete.';

  return [
    {
      to: to.email,
      toName: to.name,
      cc: ccOf(to.email, [raiser, ...signed]),
      kind: 'gate_cleared',
      subject: `Cleared at the gate — ${pass.pass_number} (${pass.type})`,
      text: wrapText(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
      html: wrapHtml(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
    },
  ];
}

/**
 * SECURITY STOPPED IT (`flag_pass`), AND THAT IS FINAL (migration 070; client,
 * 2026-08-31: "once a guard rejects a pass he has to mention the justification
 * … then the entire pass will be cancelled and a new pass needs to be raised").
 *
 * This is the letter with the most urgency in the system: material is standing
 * at a barrier, everyone upstream approved it, and there is no override and no
 * "send it back to the gate". The guard's written reason is quoted verbatim
 * because it is the only thing that explains what to fix before raising a new
 * pass — and it is the approvers' business too, since it is their signatures
 * the gate has just contradicted.
 */
export function gateFlaggedNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  const { to, raiser, signed } = gateAddressee(pass, approvals);
  if (!to) return [];

  const reason = (pass.flag_reason ?? '').trim();
  const heading = `Gate pass ${pass.pass_number} was stopped at the gate`;
  const greeting = raiser?.name ? `Hello ${raiser.name},` : 'Hello,';
  const lead =
    `${greeting} security did not clear gate pass ${pass.pass_number}${gateStamp(pass)}. ` +
    (reason ? `The reason recorded was: "${reason}"` : 'No reason was recorded.');
  const tail =
    'A pass stopped at the gate is closed permanently — it cannot be corrected, reopened or ' +
    'sent back for another look. If the material still has to move, raise a new gate pass ' +
    'that answers the reason above.';

  return [
    {
      to: to.email,
      toName: to.name,
      cc: ccOf(to.email, [raiser, ...signed]),
      kind: 'gate_flagged',
      subject: `Stopped at the gate — ${pass.pass_number} (${pass.type}) is closed`,
      text: wrapText(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
      html: wrapHtml(heading, lead, pass, recordLink(baseUrl, pass.id), tail),
    },
  ];
}
