// WHO IS WRITTEN TO. The reading of the ladder, and the copy list — every
// decision about a recipient lives here, and nothing here composes a letter.
import type { NoticeApproval, NoticePass, Recipient } from './noticeTypes.ts';
import { titleOf } from './noticeFormat.ts';

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

/** The raising HOD as a recipient, or null when VMS holds no address for them.
 *  A missing address drops ONE reader, never the letter. */
export function raiserRecipient(pass: NoticePass): Recipient | null {
  const email = pass.raised_by_email?.trim();
  return email ? { email, name: pass.raised_by_name } : null;
}

/** The office holders on this ladder, in rung order. `only` narrows it — the
 *  offices that SIGNED, for a letter reporting an outcome they contributed to.
 *  An office with no address on file is dropped, not faked. */
export function officeRecipients(
  approvals: NoticeApproval[],
  only?: (a: NoticeApproval) => boolean
): Recipient[] {
  return approvals
    .filter((a) => (only ? only(a) : true))
    .sort((x, y) => x.level_no - y.level_no)
    .map((a) => {
      const email = a.approver_email?.trim();
      return email ? { email, name: a.approver_name } : null;
    })
    .filter((r): r is Recipient => r !== null);
}

/**
 * THE COPY LIST, deduplicated against the addressee and against itself.
 *
 * ═══ THE RULE, AS THE CLIENT STATED IT (2026-09-01) ═══
 *
 *   "put the one who raised the pass in all the communication, but for the
 *    approval emails the approver should be only notified about their own
 *    approval. Once it is approved by others and once it is completed,
 *    similarly do this for everybody."
 *
 * Which resolves to two rules, and they do not conflict:
 *
 *   * THE RAISER IS ON EVERY LETTER ABOUT THEIR OWN PASS. They own the request;
 *     they should never have to open the app to learn where it got to.
 *   * AN APPROVER IS ONLY EVER *ASKED* ABOUT THEIR OWN RUNG. `awaiting_you`
 *     copies nobody but the raiser — mailing the other three offices a decision
 *     they cannot take (046 admits only the lowest pending level) trains them
 *     to ignore the letter that is genuinely theirs.
 *   * WHEN IT FINISHES, EVERYBODY INVOLVED HEARS — approved, rejected, cleared
 *     at the gate or stopped there. Those are outcomes, not requests, so there
 *     is no wrong reader.
 *
 * Deduplication is by lowercased address and is load-bearing: one person can
 * hold an office AND cover another (072), and a vacant office falls back to the
 * holder snapshotted at raise, so two rungs routinely resolve to one address.
 * Two copies of one letter in one inbox read as a bug, not as thoroughness.
 */
export function ccOf(to: string, parts: (Recipient | null)[]): Recipient[] {
  const seen = new Set<string>([to.trim().toLowerCase()]);
  const out: Recipient[] = [];
  for (const r of parts) {
    if (!r) continue;
    const key = r.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: r.email.trim(), name: r.name });
  }
  return out;
}
