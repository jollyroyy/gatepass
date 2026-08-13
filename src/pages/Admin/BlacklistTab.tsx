// The blacklist register: add a vendor, and REQUEST that one comes off.
//
// Removal is not an action an admin can take any more (039). The one-click
// `remove_blacklist_entry` RPC was dropped, because the ability to quietly
// undo a blacklisting is the ability to quietly disable the only control that
// stops a vendor at the gate. An admin now states why, and the designated CEO
// approves — see WhitelistRequestsTab for the other side of that queue.
//
// The two justification floors are the same number in two places on purpose:
// this form refuses anything under 10 characters so the admin finds out
// immediately, and `whitelist_requests_justification_substantive` refuses it
// again in the database so a caller that skips this screen gains nothing.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { BlacklistEntry, BlacklistType, WhitelistRequest } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import BlacklistAddForm, {
  INITIAL_BLACKLIST_FORM,
  validateBlacklistForm,
  type BlacklistFormState,
} from './BlacklistAddForm';

const TYPE_STYLES: Record<BlacklistType, string> = {
  company: 'bg-red-50 text-red-700',
  vehicle: 'bg-orange-50 text-orange-700',
  driver: 'bg-yellow-50 text-yellow-700',
};

// Only `company` can be added now, but vehicle/driver rows added before
// 2026-08-13 still exist in the database and must still render honestly.
const TYPE_LABELS: Record<BlacklistType, string> = {
  company: 'Vendor',
  vehicle: 'Vehicle',
  driver: 'Driver',
};

/** Matches the DB's own floor — see whitelist_requests_justification_substantive. */
const MIN_JUSTIFICATION = 10;

export default function BlacklistTab(): React.ReactElement {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BlacklistFormState>(INITIAL_BLACKLIST_FORM);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ value?: string; reason?: string }>({});

  // Which entry's justification panel is open, and what has been typed in it.
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [justificationError, setJustificationError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Clears the banner UP FRONT, never on success. The mount-time refresh and a
  // failed action resolve in the same microtask queue, and a trailing
  // `setError(null)` there wipes the refusal the admin needs to read.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, pending] = await Promise.all([
        gp().rpc('list_blacklist_entries'),
        gp().rpc('list_whitelist_requests', { p_status: 'pending' }),
      ]);
      if (list.error) throw list.error;
      if (pending.error) throw pending.error;
      setEntries((list.data as BlacklistEntry[]) ?? []);
      setPendingIds(
        new Set(
          ((pending.data as WhitelistRequest[]) ?? [])
            .map((r) => r.blacklist_id)
            .filter((id): id is string => Boolean(id))
        )
      );
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    const errs = validateBlacklistForm(form);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const { error: err } = await gp().rpc('add_blacklist_entry', {
        p_list_type: form.list_type,
        p_list_value: form.list_value.trim(),
        p_reason: form.reason.trim(),
      });
      if (err) throw err;
      setShowForm(false);
      setForm(INITIAL_BLACKLIST_FORM);
      setFieldErrors({});
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openRequest(id: string) {
    setRequestFor(id);
    setJustification('');
    setJustificationError(null);
  }

  async function submitRequest(id: string) {
    const text = justification.trim();
    if (!text) {
      setJustificationError('A justification is required — say why this vendor should be whitelisted.');
      return;
    }
    if (text.length < MIN_JUSTIFICATION) {
      setJustificationError(`Please give at least 10 characters of justification.`);
      return;
    }

    setRequesting(true);
    try {
      const { error: err } = await gp().rpc('request_vendor_whitelist', {
        p_blacklist_id: id,
        p_justification: text,
      });
      if (err) throw err;
      setRequestFor(null);
      setJustification('');
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title mb-0">Blacklist</h2>
        <button type="button" className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Entry'}
        </button>
      </div>

      {error && <div className="alert-error mb-4">{error}</div>}

      {showForm && (
        <BlacklistAddForm
          form={form}
          errors={fieldErrors}
          saving={saving}
          onChange={(f) => { setForm(f); setFieldErrors({}); }}
          onSubmit={handleAdd}
        />
      )}

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="table-wrap empty-state">No blacklist entries. The blacklist is empty.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
                <th>Reason</th>
                <th>Blocked At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[e.list_type]}`}>
                      {TYPE_LABELS[e.list_type]}
                    </span>
                  </td>
                  <td className="font-semibold text-navy-900">{e.list_value}</td>
                  <td className="text-navy-600 max-w-[300px]">{e.reason}</td>
                  <td className="tabular whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                  <td>
                    {pendingIds.has(e.id) ? (
                      <span className="text-xs font-medium text-pending-700">Awaiting CEO approval</span>
                    ) : requestFor === e.id ? (
                      <div className="flex flex-col gap-2 min-w-[260px]">
                        <textarea
                          className="input w-full min-h-[60px] text-sm"
                          placeholder="Why should this vendor be whitelisted?"
                          value={justification}
                          onChange={(ev) => { setJustification(ev.target.value); setJustificationError(null); }}
                        />
                        {justificationError && (
                          <p className="text-xs font-medium text-flagged-700">{justificationError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-primary text-sm"
                            disabled={requesting}
                            onClick={() => submitRequest(e.id)}
                          >
                            {requesting ? 'Sending…' : 'Send for CEO Approval'}
                          </button>
                          <button
                            type="button"
                            className="text-navy-500 hover:text-navy-700 text-sm"
                            onClick={() => setRequestFor(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-accent-600 hover:text-accent-800 text-sm font-medium"
                        onClick={() => openRequest(e.id)}
                      >
                        Request Whitelist
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
