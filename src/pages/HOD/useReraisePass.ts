// "Raise it again" — the second half of the mismatch review flow.
//
// The mismatch screen navigates to `/raise` with `state.copyFrom = <pass id>`,
// and this hook is what turns that id into a pre-filled form. Router STATE, not
// a query parameter: it is a one-shot instruction from one screen to another,
// and a `?copyFrom=` in the address bar would survive a bookmark, a share and a
// refresh, silently re-arming a supersede on a pass that was dealt with weeks
// ago.
//
// IT PRE-FILLS FROM THE DATABASE, NEVER FROM WHAT THE OTHER SCREEN WAS HOLDING.
// The pass and its lines are re-read here, so what the HOD corrects is what the
// guard actually saw at the barrier.
//
// TWO FIELDS ARE DELIBERATELY NOT COPIED:
//
//   department  — the form already resolves it from the HOD's own assignment,
//                 and copying it would let a pass raised before a transfer
//                 re-raise into a department this person no longer heads.
//   a return date that has already passed — `validate()` refuses one, so
//                 copying it would hand the HOD a form that cannot be submitted
//                 and an error under a field they did not fill in. The line is
//                 copied with the date blank instead, which is a question, not
//                 a fault.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView, NewGatePass } from '../../types';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { requiresReturnDate } from '../../lib/passTypes';

export interface ReraiseSource {
  /** The flagged pass this form is correcting, once it has loaded. */
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
        const lines = ((itemRes.data as GatePassItemView[] | null) ?? []).map((i) => ({
          name: i.name ?? '',
          description: i.description ?? '',
          purpose: i.purpose ?? '',
          // A date in the past is dropped rather than copied — see the header.
          expected_return_date:
            requiresReturnDate(p.type) && i.expected_return_date && i.expected_return_date >= todayStr
              ? i.expected_return_date
              : '',
          quantity: String(i.quantity ?? 1),
          unit: i.unit ?? 'nos',
          approx_value: i.approx_value === null || i.approx_value === undefined ? '' : String(i.approx_value),
        }));

        setSource(p);
        setPrefill({
          type: p.type,
          visitor_name: p.visitor_name ?? '',
          visitor_company: vendor.name,
          company_address: vendor.address,
          visitor_phone: vendor.phone,
          vehicle_number: p.vehicle_number ?? '',
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
 *  It reuses `hod_review_flagged_pass(reject)` rather than adding an RPC: the
 *  outcome IS a rejection — this pass is void and will never be verified — and
 *  the RPC already writes the `verifications` row that makes the supersede
 *  auditable. Returns an error message on failure rather than throwing: the new
 *  pass exists either way, and the HOD must be told the old one is still open,
 *  not shown a failure that reads as though nothing was raised. */
export async function voidSupersededPass(passId: string, newPassNumber: string): Promise<string | null> {
  const { error } = await gp().rpc('hod_review_flagged_pass', {
    p_pass_id: passId,
    p_action: 'reject',
    p_reason: `Superseded by ${newPassNumber}`,
  });
  return error ? (error.message ?? 'Unknown error') : null;
}
