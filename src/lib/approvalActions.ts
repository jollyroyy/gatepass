// Deciding one level of the approval ladder — the two RPCs migration 046 owns,
// and the email that follows each of them.
//
// ═══ THIS MODULE EXISTS TO BE THE ONLY WAY. ═══
//
// `approve_pass_level` and `reject_pass_level` are the RPCs; a screen could call
// them directly and everything would appear to work. The notification would
// simply never send, and nothing would say so — the queue updates, the pass
// moves, and the next office finds out when somebody phones them. So the two are
// wrapped here, once, with the notice attached. ANY SCREEN THAT DECIDES AN
// APPROVAL MUST CALL THESE, never the RPCs. There is no mechanism that can force
// that; this comment is what stands in for one.
//
// ORDER MATTERS AND IS NOT NEGOTIABLE: the RPC first, and only on success the
// notice. Mail sent before the write commits would tell the COO a pass is theirs
// while the approval routing it to them is still in flight — or never lands.
//
// THE NOTICE IS NOT AWAITED. An approver pressing Approve sees the queue update
// at the speed of the RPC, not at the speed of a mail provider's API, and a mail
// outage can never turn a recorded approval into an error on screen. What that
// costs — a silent failure at this end — is why migration 047 keeps
// `gatepass.email_log`.
import { gp } from '../supabaseClient';
import { notifyApproval } from './notifyApproval';
import { safeErrorMessage } from './errors';

/**
 * Approve the caller's level on this pass.
 *
 * Throws a human sentence on refusal. The four refusals are the RPC's own — the
 * caller holds no office, the pass is not routed to them, an earlier level has
 * not signed yet, or the pass has already left the ladder — and none of them is
 * restated here. A second copy of a rule is a second thing to get wrong.
 */
export async function approvePass(passId: string): Promise<void> {
  const { error } = await gp().rpc('approve_pass_level', { p_pass_id: passId });
  if (error) throw new Error(safeErrorMessage(error, 'Could not approve this gate pass.'));
  void notifyApproval(passId);
}

/**
 * Reject the caller's level, which closes the pass for good (046 moves it to
 * `cancelled` and writes a `verifications` row).
 *
 * The reason is required at BOTH ends: the RPC raises without one, and the guard
 * here exists so the reader is told before a round trip rather than after. 500
 * characters is the column's own limit.
 */
export async function rejectPass(passId: string, reason: string): Promise<void> {
  const written = reason.trim();
  if (!written) throw new Error('A rejection needs a reason.');

  const { error } = await gp().rpc('reject_pass_level', {
    p_pass_id: passId,
    p_reason: written.slice(0, 500),
  });
  if (error) throw new Error(safeErrorMessage(error, 'Could not reject this gate pass.'));
  void notifyApproval(passId);
}
