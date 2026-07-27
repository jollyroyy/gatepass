// Delete-panel state + handler for MyPasses.tsx, split into its own hook so
// that adding the delete flow doesn't push MyPasses.tsx over the 300-line
// cap — same "extract sub-components" convention as VoidPassPanel.tsx.
import { useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';

export function useDeletePass(load: () => Promise<void>) {
  // Target pass, not just a boolean — same reason as the void panel: the
  // panel needs the pass number and a fresh error slate per pass.
  const [deleteTarget, setDeleteTarget] = useState<GatePassView | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openDeletePanel(p: GatePassView, e: React.MouseEvent) {
    // Rows navigate to the pass detail on click — stop that before the
    // delete panel opens, same as openVoidPanel.
    e.stopPropagation();
    setDeleteError(null);
    setDeleteTarget(p);
  }

  function closeDeletePanel() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      // Direct table delete, not an RPC — the one delete permission in the
      // schema, expressed as an RLS policy (own + pending + hod). RLS
      // enforces that scope; we don't re-check it client-side. But a policy
      // that refuses the delete does NOT surface as an error — the client
      // just gets 0 rows back — so ask for the deleted row and treat an
      // empty result as failure.
      const { data, error: delErr } = await gp()
        .from('gate_passes')
        .delete()
        .eq('id', deleteTarget.id)
        .select();
      if (delErr) throw delErr;
      if (!data || data.length === 0) {
        setDeleteError('Could not delete this pass — it may have already been verified at the gate.');
        return;
      }
      closeDeletePanel();
      await load();
    } catch (err) {
      setDeleteError(safeErrorMessage(err));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return {
    deleteTarget,
    deleteSubmitting,
    deleteError,
    openDeletePanel,
    closeDeletePanel,
    handleDeleteConfirm,
  };
}
