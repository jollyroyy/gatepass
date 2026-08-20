// Pass-creation form, drawn to the client's 2026-08-19 "Raise Gate Pass"
// mock-up: one white sheet, five titled sections in reading order, the
// item-wise table, and Cancel / Submit Request at the foot.
//
// IT IS ALSO THE "RAISE IT AGAIN" SCREEN. A mismatch review or an expired-pass
// review sends the HOD here with `state.copyFrom`, and `useReraisePass` fills the
// form from that pass so they correct it rather than retype it. The superseded pass is voided
// AFTER the replacement is in the database — see that module's header for why
// the order matters.
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gp, pub, supabase } from '../../supabaseClient';
import type { DeptOption, GatePassView, NewGatePass, NewGatePassItem, PassType, VendorProfile } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { requiresReturnDate } from '../../lib/passTypes';
import { validateRaiseForm, packVendor, todayStr, earliestReturnDate, type FormErrors } from '../../lib/raisePassForm';
import { safeErrorMessage } from '../../lib/errors';
import { notifyApproval } from '../../lib/notifyApproval';
import { useReraisePass, voidSupersededPass } from './useReraisePass';
import PassSubmittedModal from './PassSubmittedModal';
import PassDetailsCards, { NEW_VENDOR } from './PassDetailsCards';
import MaterialItemsCard from './MaterialItemsCard';

/** The mock draws TWO blank lines before anything is typed — a gate pass for a
 *  single item is the exception here, and one empty row reads as a limit. */
const STARTING_ITEMS = 2;

export default function RaisePass(): React.ReactElement {
  // `/raise` is one screen; the pass TYPE may still arrive in the query string
  // from an older link or bookmark. Read ONCE, as the initial state: the reader
  // may change the type with the selector afterwards, and a `useEffect` that
  // kept resetting it from the URL would fight them. Anything other than the two
  // legal codes falls back to RGP rather than seeding an illegal pass.
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialType: PassType = params.get('type') === 'NRGP' ? 'NRGP' : 'RGP';

  const [form, setForm] = useState<NewGatePass>({
    type: initialType,
    direction: 'out',
    department_id: '',
    visitor_name: '',
    visitor_phone: '',
    visitor_company: '',
    company_address: '',
    vehicle_number: '',
    purpose: '',
    items: Array.from({ length: STARTING_ITEMS }, () => ({ ...EMPTY_ITEM })),
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedPass, setSubmittedPass] = useState<GatePassView | null>(null);
  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [supersedeWarning, setSupersedeWarning] = useState<string | null>(null);
  const chosenDept = depts.find((d) => d.id === form.department_id) ?? depts[0];
  const deptName = chosenDept ? `${chosenDept.name} (${chosenDept.code})` : '';
  const { sourceId, source, prefill } = useReraisePass(todayStr());

  // Merged, never assigned wholesale: the department effect below may already
  // have chosen a department by the time the pre-fill arrives, and replacing the
  // whole form would drop it. A re-raise names its vendor by hand, so the select
  // moves to the free-text branch rather than silently showing "Select…" over a
  // filled-in name.
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => ({ ...f, ...prefill }));
    if (prefill.visitor_company) setVendorId(NEW_VENDOR);
  }, [prefill]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
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
          if (list.length > 0) setForm((f) => (f.department_id ? f : { ...f, department_id: list[0].id }));
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
      // NRGP is permanent — nothing comes back, so every line's return date is
      // cleared the moment it is selected. Clearing rather than merely hiding
      // the column: a date left in state under a hidden field is a date that
      // would be submitted, and an NRGP with a return date is a pass the return
      // queue would then chase forever.
      items: requiresReturnDate(type)
        ? f.items
        : f.items.map((item) => ({ ...item, expected_return_date: '' })),
    }));
    setErrors((e) => {
      const next = { ...e };
      Object.keys(next).forEach((key) => {
        if (key.endsWith('_expected_return_date')) delete next[key];
      });
      return next;
    });
  }

  function update<K extends keyof NewGatePass>(key: K, value: NewGatePass[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  /** The mock's "Vendor Address (Auto-filled)" — the whole point of migration
   *  045's `vendor_profiles.address`. Picking a stored vendor fills the name,
   *  the address and the vehicle it usually comes in; choosing "a new vendor"
   *  clears all three so the HOD is typing into empty fields, not over
   *  somebody else's. */
  function pickVendor(id: string) {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      visitor_company: v ? v.company_name : '',
      company_address: v ? (v.address ?? '') : '',
      vehicle_number: v?.vehicle_number ?? f.vehicle_number,
    }));
    setErrors((e) => ({ ...e, visitor_company: undefined }));
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
      const departmentId = form.department_id || depts[0].id;
      // THE PASS'S DEADLINE IS THE EARLIEST LINE'S. `v_gate_passes` grades
      // `is_overdue` / `due_state` off this one column, and a pass is late the
      // moment its first line is — see `earliestReturnDate`.
      const returnDate = requiresReturnDate(form.type) ? earliestReturnDate(form.items) : null;
      const { data, error } = await gp().rpc('raise_pass', {
        p_type: form.type,
        p_direction: 'out',
        p_department_id: departmentId,
        p_visitor_name: form.visitor_name.trim(),
        p_visitor_company: packVendor(form),
        p_vehicle_number: form.vehicle_number.trim() || null,
        // ONE reason for the whole pass (the mock asks once). `raise_pass` (045)
        // also uses it as each line's `purpose`, which is NOT NULL — so the
        // record and the printed slip show the reason that was authorised
        // instead of the literal 'Material movement' fallback.
        p_purpose: form.purpose.trim() || null,
        p_expected_return_date: returnDate,
        p_items: form.items.map((item) => ({
          // ONE "Item Description" on the mock, two NOT NULL columns behind it.
          // `description` is what `normalize_material` keys the one-open-line-
          // per-material index on, so it must be the material and nothing else.
          name: item.name.trim(),
          description: item.name.trim(),
          quantity: Number(item.quantity),
          // THE UNIT THE HOD PICKED (client, 2026-08-20). `nos` is the select's
          // own default, so a line nobody touched still lands as a plain count —
          // the same value every line raised between 2026-08-19 and today
          // carries — and the guard reads it back read-only at the barrier.
          unit: item.unit || 'nos',
          make_model: item.make_model.trim() || null,
          serial_no: item.serial_no.trim() || null,
          invoice_no: item.invoice_no.trim() || null,
          remarks: item.remarks.trim() || null,
          // EACH LINE CARRIES ITS OWN DATE — client, 2026-08-19: "we would
          // expect a date of return against each item in the RGP form." The
          // pass-level date above is the earliest of these, so the two can
          // never disagree about when the FIRST piece of material is due.
          expected_return_date: requiresReturnDate(form.type) ? item.expected_return_date : null,
        })),
      });
      if (error) throw error;
      const created = data as unknown as GatePassView;
      setSubmittedPass(created);
      // The pass is raised. Now tell the office it landed on, and copy this HOD.
      // NOT AWAITED, and it cannot throw: `notifyApproval` swallows everything,
      // because a mail provider having a bad afternoon must not put a red
      // message on the screen that just confirmed a gate pass. The whole
      // decision — who is written to, and what the letter claims — is made
      // server-side from the pass's own approval rows; see that module.
      void notifyApproval(created.id);
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
      // A vendor typed by hand is REMEMBERED, so the next pass to the same
      // supplier auto-fills its address instead of asking for it again — which
      // is the only way the mock's "(Auto-filled)" can ever come true. Fire and
      // forget: the pass is raised, and a failed profile write must not read as
      // a failed submit.
      if (vendorId === NEW_VENDOR && form.visitor_company.trim()) {
        gp().rpc('save_vendor_profile', {
          p_company_name: form.visitor_company.trim(),
          p_department_id: departmentId,
          p_vehicle_number: form.vehicle_number.trim() || null,
          p_address: form.company_address.trim() || null,
        });
      }
    } catch (err) {
      setSubmitError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="rp-sheet">
        <div className="rp-head">
          <h1 className="rp-title">{sourceId ? 'Raise Gate Pass Again' : 'Raise Gate Pass'}</h1>
          <p className="rp-subtitle">Fill in the details to raise a new gate pass request.</p>
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

        <PassDetailsCards
          form={form}
          errors={errors}
          vendors={vendors}
          vendorId={vendorId}
          onTypeChange={handleTypeChange}
          onUpdate={update}
          onVendorPick={pickVendor}
        />

        <MaterialItemsCard
          items={form.items}
          errors={errors}
          onItemChange={updateItem}
          onRemoveItem={removeItem}
          onAddItem={addItem}
          showReturnDate={requiresReturnDate(form.type)}
        />

        {/* The department is no longer a field on this form (client: "it will
            be automatically captured"), so the one thing that can go wrong with
            it — an HOD assigned to none — has nowhere of its own to report.
            It is a whole-form failure anyway: without a department there is no
            pass to raise. */}
        {errors.department_id && <div className="alert-error">{errors.department_id}</div>}

        {submitError && <div className="alert-error">{submitError}</div>}

        <div className="rp-actions">
          <button type="button" className="btn-secondary px-6" onClick={() => navigate('/dashboard')}>
            Cancel
          </button>
          <button type="submit" className="btn-primary px-8" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Request'}
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
