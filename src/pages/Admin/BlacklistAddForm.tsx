// The "add a vendor to the blacklist" form, extracted from BlacklistTab so
// that file stays under the 300-line cap now that it also carries the
// whitelist-request flow.
//
// ONE type is offered: Vendor (client, 2026-08-13). The select survives with a
// single option deliberately — the stored `list_type` is still one of three
// values in the database, and the control is where a second one would reappear
// if the rule ever changes back.
//
// The stored value stays `company`. `blacklist_type_valid` (016), the
// raise-time trigger (027/033) and every existing row use that label; changing
// it would be a data migration, not a rename. Only the wording changes.
import React from 'react';
import type { BlacklistType } from '../../types';

export interface BlacklistFormState {
  list_type: BlacklistType;
  list_value: string;
  reason: string;
}

export const INITIAL_BLACKLIST_FORM: BlacklistFormState = {
  list_type: 'company',
  list_value: '',
  reason: '',
};

/** Returns the field errors — empty when the form is submittable. */
export function validateBlacklistForm(form: BlacklistFormState): { value?: string; reason?: string } {
  const errs: { value?: string; reason?: string } = {};
  if (!form.list_value.trim()) errs.value = 'Vendor name is required.';
  if (!form.reason.trim()) errs.reason = 'Reason is required.';
  return errs;
}

interface Props {
  form: BlacklistFormState;
  errors: { value?: string; reason?: string };
  saving: boolean;
  onChange: (form: BlacklistFormState) => void;
  onSubmit: () => void;
}

export default function BlacklistAddForm({
  form,
  errors,
  saving,
  onChange,
  onSubmit,
}: Props): React.ReactElement {
  return (
    <div className="card mb-6 p-4 space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="blacklist-type" className="text-sm font-semibold text-navy-900">Type</label>
        <select
          id="blacklist-type"
          className="input w-full"
          value={form.list_type}
          onChange={(e) => onChange({ ...form, list_type: e.target.value as BlacklistType })}
        >
          <option value="company">Vendor</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="blacklist-value" className="text-sm font-semibold text-navy-900">Vendor Name</label>
        <input
          id="blacklist-value"
          className="input w-full"
          placeholder="Vendor name"
          value={form.list_value}
          onChange={(e) => onChange({ ...form, list_value: e.target.value })}
        />
        {errors.value && <p className="text-xs font-medium text-flagged-700">{errors.value}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="blacklist-reason" className="text-sm font-semibold text-navy-900">
          Reason for blacklisting
        </label>
        <textarea
          id="blacklist-reason"
          className="input w-full min-h-[60px]"
          placeholder="Reason for blacklisting"
          value={form.reason}
          onChange={(e) => onChange({ ...form, reason: e.target.value })}
        />
        {errors.reason && <p className="text-xs font-medium text-flagged-700">{errors.reason}</p>}
      </div>

      <button type="button" className="btn-primary" onClick={onSubmit} disabled={saving}>
        {saving ? 'Adding…' : 'Add to Blacklist'}
      </button>
    </div>
  );
}
