// Pass-creation form. Type is chosen first (biggest control on the page) via
// PassTypeSelector; everything else follows in reading order.
//
// IT IS ALSO THE "RAISE IT AGAIN" SCREEN. A mismatch review or an expired-pass
// review sends the HOD here with `state.copyFrom`, and `useReraisePass` fills the
// form from that pass so they correct it rather than retype it. The superseded pass is voided
// AFTER the replacement is in the database — see that module's header for why
// the order matters.
import React, { useEffect, useState } from 'react';
import { gp, pub, supabase } from '../../supabaseClient';
import type { GatePassView, NewGatePass, NewGatePassItem, PassType, VendorProfile } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { requiresReturnDate } from '../../lib/passTypes';
import {
  validateRaiseForm,
  earliestReturnDate,
  packVendor,
  todayStr,
  type FormErrors,
} from '../../lib/raisePassForm';
import { fetchMyProfile } from '../../lib/profiles';
import { safeErrorMessage } from '../../lib/errors';
import { useReraisePass, voidSupersededPass } from './useReraisePass';
import PassIdentityPanel from './PassIdentityPanel';
import PassSubmittedModal from './PassSubmittedModal';
import PassDetailsCards from './PassDetailsCards';
import MaterialItemsCard from './MaterialItemsCard';

interface DeptOption {
  id: string;
  name: string;
  code: string;
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
  const [supersedeWarning, setSupersedeWarning] = useState<string | null>(null);
  const deptName = depts.length > 0 ? `${depts[0].name} (${depts[0].code})` : '';
  const { sourceId, source, prefill } = useReraisePass(todayStr());

  // Merged, never assigned wholesale: the department effect above may already
  // have chosen a department by the time the pre-fill arrives, and replacing the
  // whole form would drop it.
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => ({ ...f, ...prefill }));
  }, [prefill]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateRaiseForm(form, depts.length > 0, todayStr());
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
        p_visitor_company: packVendor(form),
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_expected_return_date: earliestReturnDate(form),
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
      const created = data as unknown as GatePassView;
      setSubmittedPass(created);
      // The replacement exists now, so the pass it replaces can be closed. A
      // failure here is reported as a WARNING and never as a submit error: the
      // new pass is raised either way, and telling the HOD "that failed" would
      // invite them to raise a third.
      if (sourceId) {
        const voidErr = await voidSupersededPass(sourceId, created.pass_number, source);
        setSupersedeWarning(
          voidErr
            ? `The new pass was raised, but ${source?.pass_number ?? 'the mismatched pass'} could not be closed: ${voidErr}. Reject it from your dashboard.`
            : null,
        );
      }
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
        <h1 className="page-title">{sourceId ? 'Raise Gate Pass Again' : 'Raise Gate Pass'}</h1>
        <p className="page-subtitle">Create a new material gate pass for security to verify.</p>
      </div>

      {/* The mismatch reason is repeated here on purpose. The HOD read it one
          screen ago, but this form is where they act on it, and a correction made
          from memory is how the same pass gets flagged twice. */}
      {sourceId && (
        <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-flagged-700">
            Correcting {source?.pass_number ?? 'a mismatched gate pass'}
            {source?.flag_reason ? ` — ${source.flag_reason}` : ''}
          </p>
          <p className="text-caption text-navy-600 mt-1">
            Check every line before submitting. The mismatched pass is voided once this one is raised.
          </p>
        </div>
      )}

      <PassIdentityPanel passNumberPrefix={passNumberPrefix} hodName={hodName} />

      {/* max-w-6xl, not 3xl: the Material Items grid's own minimum width (see
          itemGridMinWidth) is wider than a 3xl form, so at 3xl the section
          scrolled horizontally on every screen. 6xl clears it on a normal
          laptop; narrower viewports still scroll, with the row frame carrying
          the full field width either way. */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-6xl">
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

      {supersedeWarning && <div className="alert-warning mt-4">{supersedeWarning}</div>}

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
