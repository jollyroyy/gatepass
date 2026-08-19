// "Raise it again" — the second half of BOTH review flows.
//
// The mismatch screen and the expired-pass screen each navigate to `/raise` with
// `state.copyFrom = <pass id>`,
// and this hook is what turns that id into a pre-filled form. Router STATE, not
// a query parameter: it is a one-shot instruction from one screen to another,
// and a `?copyFrom=` in the address bar would survive a bookmark, a share and a
// refresh, silently re-arming a supersede on a pass that was dealt with weeks
// ago.
//
// IT PRE-FILLS FROM THE DATABASE, NEVER FROM WHAT THE OTHER SCREEN WAS HOLDING.
// The pass and its lines are re-read here, so what the HOD corrects is what was
// actually authorised — what the guard saw at the barrier, or what expired
// before anyone got there.
//
// TWO FIELDS ARE DELIBERATELY NOT COPIED:
//
//   department  — the form already resolves it from the HOD's own assignment,
//                 and copying it would let a pass raised before a transfer
//                 re-raise into a department this person no longer heads.
//   a return date that has already passed — `validate()` refuses one, so
//                 copying it would hand the HOD a form that cannot be submitted
//                 and an error under a field they did not fill in. The
//                 pass-level date is left blank instead, which is a question,
//                 not a fault.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView, NewGatePass } from '../../types';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { requiresReturnDate } from '../../lib/passTypes';
import { isExpiredPending } from '../../lib/statusStyles';

export interface ReraiseSource {
  /** The dead pass this form is replacing (flagged or expired), once loaded. */
  source: GatePassView | null;
  /** Fields to merge over the empty form, or null when this is a fresh raise. */
  prefill: Partial<NewGatePass> | null;
}

function readCopyFrom(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as { copyFrom?: unknown }).copyFrom;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function useReraisePass(todayStr: string): ReraiseSource & { sourceId: string | null } {
  const location = useLocation();
  const sourceId = readCopyFrom(location.state);
  const [source, setSource] = useState<GatePassView | null>(null);
  const [prefill, setPrefill] = useState<Partial<NewGatePass> | null>(null);

  useEffect(() => {
    if (!sourceId) {
      setSource(null);
      setPrefill(null);
      return undefined;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [passRes, itemRes] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('id', sourceId).maybeSingle(),
          gp().from('v_gate_pass_items').select('*').eq('gate_pass_id', sourceId).order('line_no'),
        ]);
        if (cancelled || passRes.error || !passRes.data) return;

        const p = passRes.data as GatePassView;
        const vendor = parseCompanyInfo(p.visitor_company);
        // Only what the form still ASKS FOR. A line's `unit`, its own purpose
        // and its approximate value are no longer on the raise form (the
        // client's 2026-08-19 mock-up), so copying them here would put fields
        // into the form state that nothing renders and nothing submits.
        const lines = ((itemRes.data as GatePassItemView[] | null) ?? []).map((i) => ({
          name: i.name ?? '',
          make_model: i.make_model ?? '',
          serial_no: i.serial_no ?? '',
          invoice_no: i.invoice_no ?? '',
          remarks: i.remarks ?? '',
          quantity: String(i.quantity ?? 1),
        }));

        setSource(p);
        setPrefill({
          type: p.type,
          visitor_name: p.visitor_name ?? '',
          visitor_company: vendor.name,
          company_address: vendor.address,
          visitor_phone: vendor.phone,
          vehicle_number: p.vehicle_number ?? '',
          // The pass-level reason is now a required field, so a correction
          // starts from the reason that was authorised rather than blank.
          purpose: p.purpose ?? '',
          // A date in the past is dropped rather than copied — see the header.
          // This is now the PASS's own deadline, not a line's — one field, not
          // one per item.
          expected_return_date:
            requiresReturnDate(p.type) && p.expected_return_date && p.expected_return_date >= todayStr
              ? p.expected_return_date
              : '',
          // A pass with no lines is not a thing this app can create, but a read
          // that returned none must still leave the form usable rather than
          // rendering zero rows and no way to add one.
          ...(lines.length > 0 ? { items: lines } : {}),
        });
      } catch {
        // A failed pre-fill leaves an empty form, which the HOD can still fill
        // in by hand. Blocking the raise screen over it would be worse.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceId, todayStr]);

  return { sourceId, source, prefill };
}

/** Void the pass that was just superseded.
 *
 *  CALLED ONLY AFTER THE REPLACEMENT IS ACTUALLY IN THE DATABASE. Voiding at the
 *  moment "Raise It Again" is pressed would destroy the record of what the gate
 *  stopped for anyone who then closed the tab, and would leave the gate with
 *  nothing at all if the new pass were never submitted.
 *
 *  TWO RPCs, PICKED FROM THE SOURCE PASS, because the two screens that lead here
 *  supersede two different kinds of dead pass and each RPC refuses the other's:
 *
 *    flagged  → `hod_review_flagged_pass(reject)`, which refuses anything that
 *               is not currently flagged.
 *    expired  → `hod_void_expired_pass` (041), which refuses anything that is
 *               not pending AND genuinely past its own `expires_at`.
 *
 *  Both write the `verifications` row that makes the supersede auditable, and
 *  both leave the outcome as 'cancelled'. `source` is null only on a fresh
 *  raise, where nothing is superseded at all.
 *
 *  Returns an error message on failure rather than throwing: the new pass exists
 *  either way, and the HOD must be told the old one is still open, not shown a
 *  failure that reads as though nothing was raised. */
export async function voidSupersededPass(
  passId: string,
  newPassNumber: string,
  source: GatePassView | null,
): Promise<string | null> {
  const reason = `Superseded by ${newPassNumber}`;
  const { error } = isExpiredPending(source ?? { status: 'pending', is_expired: false })
    ? await gp().rpc('hod_void_expired_pass', { p_pass_id: passId, p_reason: reason })
    : await gp().rpc('hod_review_flagged_pass', {
        p_pass_id: passId,
        p_action: 'reject',
        p_reason: reason,
      });
  return error ? (error.message ?? 'Unknown error') : null;
}
