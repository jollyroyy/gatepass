// Pass-creation form. Type is chosen first (biggest control on the page) via
// PassTypeSelector; everything else follows in reading order.
import React, { useEffect, useState } from 'react';
import { gp, pub, supabase } from '../../supabaseClient';
import type { GatePassView, NewGatePass, NewGatePassItem, PassType, VendorProfile } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { requiresReturnDate } from '../../lib/passTypes';
import { fetchMyProfile } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import PassIdentityPanel from './PassIdentityPanel';
import PassSubmittedModal from './PassSubmittedModal';
import PassDetailsCards from './PassDetailsCards';
import MaterialItemsCard from './MaterialItemsCard';

interface DeptOption {
  id: string;
  name: string;
  code: string;
}

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
    visitor_phone: '',
    visitor_company: '',
    company_address: '',
    vehicle_number: '',
    purpose: '',
    expected_return_date: '',
    items: [{ ...EMPTY_ITEM }],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [depts, setDepts] = useState<DeptOption[]>([]);
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
    setForm((f) => ({
      ...f,
      type,
      expected_return_date: requiresReturnDate(type) ? f.expected_return_date : '',
      items: f.items.map((item) => ({
        ...item,
        expected_return_date: requiresReturnDate(type) ? item.expected_return_date : '',
      })),
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
        if (!item.name.trim()) {
          errs[`item_${idx}_name`] = 'Item name is required.';
        }
        if (!item.description.trim()) {
          errs[`item_${idx}_description`] = 'Description is required.';
        }
        if (!item.purpose.trim()) {
          errs[`item_${idx}_purpose`] = 'Purpose is required.';
        }
        const qty = Number(item.quantity);
        if (!item.quantity || Number.isNaN(qty) || qty <= 0) {
          errs[`item_${idx}_quantity`] = 'Enter a quantity greater than 0.';
        }
      });
    }

    if (depts.length === 0) errs.department_id = 'You are not assigned to any department.';

    // The pass-level return date was replaced by per-item dates in migration 019.
    // Every RGP line must carry one, because the pass-level column that drives
    // is_overdue is derived from them (earliestReturnDate below).
    if (requiresReturnDate(form.type)) {
      form.items.forEach((item, idx) => {
        if (!item.expected_return_date) {
          errs[`item_${idx}_expected_return_date`] =
            'Return date is required for a Returnable Gate Pass.';
        } else if (item.expected_return_date < todayStr()) {
          errs[`item_${idx}_expected_return_date`] = 'Return date cannot be in the past.';
        }
      });
    }
    return errs;
  }

  /** The pass is due when its FIRST line is due. `gatepass.v_gate_passes`
   *  computes is_overdue and due_state off the pass-level column, so it must be
   *  populated even though the authoritative dates now live per item. */
  function earliestReturnDate(): string | null {
    if (!requiresReturnDate(form.type)) return null;
    const dates = form.items.map((i) => i.expected_return_date).filter(Boolean);
    return dates.length > 0 ? dates.slice().sort()[0] : null;
  }

  /** The `{"n","a","v"}` blob for `visitor_company`, or null when the HOD filled
   *  in none of the three optional vendor fields. Writing `{"n":"","a":"","v":""}`
   *  put a JSON blob in the column for a pass that has no vendor at all — the
   *  old `JSON.stringify({...}) || null` could never be null, since stringify
   *  always returns a non-empty string. `gatepass.company_name_of()` and
   *  `parseCompanyInfo()` both cope with the blob now, but a null column is the
   *  honest record of "no vendor given". */
  function packVendor(): string | null {
    const n = form.visitor_company.trim();
    const a = form.company_address.trim();
    const v = form.visitor_phone.trim();
    if (!n && !a && !v) return null;
    return JSON.stringify({ n, a, v });
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
        p_direction: 'out',
        p_department_id: departmentId,
        p_visitor_name: form.visitor_name.trim(),
        p_visitor_company: packVendor(),
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_expected_return_date: earliestReturnDate(),
        p_items: form.items.map((item) => ({
          name: item.name.trim(),
          description: item.description.trim(),
          purpose: item.purpose.trim(),
          quantity: Number(item.quantity),
          unit: item.unit,
          approx_value: item.approx_value ? Number(item.approx_value) : null,
          expected_return_date: requiresReturnDate(form.type) ? (item.expected_return_date || null) : null,
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

  const passNumberPrefix = `${form.type}-OUT-${todayStr().replace(/-/g, '')}`;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Raise Gate Pass</h1>
        <p className="page-subtitle">Create a new material gate pass for security to verify.</p>
      </div>

      <PassIdentityPanel passNumberPrefix={passNumberPrefix} hodName={hodName} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-3xl">
        <PassDetailsCards
          form={form}
          errors={errors}
          vendors={vendors}
          saveVendor={saveVendor}
          onTypeChange={handleTypeChange}
          onUpdate={update}
          onSaveVendorChange={setSaveVendor}
        />

        <MaterialItemsCard
          items={form.items}
          errors={errors}
          showReturnDate={requiresReturnDate(form.type)}
          onItemChange={updateItem}
          onRemoveItem={removeItem}
          onAddItem={addItem}
          todayStr={todayStr()}
        />

        {submitError && <div className="alert-error">{submitError}</div>}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary px-8" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Raise Gate Pass'}
          </button>
        </div>
      </form>

      {submittedPass && (
        <PassSubmittedModal
          submittedPass={submittedPass}
          deptName={deptName}
          itemCount={form.items.length}
          onClose={() => setSubmittedPass(null)}
        />
      )}
    </div>
  );
}
