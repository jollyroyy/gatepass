// The core gate decision screen. One pass, one decision: APPROVE or REJECT.
//
// Client, 2026-08-20: "for the guard's view … put it as approve and reject.
// Don't put mismatched or something … if rejects, make the rejection reason
// mandatory." Approve is `match_pass`; the second answer is `flag_pass`, and
// the written reason it demands has been mandatory since.
//
// THE REJECTION IS NOW FINAL (client, 2026-08-31: "once a guard rejects a pass
// he has to mention the justification as to why is he rejecting the pass and
// then the entire pass will be cancelled and a new pass needs to be raised").
// Between 2026-08-23 and then the button read "Flag to Requester" and the pass
// went back to the raising HOD, who could send it to this gate again; migration
// 070 dropped that answer with the RPC behind it. The pass is closed where the
// guard leaves it, and the department raises another. THE REQUESTER IS STILL
// THE ONE TOLD, NEVER THE THREE APPROVAL OFFICES: their rungs were signed
// before the pass reached the barrier and nothing here reopens them.
// The statuses (`matched` / `flagged`), the HOD's review screen and every
// report keep their own vocabulary; this is what the person at the barrier
// reads.
// Confirm panels live in VerifyPanels.tsx to keep this file under 300 lines.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView, PassStatus } from '../../types';
import { TypeChip } from '../../components/Badge';

import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { ApprovePanel, FlagPanel } from './VerifyPanels';
import VerifyItemsTable from './VerifyItemsTable';

type Panel = 'none' | 'approve' | 'flag';

/** What a settled pass reads as to the GUARD. The database's own words
 *  ('matched' / 'flagged') are the two the client asked never to appear on this
 *  screen; every other surface keeps them. A status with no entry here falls
 *  back to itself rather than to a blank. */
const GUARD_OUTCOME: Partial<Record<PassStatus, string>> = {
  matched: 'approved',
  flagged: 'rejected',
  cancelled: 'cancelled',
  held: 'held',
  hod_reviewed: 'reviewed by the HOD',
};

function Field({ label, value, full }: { label: string; value: string; full?: boolean }): React.ReactElement {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <p className="label">{label}</p>
      <p className="text-lg font-semibold text-navy-900">{value}</p>
    </div>
  );
}

export default function Verify(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [pass, setPass] = useState<GatePassView | null>(null);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel>('none');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [passRes, itemsRes] = await Promise.all([
        gp().from('v_gate_passes').select('*').eq('id', id).maybeSingle(),
        gp().from('v_gate_pass_items').select('*').eq('gate_pass_id', id).order('line_no'),
      ]);
      if (passRes.error) throw passRes.error;
      if (itemsRes.error) throw itemsRes.error;
      setPass((passRes.data as GatePassView | null) ?? null);
      setItems((itemsRes.data as GatePassItemView[]) ?? []);
      setLoadError(passRes.data ? null : 'Gate pass not found.');
    } catch (err) {
      setLoadError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime on this one row. The gate console already refreshes its queue on
  // any change, but a guard standing on THIS screen while the HOD voids the pass
  // would otherwise keep looking at a live Approve button. match_pass would still
  // refuse it, so this is not a safety fix — it is the difference between the
  // screen updating itself and the guard being told "no" after pressing.
  // Defensive: a partially-mocked client in tests may not implement channel().
  useEffect(() => {
    if (!id) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel(`verify-${id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'gatepass', table: 'gate_passes', filter: `id=eq.${id}` },
          () => {
            void load();
          }
        )
        .subscribe();
    } catch {
      // No realtime available — the screen still works from the initial load.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [id, load]);

  function closePanel() {
    setPanel('none');
    setActionError(null);
  }

  async function handleApproveConfirm(lines: { item_id: string; verified_qty: number }[], vehicle: string, remarks: string) {
    if (!pass) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const { error } = await gp().rpc('match_pass', {
        p_pass_id: pass.id,
        p_lines: lines,
        p_vehicle: vehicle || null,
        p_remarks: remarks || null,
      });
      if (error) throw error;
      navigate('/console', { state: { flash: `${pass.pass_number} approved — cleared to proceed.` } });
    } catch (err) {
      setActionError(safeErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function handleFlagConfirm(reason: string) {
    if (!pass) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const { error } = await gp().rpc('flag_pass', { p_pass_id: pass.id, p_reason: reason });
      if (error) throw error;
      navigate('/console', { state: { flash: `${pass.pass_number} rejected and cancelled — the raising department has been notified.` } });
    } catch (err) {
      setActionError(safeErrorMessage(err));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div className="skeleton h-16 w-2/3" />
        <div className="skeleton h-64 w-full" />
        <div className="skeleton h-16 w-full" />
      </div>
    );
  }

  if (!pass) {
    return (
      <div className="max-w-2xl">
        <div className="alert-error">{loadError ?? 'Gate pass not found.'}</div>
        <Link to="/console" className="btn-secondary inline-block mt-4">
          Back to Search Pass
        </Link>
      </div>
    );
  }

  const companyInfo = parseCompanyInfo(pass.visitor_company);
  // `hod_reviewed` is NOT "already actioned": the HOD's approval is the
  // middle of the rejection flow, not the end of it. The guard's Approve is
  // the action that completes it (match_pass admits pending and hod_reviewed).
  // Before this distinction existed, an HOD-approved pass could never be
  // cleared through the UI at all — the queue hid it and this screen hid
  // the Approve button.
  const alreadyActioned = pass.status !== 'pending' && pass.status !== 'hod_reviewed';
  const hodApproved = pass.status === 'hod_reviewed';
  // is_expired comes from the view, which is also what match_pass enforces.
  // Never recompute it from expires_at here — a screen that disagrees with the
  // database is a guard arguing with a driver about whose clock is right.
  const expired = pass.is_expired;

  return (
    <div className="max-w-3xl">
      <div className="page-header flex items-center gap-3 flex-wrap">
        <TypeChip type={pass.type} />
        <h1 className="page-title">{pass.pass_number}</h1>
      </div>

      {alreadyActioned && (
        <div className="alert-warning mb-6">
          <span>
            This pass was already <strong>{GUARD_OUTCOME[pass.status] ?? pass.status}</strong> by{' '}
            {pass.verified_by_name ?? 'someone'} at{' '}
            {formatDateTime(pass.verified_at)}.{' '}
            <Link to={`/pass/${pass.id}`} className="underline font-semibold">
              View full details
            </Link>
          </span>
        </div>
      )}

      {hodApproved && !alreadyActioned && (
        <div className="alert-warning mb-6">
          <span>
            <strong>Approved by the HOD.</strong> The rejection has been reviewed and cleared by the raising
            department. Approve the pass to release the material.
          </span>
        </div>
      )}

      <div className="card p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Authorized Person's Name" value={pass.visitor_name} />
          <Field label="Contact No" value={companyInfo.phone || '—'} />
          <Field label="Vendor" value={companyInfo.name || '—'} />
          <Field label="Vendor Address" value={companyInfo.address || '—'} />
          <Field label="Vehicle Number" value={pass.vehicle_number ?? '—'} />
          <Field label="Department" value={pass.department_name} />
          <Field label="Raised By" value={pass.raised_by_name} />
          {pass.type === 'RGP' && (
            <Field label="Expected Return Date" value={formatDateOnly(pass.expected_return_date)} />
          )}
          {/* Only Bulk Create fills the pass-level purpose; RaisePass leaves it
              null and puts the real reasons on the items. Rendering it
              unconditionally produced a labelled blank on every HOD pass. */}
          {pass.purpose && <Field label="Purpose" value={pass.purpose} full />}
        </div>
      </div>

      <VerifyItemsTable
        items={items}
        showReturnDates={pass.type === 'RGP'}
        totalQuantity={pass.total_quantity}
      />

      {!alreadyActioned && expired && (
        <div className="alert-warning mb-6">
          This pass expired on {formatDateTime(pass.expires_at)} and can no longer be approved. Ask the
          HOD to raise a new one. You can still reject it if something is wrong.
        </div>
      )}

      {!alreadyActioned && (
        <div className="flex flex-col md:flex-row gap-4">
          {/* Approve is withheld once expired; the flag deliberately is not.
              Refusing to record a real problem because the paperwork went stale
              is exactly backwards — the same split match_pass enforces
              server-side. Since 035 it is offered for a hod_reviewed pass too:
              the requester's clearance is a judgement about the paper, not a
              fact about the material, so the guard at the barrier must still be
              able to stop it — flag_pass admits hod_reviewed and the pass goes
              back to the requester for another round. */}
          <button
            type="button"
            className="btn-match"
            disabled={submitting || expired}
            onClick={() => setPanel('approve')}
          >
            Approve
          </button>
          {pass.status !== 'matched' && (
            <button type="button" className="btn-flag" disabled={submitting} onClick={() => setPanel('flag')}>
              Reject Pass
            </button>
          )}
        </div>
      )}

      {panel === 'approve' && (
        <ApprovePanel
          pass={pass}
          items={items}
          submitting={submitting}
          error={actionError}
          onCancel={closePanel}
          onConfirm={handleApproveConfirm}
        />
      )}
      {panel === 'flag' && (
        <FlagPanel submitting={submitting} error={actionError} onCancel={closePanel} onConfirm={handleFlagConfirm} />
      )}
    </div>
  );
}
