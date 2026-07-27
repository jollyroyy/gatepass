// Pass-creation form. Type is chosen first (biggest control on the page) via
// PassTypeSelector; everything else follows in reading order.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gp, pub, supabase } from '../../supabaseClient';
import type { GatePassView, NewGatePass, NewGatePassItem, PassDirection, PassType, VendorProfile } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { PASS_TYPES, allowedDirections, PASS_DIRECTIONS, requiresReturnDate } from '../../lib/passTypes';
import { fetchMyProfile } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import PassTypeSelector from './PassTypeSelector';
import PassIdentityPanel from './PassIdentityPanel';

interface DeptOption {
  id: string;
  name: string;
  code: string;
}

const UNITS = ['nos', 'kg', 'box', 'roll', 'litre', 'metre', 'set'] as const;

type FormErrors = Record<string, string | undefined>;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RaisePass(): React.ReactElement {
  const [form, setForm] = useState<NewGatePass>({
    type: 'RGP',
    direction: 'out',
    department_id: '',
    visitor_name: '',
    visitor_company: '',
    vehicle_number: '',
    purpose: '',
    expected_return_date: '',
    items: [{ ...EMPTY_ITEM }],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [hodName, setHodName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedPass, setSubmittedPass] = useState<GatePassView | null>(null);
  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [saveVendor, setSaveVendor] = useState(false);
  const deptName = depts.length > 0 ? `${depts[0].name} (${depts[0].code})` : '';

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    fetchMyProfile()
      .then((p) => setHodName(p?.full_name ?? null))
      .catch(() => setHodName(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadDepartments() {
      setDeptLoading(true);
      try {
        const { data: hodDepts, error: hodErr } = await gp().from('hod_departments').select('department_id');
        if (hodErr) throw hodErr;
        const ids = (hodDepts ?? []).map((r: { department_id: string }) => r.department_id);
        if (ids.length === 0) {
          if (!cancelled) setDepts([]);
          return;
        }
        const { data: deptRows, error: deptErr } = await pub()
          .from('departments')
          .select('id, name, code')
          .in('id', ids);
        if (deptErr) throw deptErr;
        if (!cancelled) {
          const list = (deptRows ?? []) as DeptOption[];
          setDepts(list);
          if (list.length > 0) setForm((f) => ({ ...f, department_id: list[0].id }));
        }
      } catch (err) {
        if (!cancelled) setSubmitError(safeErrorMessage(err));
      } finally {
        if (!cancelled) setDeptLoading(false);
      }
    }
    loadDepartments();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load vendor profiles when department changes
  useEffect(() => {
    if (!form.department_id) { setVendors([]); return; }
    gp().rpc('list_vendor_profiles', { p_department_id: form.department_id }).then(({ data }) => {
      setVendors((data as VendorProfile[]) ?? []);
    });
  }, [form.department_id]);

  function handleTypeChange(type: PassType) {
    const allowed = allowedDirections(type);
    setForm((f) => ({
      ...f,
      type,
      direction: allowed.includes(f.direction) ? f.direction : allowed[0],
      expected_return_date: requiresReturnDate(type) ? f.expected_return_date : '',
    }));
    setErrors((e) => ({ ...e, expected_return_date: undefined }));
  }

  function update<K extends keyof NewGatePass>(key: K, value: NewGatePass[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function updateItem(idx: number, field: keyof NewGatePassItem, value: string) {
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    }));
    setErrors((e) => ({ ...e, [`item_${idx}_${field}`]: undefined }));
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
    setErrors((e) => {
      const next = { ...e };
      Object.keys(next).forEach((key) => { if (key.startsWith('item_')) delete next[key]; });
      delete next.items;
      return next;
    });
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
    setErrors((e) => {
      const next = { ...e };
      Object.keys(next).forEach((key) => { if (key.startsWith('item_')) delete next[key]; });
      return next;
    });
  }

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.visitor_name.trim()) errs.visitor_name = 'Visitor name is required.';

    if (form.items.length === 0) {
      errs.items = 'At least one material item is required.';
    } else {
      form.items.forEach((item, idx) => {
        if (!item.description.trim()) {
          errs[`item_${idx}_description`] = 'Description is required.';
        }
        const qty = Number(item.quantity);
        if (!item.quantity || Number.isNaN(qty) || qty <= 0) {
          errs[`item_${idx}_quantity`] = 'Enter a quantity greater than 0.';
        }
      });
    }

    if (!form.purpose.trim()) errs.purpose = 'Purpose is required.';

    if (depts.length === 0) errs.department_id = 'You are not assigned to any department.';

    if (requiresReturnDate(form.type)) {
      if (!form.expected_return_date) {
        errs.expected_return_date = 'Expected return date is required for a Returnable Gate Pass.';
      } else if (form.expected_return_date < todayStr()) {
        errs.expected_return_date = 'Expected return date cannot be in the past.';
      }
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!userId) throw new Error('Could not determine your user account. Please sign in again.');
      const departmentId = depts[0].id;
      const { data, error } = await gp().rpc('raise_pass', {
        p_type: form.type,
        p_direction: form.direction,
        p_department_id: departmentId,
        p_visitor_name: form.visitor_name.trim(),
        p_visitor_company: form.visitor_company.trim() || null,
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_purpose: form.purpose.trim(),
        p_expected_return_date: requiresReturnDate(form.type) ? form.expected_return_date : null,
        p_items: form.items.map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unit: item.unit,
          serial_no: item.serial_no.trim() || null,
          approx_value: item.approx_value ? Number(item.approx_value) : null,
        })),
      });
      if (error) throw error;
      setSubmittedPass(data as unknown as GatePassView);
      if (saveVendor && form.visitor_company.trim()) {
        gp().rpc('save_vendor_profile', {
          p_company_name: form.visitor_company.trim(),
          p_department_id: departmentId,
          p_vehicle_number: form.vehicle_number.trim() || null,
        });
      }
    } catch (err) {
      setSubmitError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const directionOptions = allowedDirections(form.type);
  const directionLocked = directionOptions.length === 1;
  const passNumberPrefix = `${form.type}-${form.direction.toUpperCase()}-${todayStr().replace(/-/g, '')}`;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Raise Gate Pass</h1>
        <p className="page-subtitle">Create a new material gate pass for security to verify.</p>
      </div>

      <PassIdentityPanel passNumberPrefix={passNumberPrefix} hodName={hodName} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-3xl mt-6">
        <div>
          <label className="label">Pass Type</label>
          <PassTypeSelector value={form.type} onChange={handleTypeChange} />
        </div>

        <div>
          <label className="label">Direction</label>
          <select
            className="input"
            value={form.direction}
            disabled={directionLocked}
            onChange={(e) => update('direction', e.target.value as PassDirection)}
          >
            {directionOptions.map((d) => (
              <option key={d} value={d}>
                {PASS_DIRECTIONS[d].label}
              </option>
            ))}
          </select>
          {directionLocked && (
            <p className="text-xs text-navy-400 mt-1">
              NRGP is outward only — inbound material that never leaves is a goods receipt, not a gate pass.
            </p>
          )}
        </div>

        <div>
          <label className="label">Department</label>
          {deptLoading ? (
            <div className="skeleton h-10 w-full" />
          ) : depts.length > 0 ? (
            <p className="text-sm font-medium text-navy-900 py-2">{depts[0].name} ({depts[0].code})</p>
          ) : (
            <p className="text-sm text-flagged-700">You are not assigned to any department. Contact an administrator.</p>
          )}
          {errors.department_id && <p className="field-error">{errors.department_id}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Visitor Name</label>
            <input className="input" value={form.visitor_name} onChange={(e) => update('visitor_name', e.target.value)} />
            {errors.visitor_name && <p className="field-error">{errors.visitor_name}</p>}
          </div>
          <div>
            <label className="label">Visitor Company</label>
            <input className="input" value={form.visitor_company} onChange={(e) => update('visitor_company', e.target.value)} />
            {vendors.length > 0 && (
              <select className="input mt-2 text-sm" defaultValue=""
                onChange={(e) => {
                  const v = vendors.find((x) => x.id === e.target.value);
                  if (!v) return;
                  update('visitor_company', v.company_name);
                  if (v.vehicle_number) update('vehicle_number', v.vehicle_number);
                }}>
                <option value="" disabled>Load from vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 mt-2 text-sm text-navy-600 cursor-pointer">
              <input type="checkbox" checked={saveVendor} onChange={(e) => setSaveVendor(e.target.checked)} />
              Save as vendor profile
            </label>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Materials / Items</label>
            <span className="text-sm text-navy-400">{form.items.length} item{form.items.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-col gap-3">
            {form.items.map((item, idx) => (
              <div key={idx} className="border border-surface-300 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-sm font-medium text-navy-500">Item #{idx + 1}</span>
                  {form.items.length > 1 && (
                    <button type="button" className="text-flagged-600 hover:text-flagged-700 text-sm font-medium" onClick={() => removeItem(idx)}>
                      Remove
                    </button>
                  )}
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input" rows={2} value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} />
                  {errors[`item_${idx}_description`] && <p className="field-error">{errors[`item_${idx}_description`]}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="label">Quantity</label>
                    <input type="number" min="0.01" step="0.01" className="input" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                    {errors[`item_${idx}_quantity`] && <p className="field-error">{errors[`item_${idx}_quantity`]}</p>}
                  </div>
                  <div>
                    <label className="label">Unit</label>
                    <select className="input" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)}>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="label">Serial No.</label>
                    <input className="input" value={item.serial_no} onChange={(e) => updateItem(idx, 'serial_no', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Approx. Value</label>
                    <input type="number" min="0" step="0.01" className="input" value={item.approx_value} onChange={(e) => updateItem(idx, 'approx_value', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary mt-3" onClick={addItem}>
            + Add Item
          </button>
          {errors.items && <p className="field-error">{errors.items}</p>}
        </div>

        <div>
          <label className="label">Vehicle Number</label>
          <input className="input" value={form.vehicle_number} onChange={(e) => update('vehicle_number', e.target.value)} />
        </div>

        <div>
          <label className="label">Purpose</label>
          <textarea className="input" rows={2} value={form.purpose} onChange={(e) => update('purpose', e.target.value)} />
          {errors.purpose && <p className="field-error">{errors.purpose}</p>}
        </div>

        {requiresReturnDate(form.type) && (
          <div>
            <label className="label">Expected Return Date</label>
            <input type="date" min={todayStr()} className="input" value={form.expected_return_date} onChange={(e) => update('expected_return_date', e.target.value)} />
            {errors.expected_return_date && <p className="field-error">{errors.expected_return_date}</p>}
          </div>
        )}

        {submitError && <div className="alert-error">{submitError}</div>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Raise Pass'}
          </button>
        </div>
      </form>

      {submittedPass && (
        <div className="modal-overlay">
          <div className="modal-content p-6 max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-matched-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-matched-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-navy-900">Pass Submitted</h3>
                <p className="text-sm text-navy-500">
                  <span className="font-semibold text-navy-700">{submittedPass.pass_number}</span>
                  {' · '}{PASS_TYPES[submittedPass.type as keyof typeof PASS_TYPES]?.label ?? submittedPass.type}
                </p>
              </div>
            </div>

            <div className="bg-surface-50 rounded-lg p-4 mb-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-navy-400">Department</span>
                <span className="font-medium text-navy-700">{deptName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-navy-400">Items</span>
                <span className="font-medium text-navy-700">{form.items.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-navy-400">Visitor</span>
                <span className="font-medium text-navy-700">{submittedPass.visitor_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-navy-400">Status</span>
                <span className="font-medium text-pending-600">Pending Gate Review</span>
              </div>
            </div>

            <p className="text-xs text-navy-400 mb-4">
              Security has been notified. The pass will appear in the gate console
              for verification when the material arrives at the gate.
            </p>

            <div className="flex gap-3">
              <Link to={`/pass/${submittedPass.id}`} className="btn-primary flex-1 text-center">
                View Pass
              </Link>
              <Link to="/dashboard" className="btn-secondary flex-1 text-center">
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
