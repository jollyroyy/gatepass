// Pass-creation form. Type is chosen first (biggest control on the page) via
// PassTypeSelector; everything else follows in reading order.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gp, pub, supabase } from '../../supabaseClient';
import type { NewGatePass, PassDirection, PassType } from '../../types';
import { allowedDirections, PASS_DIRECTIONS, requiresReturnDate } from '../../lib/passTypes';
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

type FormErrors = Partial<Record<keyof NewGatePass, string>>;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function initialForm(): NewGatePass {
  return {
    type: 'RGP',
    direction: 'out',
    department_id: '',
    visitor_name: '',
    visitor_company: '',
    material_description: '',
    quantity: '',
    unit: 'nos',
    vehicle_number: '',
    purpose: '',
    expected_return_date: '',
  };
}

export default function RaisePass(): React.ReactElement {
  const navigate = useNavigate();
  const [form, setForm] = useState<NewGatePass>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [hodName, setHodName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    // Best-effort: a failed name lookup must never block raising a pass, so the
    // identity panel just keeps showing "Loading…" rather than an error.
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
          if (list.length === 1) setForm((f) => ({ ...f, department_id: list[0].id }));
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

  function handleTypeChange(type: PassType) {
    // NRGP is outward-only (gate_passes_nrgp_is_outward). If the direction the
    // HOD already had selected isn't legal for the new type, snap it to the
    // first allowed value instead of letting the form hold an illegal pair.
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

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.visitor_name.trim()) errs.visitor_name = 'Visitor name is required.';
    if (!form.material_description.trim()) errs.material_description = 'Material description is required.';
    const qty = Number(form.quantity);
    if (!form.quantity || Number.isNaN(qty) || qty <= 0) errs.quantity = 'Enter a quantity greater than 0.';
    if (!form.purpose.trim()) errs.purpose = 'Purpose is required.';

    if (depts.length === 0) errs.department_id = 'You are not assigned to any department.';
    else if (depts.length > 1 && !form.department_id) errs.department_id = 'Select a department.';

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
      const departmentId = depts.length === 1 ? depts[0].id : form.department_id;
      const payload = {
        type: form.type,
        direction: form.direction,
        department_id: departmentId,
        raised_by: userId,
        visitor_name: form.visitor_name.trim(),
        visitor_company: form.visitor_company.trim() || null,
        material_description: form.material_description.trim(),
        quantity: Number(form.quantity),
        unit: form.unit,
        vehicle_number: form.vehicle_number.trim() || null,
        purpose: form.purpose.trim(),
        expected_return_date: requiresReturnDate(form.type) ? form.expected_return_date : null,
      };
      const { data, error } = await gp().from('gate_passes').insert(payload).select().single();
      if (error) throw error;
      navigate(`/pass/${data.id}?created=1`);
    } catch (err) {
      setSubmitError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Derived from state, not stored, so it updates live as the HOD changes
  // type or direction — this is a preview only, the real number comes back
  // from the `set_pass_number` trigger on insert.
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
          ) : depts.length === 1 ? (
            <p className="text-sm font-medium text-navy-900 py-2">{depts[0].name} ({depts[0].code})</p>
          ) : depts.length > 1 ? (
            <select className="input" value={form.department_id} onChange={(e) => update('department_id', e.target.value)}>
              <option value="">Select department…</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
              ))}
            </select>
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
          </div>
        </div>

        <div>
          <label className="label">Material Description</label>
          <textarea className="input" rows={3} value={form.material_description} onChange={(e) => update('material_description', e.target.value)} />
          {errors.material_description && <p className="field-error">{errors.material_description}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="0.01" step="0.01" className="input" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} />
            {errors.quantity && <p className="field-error">{errors.quantity}</p>}
          </div>
          <div>
            <label className="label">Unit</label>
            <select className="input" value={form.unit} onChange={(e) => update('unit', e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vehicle Number</label>
            <input className="input" value={form.vehicle_number} onChange={(e) => update('vehicle_number', e.target.value)} />
          </div>
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
    </div>
  );
}
