// THE PASS WAS RELEASED WITHOUT YOU (migration 055).
import type { NoticeApproval, NoticeMessage, NoticePass } from './noticeTypes.ts';
import { joinUrl, titleOf, wrapHtml, wrapText } from './noticeFormat.ts';
import { ccOf, raiserRecipient } from './noticeLadder.ts';

/**
 * A fallback office (the sitting COO or CEO, 067) can clear a stuck ladder when
 * nobody on it can be reached. The people whose signatures were skipped are
 * exactly the people who must hear about it, and hear about it from the system
 * rather than from whoever remembers to mention it — NIST AU-6 and SAP GRC's
 * Firefighter controller step both put alerting at the moment of use, not in a
 * monthly report.
 *
 * WHO IS WRITTEN TO: the holder of every office the pass owed, deduplicated by
 * address, one letter each. THE RAISER IS COPIED (client, 2026-09-01: they are
 * on every communication about their own pass) — under the previous rule they
 * were told nothing here, and their pass moving past the ladder is exactly the
 * kind of thing they should not learn about second-hand.
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
  const link = [
    { href: joinUrl(baseUrl, `/pass/${pass.id}`), label: 'Open the gate pass', kind: 'primary' as const },
  ];
  const tail =
    'This was recorded on the pass permanently, and another admin has to review it. ' +
    'If it should not have happened, say so now rather than later.';

  const raiser = raiserRecipient(pass);
  const seen = new Set<string>();
  const messages: NoticeMessage[] = [];

  for (const a of approvals) {
    // One letter per office, in ladder order. `to` is still deduplicated
    // because two rungs can resolve to one address — a vacant office falls back
    // to the holder snapshotted at raise — and two identical letters in one
    // inbox read as a bug rather than as thoroughness.
    const clean = a.approver_email?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const name = a.approver_name;
    const greeting = name ? `Hello ${name},` : 'Hello,';
    const lead =
      `${greeting} ${who} released this gate pass past the approval ladder, so it can leave ` +
      `the gate without the ${titleOf(a.role_key)} approval you would normally give. ` +
      `The reason recorded was: "${reason}"`;
    messages.push({
      to: clean,
      toName: name,
      // ONLY ON THE FIRST LETTER. Copying the raiser on every office's letter
      // would land four near-identical messages in their inbox for one release.
      cc: messages.length === 0 ? ccOf(clean, [raiser]) : [],
      kind: 'emergency_release',
      subject: `Released without approval — ${pass.pass_number} (${pass.type})`,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    });
  }

  // NOBODY OWED A SIGNATURE HAS AN ADDRESS, but the release still happened and
  // the raiser is still on every communication. One letter, so the event is
  // never wholly unrecorded outside the pass itself.
  if (messages.length === 0 && raiser) {
    const greeting = raiser.name ? `Hello ${raiser.name},` : 'Hello,';
    const lead =
      `${greeting} ${who} released this gate pass past the approval ladder, so it can leave ` +
      `the gate without the approvals it was waiting on. The reason recorded was: "${reason}"`;
    messages.push({
      to: raiser.email,
      toName: raiser.name,
      kind: 'emergency_release',
      subject: `Released without approval — ${pass.pass_number} (${pass.type})`,
      text: wrapText(heading, lead, pass, link, tail),
      html: wrapHtml(heading, lead, pass, link, tail),
    });
  }

  return messages;
}
