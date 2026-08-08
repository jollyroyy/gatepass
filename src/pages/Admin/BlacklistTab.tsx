import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { BlacklistEntry, BlacklistType } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import {
  INDIAN_VEHICLE_EXAMPLE,
  INDIAN_VEHICLE_HINT,
  isValidIndianVehicleNo,
  normalizeVehicleNo,
} from '../../lib/indianVehicle';

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

/** Placeholder and label per type — a vehicle entry is a PLATE, not free text. */
const VALUE_PLACEHOLDERS: Record<BlacklistType, string> = {
  company: 'Vendor / company name',
  vehicle: INDIAN_VEHICLE_EXAMPLE,
  driver: 'Driver name',
};

interface FormState {
  list_type: BlacklistType;
  list_value: string;
  reason: string;
}

const INITIAL_FORM: FormState = { list_type: 'company' as BlacklistType, list_value: '', reason: '' };

export default function BlacklistTab(): React.ReactElement {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ value?: string; reason?: string }>({});
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

  /** A vehicle entry MUST be a valid Indian registration number — nothing else. */
  function validate(): { value?: string; reason?: string } {
    const errs: { value?: string; reason?: string } = {};
    if (form.list_type === 'vehicle') {
      if (!form.list_value.trim()) {
        errs.value = 'Vehicle number is required.';
      } else if (!isValidIndianVehicleNo(form.list_value)) {
        errs.value = `Not a valid Indian registration number — expected e.g. ${INDIAN_VEHICLE_EXAMPLE} or 22 BH 1234 XY.`;
      }
    } else if (!form.list_value.trim()) {
      errs.value = form.list_type === 'company'
        ? 'Company name is required.'
        : 'Driver name is required.';
    }
    if (!form.reason.trim()) errs.reason = 'Reason is required.';
    return errs;
  }

  async function handleAdd() {
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const value = form.list_type === 'vehicle' ? normalizeVehicleNo(form.list_value) : form.list_value.trim();
      const { error: err } = await gp().rpc('add_blacklist_entry', {
        p_list_type: form.list_type,
        p_list_value: value,
        p_reason: form.reason.trim(),
      });
      if (err) throw err;
      setShowForm(false);
      setForm(INITIAL_FORM);
      setFieldErrors({});
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
          <div className="flex flex-col gap-1">
            <label htmlFor="blacklist-type" className="text-sm font-semibold text-navy-900">Type</label>
            <select
              id="blacklist-type"
              className="input w-full"
              value={form.list_type}
              onChange={(e) => {
                setForm({ ...form, list_type: e.target.value as BlacklistType });
                setFieldErrors({});
              }}
            >
              <option value="company">Company</option>
              <option value="vehicle">Vehicle</option>
              <option value="driver">Driver</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="blacklist-value" className="text-sm font-semibold text-navy-900">
              {form.list_type === 'vehicle' ? 'Vehicle Number (Car No.)' : TYPE_LABELS[form.list_type]}
            </label>
            <input
              id="blacklist-value"
              className="input w-full"
              placeholder={VALUE_PLACEHOLDERS[form.list_type]}
              value={form.list_value}
              onChange={(e) => {
                setForm({ ...form, list_value: e.target.value });
                setFieldErrors({});
              }}
            />
            {form.list_type === 'vehicle' && !fieldErrors.value && (
              <p className="text-xs text-navy-500">{INDIAN_VEHICLE_HINT}</p>
            )}
            {fieldErrors.value && (
              <p className="text-xs font-medium text-flagged-700">{fieldErrors.value}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="blacklist-reason" className="text-sm font-semibold text-navy-900">Reason for blacklisting</label>
            <textarea
              id="blacklist-reason"
              className="input w-full min-h-[60px]"
              placeholder="Reason for blacklisting"
              value={form.reason}
              onChange={(e) => {
                setForm({ ...form, reason: e.target.value });
                setFieldErrors({});
              }}
            />
            {fieldErrors.reason && (
              <p className="text-xs font-medium text-flagged-700">{fieldErrors.reason}</p>
            )}
          </div>

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