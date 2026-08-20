// EMERGENCY RELEASE — the four database calls behind migration 055, and the
// two rules the screens need in order not to draw a control the RPC refuses.
//
// The pattern is `approvalActions.ts`'s: a thin module that owns the RPC names
// and the argument shapes, so no component types `p_role_key` into a string
// literal and no screen invents its own idea of who may press what.
//
// WHY THE MINIMUM REASON LENGTH LIVES HERE AS WELL AS IN THE DATABASE. 055
// refuses a reason under 10 characters. Restating it means the button can be
// disabled with the count showing, instead of the admin writing "ok", pressing,
// and being told no. The database is still the authority — this is the same
// belt-and-braces `checkReturnQty` and `approvalDecision.ts` already use.
import { gp } from '../supabaseClient';
import { notifyApproval } from './notifyApproval';

/** 055's own floor and ceiling. The ceiling matches the rejection reason in
 *  046, so the two free-text fields on this ladder share one limit. */
export const EMERGENCY_REASON_MIN = 10;
export const EMERGENCY_REASON_MAX = 500;

/** One row of `gatepass.list_emergency_releases()` — the admin review queue. */
export interface EmergencyReleaseRow {
  gate_pass_id: string;
  pass_number: string | null;
  released_by: string;
  released_name: string | null;
  reason: string;
  released_at: string;
  reviewed_by: string | null;
  reviewed_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

/** One row of `gatepass.pass_emergency_release()` — what the pass record's own
 *  banner needs. Deliberately carries NO name: that function is SECURITY
 *  INVOKER and every reader of the pass can call it, including the guard. */
export interface PassEmergencyRelease {
  released_at: string;
  reason: string;
  reviewed_at: string | null;
}

/** Is this reason long enough for the database to accept it? */
export function isReasonWritten(reason: string): boolean {
  return reason.trim().length >= EMERGENCY_REASON_MIN;
}

/**
 * May this reader release this pass past its ladder?
 *
 * Both halves are 055's own: a super admin, and a pass that is still `pending`
 * and still owes at least one signature. A pass owing nothing has nothing to
 * release, and a cancelled one was REJECTED by an office — overturning a
 * written decision is a different and much larger power than unsticking a
 * silent queue, and this system does not have it.
 */
export function canReleaseUnderEmergency(
  passStatus: string,
  owedLevels: { status: 'pending' | 'approved' | 'rejected' }[],
  role: string | null,
): boolean {
  if (role !== 'super_admin') return false;
  if (passStatus !== 'pending') return false;
  return owedLevels.some((a) => a.status === 'pending');
}

/** May this reader review this release? An admin who is not the person who
 *  made it — the four-eyes rule, restated so the button is never drawn where
 *  the RPC would refuse it. */
export function canReviewRelease(
  row: EmergencyReleaseRow,
  role: string | null,
  myUserId: string | null,
): boolean {
  if (role !== 'admin' && role !== 'super_admin') return false;
  if (row.reviewed_at) return false;
  return !!myUserId && row.released_by !== myUserId;
}

export async function releasePassUnderEmergency(passId: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!isReasonWritten(trimmed)) {
    throw new Error(`An emergency release needs a written reason of at least ${EMERGENCY_REASON_MIN} characters.`);
  }
  const { error } = await gp().rpc('emergency_release_pass', {
    p_pass_id: passId,
    p_reason: trimmed.slice(0, EMERGENCY_REASON_MAX),
  });
  if (error) throw error;

  // AFTER the RPC commits, and never awaited — `approvalActions.ts`'s rule.
  // The release is the thing that matters; a mail provider being down must not
  // turn a completed override into an error the admin retries. The Edge
  // Function works out which letter to write from the pass's own state.
  void notifyApproval(passId);
}

export async function reviewEmergencyRelease(passId: string, note: string): Promise<void> {
  const { error } = await gp().rpc('review_emergency_release', {
    p_pass_id: passId,
    p_note: note.trim().slice(0, EMERGENCY_REASON_MAX),
  });
  if (error) throw error;
}

/** The admin review queue, unreviewed first. Throws — the card shows the
 *  sentence, because an empty review queue and a failed read must not look
 *  the same. */
export async function fetchEmergencyReleases(): Promise<EmergencyReleaseRow[]> {
  const { data, error } = await gp().rpc('list_emergency_releases');
  if (error) throw error;
  return (data as EmergencyReleaseRow[] | null) ?? [];
}

/** The banner's one row, or null. Swallows failure on purpose: this is drawn
 *  beside the whole gate pass record, and a banner that cannot load must not
 *  take the record down with it. The cost is that an override could go
 *  unmentioned during an outage — which the admin queue still catches. */
export async function fetchPassEmergencyRelease(passId: string): Promise<PassEmergencyRelease | null> {
  try {
    const { data, error } = await gp().rpc('pass_emergency_release', { p_pass_id: passId });
    if (error) throw error;
    const rows = (data as PassEmergencyRelease[] | null) ?? [];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
