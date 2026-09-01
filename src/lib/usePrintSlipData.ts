// EVERYTHING THE PRINTED SLIP IS MADE OF, read once, for whoever is drawing it.
//
// Two callers now: `/pass/:id/print` and the Send to Vendor button, which
// mounts the very same slip off-screen and photographs it (`slipImage.ts`).
// They must not read the pass differently — a WhatsApp picture that disagreed
// with the paper in the guard's hand would be worse than sending nothing — so
// the reads live here rather than in either screen.
//
// `passId` is NULLABLE and that is the enable switch: the share button holds it
// null until the HOD presses the button, so a pass record does not pay for
// three extra queries nobody asked for.
//
// EVERY READ DEGRADES TO EMPTY, never to an error screen — the same rule
// `useApprovalRoles` and `usePassApprovals` already follow. The ladder, the
// gate log and the escalation window are all decoration on a sheet whose
// point is the pass and its material.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { GatePassItemView, GatePassView } from '../types';
import type { ApprovalRoleRow, PassApprovalRow } from './approvalLadder';
import { useApprovalRoles } from './useApprovalRoles';
import { usePassApprovals } from './usePassApprovals';
import { useEscalationHours } from './useEscalationHours';
import { usePassSignatures } from './usePassSignatures';
import { safeErrorMessage } from './errors';
import type { PassSignatures, ReceiptEvent } from './printSignatureBoxes';

export interface PrintSlipData {
  /** `undefined` while loading, `null` when there is no such pass (or no
   *  access to it) — the distinction the print page renders differently. */
  pass: GatePassView | null | undefined;
  items: GatePassItemView[];
  events: ReceiptEvent[];
  roles: ApprovalRoleRow[];
  approvals: PassApprovalRow[];
  escalationHours: number;
  /** The signatures this pass has EARNED (075), never simply the ones its
   *  people own — an empty map is the ordinary case. */
  signatures: PassSignatures;
  error: string | null;
  /** The slip can be drawn — and, for the share button, photographed. */
  ready: boolean;
}

export function usePrintSlipData(passId: string | null | undefined): PrintSlipData {
  const [pass, setPass] = useState<GatePassView | null | undefined>(undefined);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [events, setEvents] = useState<ReceiptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { roles } = useApprovalRoles();
  const approvals = usePassApprovals(passId);
  const escalationHours = useEscalationHours();
  const signatures = usePassSignatures(passId ?? undefined);

  useEffect(() => {
    if (!passId) {
      setPass(undefined);
      setItems([]);
      setEvents([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const [passResult, itemsResult, eventsResult] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('id', passId).maybeSingle(),
          gp().from('v_gate_pass_items').select('*').eq('gate_pass_id', passId).order('line_no'),
          gp().from('v_verifications').select('*').eq('gate_pass_id', passId).order('created_at'),
        ]);
        if (passResult.error) throw passResult.error;
        if (itemsResult.error) throw itemsResult.error;
        if (eventsResult.error) throw eventsResult.error;
        if (cancelled) return;
        setPass((passResult.data as GatePassView | null) ?? null);
        setItems((itemsResult.data as GatePassItemView[]) ?? []);
        setEvents((eventsResult.data as ReceiptEvent[]) ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(safeErrorMessage(e));
          setPass(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [passId]);

  return {
    pass, items, events, roles, approvals, escalationHours, signatures, error, ready: !!pass,
  };
}
