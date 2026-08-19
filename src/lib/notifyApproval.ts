// Ask the server to send the approval emails for one pass.
//
// ═══ THIS CALL CAN NEVER FAIL A USER'S ACTION. ═══
//
// It is invoked AFTER `raise_pass` / `approve_pass_level` / `reject_pass_level`
// have already committed. The pass is raised, or the approval is recorded,
// whatever happens here. So every path below swallows: no throw, no error state,
// no red banner. An HOD who has just raised a gate pass must not be told
// "something went wrong" about a letter they never asked to send — they would
// reasonably conclude the pass failed and raise a second one.
//
// The cost is stated plainly: A MAIL THAT DOES NOT SEND IS SILENT AT THIS END.
// That is why migration 047 keeps `gatepass.email_log` — every attempt, with
// the provider's own refusal, readable by an admin. The console line below is
// for a developer with the tab open; the log is for everyone else.
//
// WHY THE BODY IS ONLY AN ID. The Edge Function derives the event and the
// recipients from the pass's own approval rows. Nothing this module sends can
// change who gets mailed or what the mail claims — see that function's header.
import { supabase } from '../supabaseClient';

/** The Edge Function's name, deployed as `supabase functions deploy notify-approval`. */
const FUNCTION_NAME = 'notify-approval';

/**
 * Fire the notification for a pass. Resolves to `true` only when the function
 * accepted the request — callers are free to ignore it, and every caller in
 * this app does.
 *
 * NOT AWAITED AT ANY CALL SITE ON PURPOSE: an approver pressing Approve should
 * see the queue update at the speed of the RPC, not at the speed of a mail
 * provider's API.
 */
export async function notifyApproval(passId: string): Promise<boolean> {
  if (!passId) return false;
  try {
    const { error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body: { pass_id: passId },
    });
    if (error) {
      console.warn('[gatepass] approval notification was not sent:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    // Includes the case where the function has never been deployed. The app is
    // fully usable without it — the queue and the bell still work — so this is
    // a warning and not an error.
    console.warn('[gatepass] approval notification was not sent:', e);
    return false;
  }
}
