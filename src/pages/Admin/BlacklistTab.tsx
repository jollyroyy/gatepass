import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { BlacklistEntry, BlacklistType } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';

const TYPE_STYLES: Record<BlacklistType, string> = {
  company: 'bg-red-50 text-red-700',
  vehicle: 'bg-orange-50 text-orange-700',
  driver: 'bg-yellow-50 text-yellow-700',
};

const TYPE_LABELS: Record<BlacklistType, string> = {
  company: 'Company',
  vehicle: 'Vehicle',
  driver: 'Driver',
};

const INITIAL_FORM = { list_type: 'company' as BlacklistType, list_value: '', reason: '' };

export default function BlacklistTab(): React.ReactElement {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: err } = await gp().rpc('list_blacklist_entries');
      if (err) throw err;
      setEntries((data as BlacklistEntry[]) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.list_value.trim() || !form.reason.trim()) return;
    setSaving(true);
    try {
      const { error: err } = await gp().rpc('add_blacklist_entry', {
        p_list_type: form.list_type,
        p_list_value: form.list_value.trim(),
        p_reason: form.reason.trim(),
      });
      if (err) throw err;
      setShowForm(false);
      setForm(INITIAL_FORM);
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      const { error: err } = await gp().rpc('remove_blacklist_entry', { p_id: id });
      if (err) throw err;
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setRemoving(null);
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
        <div className="card mb-6 p-4 space-y-3">
          <select
            className="input w-full"
            value={form.list_type}
            onChange={(e) => setForm({ ...form, list_type: e.target.value as BlacklistType })}
          >
            <option value="company">Company</option>
            <option value="vehicle">Vehicle</option>
            <option value="driver">Driver</option>
          </select>
          <input
            className="input w-full"
            placeholder="Value (e.g. company name / license plate / driver name)"
            value={form.list_value}
            onChange={(e) => setForm({ ...form, list_value: e.target.value })}
          />
          <textarea
            className="input w-full min-h-[60px]"
            placeholder="Reason for blacklisting"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <button type="button" className="btn-primary" onClick={handleAdd} disabled={saving}>
            {saving ? 'Adding…' : 'Add to Blacklist'}
          </button>
        </div>
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
                    {confirmRemove === e.id ? (
                      <span className="flex gap-2 items-center text-sm">
                        <span className="text-navy-500">Sure?</span>
                        <button type="button" className="text-red-600 hover:text-red-800 font-medium" onClick={() => handleRemove(e.id)}>Yes</button>
                        <button type="button" className="text-navy-500 hover:text-navy-700" onClick={() => setConfirmRemove(null)}>No</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-flagged-600 hover:text-flagged-800 text-sm font-medium"
                        disabled={removing === e.id}
                        onClick={() => setConfirmRemove(e.id)}
                      >
                        {removing === e.id ? 'Removing…' : 'Remove'}
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
