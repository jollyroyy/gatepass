// The core gate decision screen. One pass, one decision: Match or Flag.
// Confirm panels live in VerifyPanels.tsx to keep this file under 300 lines.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView } from '../../types';
import { TypeChip } from '../../components/Badge';

import { formatDateOnly, formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { MatchPanel, FlagPanel } from './VerifyPanels';

type Panel = 'none' | 'match' | 'flag';

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
  // would otherwise keep looking at a live Match button. match_pass would still
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

  async function handleMatchConfirm(lines: { item_id: string; verified_qty: number }[], vehicle: string, remarks: string) {
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
      navigate('/console', { state: { flash: `${pass.pass_number} matched — cleared to proceed.` } });
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
      navigate('/console', { state: { flash: `${pass.pass_number} marked as a mismatch for the HOD's review.` } });
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
          Back to Gate Console
        </Link>
      </div>
    );
  }

  const companyInfo = parseCompanyInfo(pass.visitor_company);
  const alreadyActioned = pass.status !== 'pending';
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
            This pass was already <strong>{pass.status}</strong> by {pass.verified_by_name ?? 'someone'} at{' '}
            {formatDateTime(pass.verified_at)}.{' '}
            <Link to={`/pass/${pass.id}`} className="underline font-semibold">
              View full details
            </Link>
          </span>
        </div>
      )}

      <div className="card p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field label="Visitor Name" value={pass.visitor_name} />
          <Field label="Contact No" value={companyInfo.phone || '—'} />
          <Field label="Company" value={companyInfo.name || '—'} />
          <Field label="Company Address" value={companyInfo.address || '—'} />
          <Field label="Material Description" value={pass.material_summary ?? ''} full />
          <Field label="Quantity" value={`${pass.item_count} line(s)`} />
          <Field label="Vehicle Number" value={pass.vehicle_number ?? '—'} />
          <Field label="Purpose" value={pass.purpose} full />
          <Field label="Department" value={pass.department_name} />
          <Field label="Raised By" value={pass.raised_by_name} />
          {pass.type === 'RGP' && (
            <Field label="Expected Return Date" value={formatDateOnly(pass.expected_return_date)} />
          )}
        </div>
      </div>

      {!alreadyActioned && expired && (
        <div className="alert-warning mb-6">
          This pass expired on {formatDateTime(pass.expires_at)} and can no longer be matched. Ask the
          HOD to raise a new one. You can still flag it if something is wrong.
        </div>
      )}

      {!alreadyActioned && (
        <div className="flex flex-col md:flex-row gap-4">
          {/* Match is withheld once expired; Flag deliberately is not. Refusing
              to record a real mismatch because the paperwork went stale is
              exactly backwards — the same split match_pass enforces server-side. */}
          <button
            type="button"
            className="btn-match"
            disabled={submitting || expired}
            onClick={() => setPanel('match')}
          >
            ✓ Match
          </button>
          <button type="button" className="btn-flag" disabled={submitting} onClick={() => setPanel('flag')}>
            ⚑ Flag Mismatch
          </button>
        </div>
      )}

      {panel === 'match' && (
        <MatchPanel
          pass={pass}
          items={items}
          submitting={submitting}
          error={actionError}
          onCancel={closePanel}
          onConfirm={handleMatchConfirm}
        />
      )}
      {panel === 'flag' && (
        <FlagPanel submitting={submitting} error={actionError} onCancel={closePanel} onConfirm={handleFlagConfirm} />
      )}
    </div>
  );
}
