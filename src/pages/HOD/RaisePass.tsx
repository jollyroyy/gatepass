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
import { supabase } from '../../supabaseClient';
import type { GatePassView, NewGatePass, NewGatePassItem, PassType } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { requiresReturnDate } from '../../lib/passTypes';
import { validateRaiseForm, todayStr, type FormErrors } from '../../lib/raisePassForm';
import { safeErrorMessage } from '../../lib/errors';
import { notifyApproval } from '../../lib/notifyApproval';
import { useReraisePass, voidSupersededPass } from './useReraisePass';
import { useRaiseDepartments } from './useRaiseDepartments';
import { createPass } from './raisePassRequest';
import { officeRaises, homeFor } from '../../lib/roleRoutes';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';
import PassSubmittedModal from './PassSubmittedModal';
import PassDetailsCards from './PassDetailsCards';
import MaterialItemsCard from './MaterialItemsCard';

/** The mock draws TWO blank lines before anything is typed — a gate pass for a
 *  single item is the exception here, and one empty row reads as a limit. */
const STARTING_ITEMS = 2;

/**
 * THE SAME FORM FOR THE COO AND THE CEO, with one field added (client,
 * 2026-08-31: "create those forms exactly as the hod sees it except one thing
 * that ceo and coo can select the department to raise the gatepass").
 *
 * The difference is entirely in WHICH DEPARTMENTS LOAD. An HOD's list is the
 * one they head, resolved from `hod_departments` and never asked for; a raising
 * office's list is every department, and they must pick. Everything below that
 * — validation, the item table, `raise_pass`, the confirmation, the approval
 * letter — is one code path for both, which is what "exactly as the hod sees
 * it" has to mean if the two forms are not to drift.
 */
interface RaisePassProps {
  /** The approval office this reader holds, or null. Only the COO and the CEO
   *  (`officeRaises`) reach this screen without being an HOD, and only they get
   *  the selector. */
  office?: ApprovalRoleKey | null;
}

export default function RaisePass({ office = null }: RaisePassProps): React.ReactElement {
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
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedPass, setSubmittedPass] = useState<GatePassView | null>(null);
  const [supersedeWarning, setSupersedeWarning] = useState<string | null>(null);
  // Does this reader CHOOSE a department, or is theirs captured for them?
  const picksDepartment = officeRaises(office);
  const { depts, autoSelect, error: deptError } = useRaiseDepartments(picksDepartment);
  const chosenDept = depts.find((d) => d.id === form.department_id) ?? depts[0];
  const deptName = chosenDept ? `${chosenDept.name} (${chosenDept.code})` : '';
  const { sourceId, source, prefill } = useReraisePass(todayStr());

  // Merged, never assigned wholesale: the department effect below may already
  // have chosen a department by the time the pre-fill arrives, and replacing the
  // whole form would drop it.
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => ({ ...f, ...prefill }));
  }, [prefill]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // An HOD's own department is selected for them; a COO or CEO must pick, so
  // nothing is auto-selected for them. Merged rather than assigned, for the
  // reason the pre-fill effect below is: both may land in either order.
  useEffect(() => {
    if (!autoSelect) return;
    setForm((f) => (f.department_id ? f : { ...f, department_id: autoSelect }));
  }, [autoSelect]);

  useEffect(() => {
    if (deptError) setSubmitError(deptError);
  }, [deptError]);

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
    // `hasDepartment` is "this form can name a department at all". For an HOD
    // that is whether they are assigned to one; for a COO or CEO it is whether
    // they picked one, because nothing was chosen for them.
    const errs = validateRaiseForm(
      form, picksDepartment ? !!form.department_id : depts.length > 0, todayStr(),
    );
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!userId) throw new Error('Could not determine your user account. Please sign in again.');
      const departmentId = form.department_id || depts[0]?.id;
      if (!departmentId) throw new Error('Choose the department this pass is raised for.');
      const created = await createPass(form, departmentId);
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
            ? `The new pass was raised, but ${source?.pass_number ?? 'the rejected pass'} could not be closed: ${voidErr}. Reject it from your dashboard.`
            : null,
        );
      }
    } catch (err) {
      setSubmitError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* `noValidate`, exactly as `DelegationForm` does it. Three controls in
          this form carry native constraints — quantity's `min`/`step`, the
          value box's `min="0"`, and the return date's `min={todayStr()}` — and
          the browser's own constraint validation runs BEFORE `onSubmit`. So a
          quantity of 0, a negative value, a past return date and a fractional
          quantity on a whole unit were all stopped by a native bubble, and
          `validateRaiseForm`'s own sentences for them never rendered: the
          unit-aware "Numbers cannot be split — enter 2 or 3." was unreachable
          from the UI entirely. Every one of those constraints has a JS
          equivalent in `raisePassForm.ts`, so nothing is admitted that was
          refused before — the refusal now speaks the app's language and appears
          under the field it belongs to. */}
      <form onSubmit={handleSubmit} className="rp-sheet" noValidate>
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
              Correcting {source?.pass_number ?? 'a gate pass rejected at the gate'}
              {source?.flag_reason ? ` — ${source.flag_reason}` : ''}
            </p>
            <p className="text-caption text-navy-600 mt-1">
              Check every line before submitting. The rejected pass is voided once this one is raised.
            </p>
          </div>
        )}

        <PassDetailsCards
          form={form}
          errors={errors}
          onTypeChange={handleTypeChange}
          onUpdate={update}
          departments={picksDepartment ? depts : undefined}
          deptCode={chosenDept?.code}
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
        {/* For an HOD this is a WHOLE-FORM failure with nowhere else to go —
            they were never asked for a department, and without one there is no
            pass to raise. A COO or CEO has a field for it, and the message is
            printed under that field instead of twice. */}
        {!picksDepartment && errors.department_id && (
          <div className="alert-error">{errors.department_id}</div>
        )}

        {submitError && <div className="alert-error">{submitError}</div>}

        <div className="rp-actions">
          <button type="button" className="btn-secondary px-6" onClick={() => navigate(homeFor(picksDepartment ? null : 'hod', office))}>
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
