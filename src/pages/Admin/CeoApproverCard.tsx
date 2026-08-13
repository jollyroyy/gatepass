// The CEO approval chain (migration 039) needs exactly one designated
// account — there is no `ceo` role, since the role enum is owned by VMS.
// gatepass.ceo_approver holds that single row, and only a super_admin may
// change it. Zero rows means nobody is designated, which blocks every
// whitelist request from ever being approved — that state must read as a
// warning, not a quiet empty list.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { fetchDirectory } from '../../lib/profiles';
import type { CeoApprover, Profile } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';

interface Props {
  isSuperAdmin: boolean;
  onChange?: () => void;
}

export default function CeoApproverCard({ isSuperAdmin, onChange }: Props): React.ReactElement {
  const [approver, setApprover] = useState<CeoApprover | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared up front, never on success: this load and the candidate fetch
    // below race at mount, and a trailing clear here would swallow the other's
    // error.
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('get_ceo_approver');
      if (err) throw err;
      const rows = (data as CeoApprover[] | null) ?? [];
      setApprover(rows[0] ?? null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    (async () => {
      try {
        const [admins, superAdmins] = await Promise.all([
          fetchDirectory('admin'),
          fetchDirectory('super_admin'),
        ]);
        setCandidates([...admins, ...superAdmins]);
      } catch (err) {
        setError(safeErrorMessage(err));
      }
    })();
  }, [isSuperAdmin]);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const { error: err } = await gp().rpc('set_ceo_approver', { p_user_id: selected });
      if (err) throw err;
      setSelected('');
      await load();
      onChange?.();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="section-title mb-0">CEO approver</h2>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-6 w-1/2" />
          <div className="skeleton h-4 w-1/3" />
        </div>
      ) : approver ? (
        <div>
          <p className="font-semibold text-navy-900">{approver.full_name ?? 'Unnamed account'}</p>
          <p className="text-sm text-navy-500">Designated {formatDateTime(approver.designated_at)}</p>
        </div>
      ) : (
        <div className="alert-warning">
          No CEO approver is designated — no whitelist request can be approved until one is set.
        </div>
      )}

      {!isSuperAdmin && (
        <p className="text-xs text-navy-500">Only a super admin can change the CEO approver.</p>
      )}

      {isSuperAdmin && (
        <div className="flex flex-col gap-2">
          <label htmlFor="ceo-approver-select" className="text-sm font-semibold text-navy-900">
            Designate CEO approver
          </label>
          <select
            id="ceo-approver-select"
            className="input w-full"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select an admin account…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary self-start"
            onClick={handleSave}
            disabled={saving || !selected}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
