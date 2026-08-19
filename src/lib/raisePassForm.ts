// The raise-pass form's rules, extracted from RaisePass.tsx so that file stays
// under the 300-line cap once it also became the "raise it again" screen.
//
// Pure functions over the form state — no React, no supabase. That is what lets
// a test assert the RGP return-date rule without mounting a form and filling in
// eight fields to reach it.
import type { NewGatePass } from '../types';
import { requiresReturnDate } from './passTypes';
import { isWholeUnit, wholeUnitError } from './units';

export type FormErrors = Record<string, string | undefined>;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everything wrong with the form, keyed the way the inputs are named.
 *
 *  THE RETURN DATE IS PER LINE, NOT PER PASS. Migration `019` replaced the
 *  pass-level field with per-item dates; for two months after it, this function
 *  still demanded a pass-level `expected_return_date` that the form no longer
 *  rendered, so every RGP submit failed validation on a field nobody could see
 *  or fill. Never reintroduce a pass-level check here — the pass-level column is
 *  DERIVED (see `earliestReturnDate`). */
export function validateRaiseForm(form: NewGatePass, hasDepartment: boolean, today: string): FormErrors {
  const errs: FormErrors = {};
  if (!form.visitor_name.trim()) errs.visitor_name = "Authorized person's name is required.";

  if (form.items.length === 0) {
    errs.items = 'At least one material item is required.';
  } else {
    form.items.forEach((item, idx) => {
      if (!item.name.trim()) errs[`item_${idx}_name`] = 'Item name is required.';
      if (!item.description.trim()) errs[`item_${idx}_description`] = 'Description is required.';
      if (!item.purpose.trim()) errs[`item_${idx}_purpose`] = 'Purpose is required.';
      const qty = Number(item.quantity);
      if (!item.quantity || Number.isNaN(qty) || qty <= 0) {
        errs[`item_${idx}_quantity`] = 'Enter a quantity greater than 0.';
      } else if (isWholeUnit(item.unit) && !Number.isInteger(qty)) {
        // A COUNTED UNIT TAKES NO FRACTION, and the rule has to be here as well
        // as in the return box: 2.5 boxes raised is 2.5 boxes the gate can never
        // fully return, since `checkReturnQty` would refuse every fraction that
        // clears it. Same function, so the two can never disagree about which
        // units are countable.
        errs[`item_${idx}_quantity`] = wholeUnitError(item.unit, qty);
      }
    });
  }

  if (!hasDepartment) errs.department_id = 'You are not assigned to any department.';

  if (requiresReturnDate(form.type)) {
    form.items.forEach((item, idx) => {
      if (!item.expected_return_date) {
        errs[`item_${idx}_expected_return_date`] = 'Return date is required for a Returnable Gate Pass.';
      } else if (item.expected_return_date < today) {
        errs[`item_${idx}_expected_return_date`] = 'Return date cannot be in the past.';
      }
    });
  }
  return errs;
}

/** The pass is due when its FIRST line is due. `gatepass.v_gate_passes` computes
 *  `is_overdue` and `due_state` off the pass-level column, so it must be
 *  populated even though the authoritative dates now live per item. */
export function earliestReturnDate(form: NewGatePass): string | null {
  if (!requiresReturnDate(form.type)) return null;
  const dates = form.items.map((i) => i.expected_return_date).filter(Boolean);
  return dates.length > 0 ? dates.slice().sort()[0] : null;
}

/** The `{"n","a","v"}` blob for `visitor_company`, or null when the HOD filled in
 *  none of the three optional vendor fields.
 *
 *  Writing `{"n":"","a":"","v":""}` put a JSON blob in the column for a pass that
 *  has no vendor at all — the old `JSON.stringify({...}) || null` could never be
 *  null, since stringify always returns a non-empty string. `company_name_of()`
 *  and `parseCompanyInfo()` both cope with the blob now, but a null column is the
 *  honest record of "no vendor given". */
export function packVendor(form: NewGatePass): string | null {
  const n = form.visitor_company.trim();
  const a = form.company_address.trim();
  const v = form.visitor_phone.trim();
  if (!n && !a && !v) return null;
  return JSON.stringify({ n, a, v });
}
