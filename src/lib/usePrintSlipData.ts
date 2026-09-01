// EVERYTHING THE PRINTED SLIP IS MADE OF, read once, for whoever is drawing it.
//
// One caller today — `/pass/:id/print` — and it was two: Send to Vendor mounted
// the same slip off-screen and photographed it until the picture was dropped on
// 2026-09-01 (see `whatsappShare.ts`). The reads stay out here anyway, because
// the point of them was that two drawings of one pass cannot disagree, and the
// next renderer of the sheet must inherit that.
//
// `passId` is NULLABLE and that is the enable switch: a caller holds it null
// until the sheet is actually wanted, so no screen pays for three extra queries
// nobody asked for.
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
