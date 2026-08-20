// The raise-pass form's rules, extracted from RaisePass.tsx so that file stays
// under the 300-line cap once it also became the "raise it again" screen.
//
// Pure functions over the form state — no React, no supabase. That is what lets
// a test assert the RGP return-date rule without mounting a form and filling in
// eight fields to reach it.
import type { NewGatePass, NewGatePassItem, PassType } from '../types';
import { requiresReturnDate } from './passTypes';
import { isWholeUnit, wholeUnitError } from './units';

export type FormErrors = Record<string, string | undefined>;

/** The mock's counter reads `0/500`, and the column behind it is free `text` —
 *  this cap is the form's own, so it lives here beside the rule that enforces
 *  it rather than being typed twice. */
export const PURPOSE_MAX = 500;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The reference number this pass WILL carry, shown read-only at the top of the
 *  form (client, 2026-08-19: "show the reference number of the RGP or NRGP pass
 *  and it should be uneditable").
 *
 *  THE SERIAL IS `####`, AND THAT IS DELIBERATE. `gatepass.set_pass_number()`
 *  (042) assigns the number inside the INSERT, under an advisory lock, as
 *  `TYPE-YYYYMMDD-NNNN`. Nothing outside that transaction can know NNNN: two
 *  HODs filling this form at the same moment would both be shown the same
 *  serial and one of them would be wrong, and an HOD reads only their own
 *  department's passes anyway, so a count here could not even be made to
 *  guess. The prefix is exact; the four digits are honestly unknown until the
 *  pass exists, and the modal that follows the submit states the real number.
 *
 *  The date is the UTC date, not the local one — that is what the trigger uses
 *  (`(now() at time zone 'UTC')::date`), and `todayStr()` is UTC too, so the
 *  two agree by construction. */
export function passNumberPreview(type: PassType, today: string = todayStr()): string {
  return `${type}-${today.replace(/-/g, '')}-####`;
}

/** The PASS's deadline, derived from its lines: the earliest date any item is
 *  due back, or null when none carries one (every NRGP, and an RGP that has not
 *  been filled in yet).
 *
 *  A pass is overdue as soon as its FIRST line is late — `v_gate_passes` grades
 *  `is_overdue` off the pass's own column, and taking the latest date instead
 *  would leave material sitting outside, past its own date, on a pass the board
 *  calls on time. */
export function earliestReturnDate(items: NewGatePassItem[]): string | null {
  const dates = items.map((i) => i.expected_return_date).filter((d) => !!d).sort();
  return dates[0] ?? null;
}

/** Everything wrong with the form, keyed the way the inputs are named.
 *
 *  WHICH FIELDS ARE REQUIRED IS THE MOCK'S DECISION, not this file's: the
 *  client's 2026-08-19 "Raise Gate Pass" drawing puts a red asterisk on Vendor
 *  Name, Person Who Will Carry, Mobile Number, Purpose / Description, and — per
 *  line — Item Description, Quantity and Make / Model / Size. Everything else it
 *  draws (Vendor Address, Serial / Asset Tag, Invoice / Reference No., Remarks)
 *  carries no asterisk and is optional here.
 *
 *  THE RETURN DATE IS PER LINE AGAIN (client, 2026-08-19: "we would expect a
 *  date of return against each item in the RGP form"), and the pass-level
 *  column is the earliest of them. The history below is kept because it is the
 *  reason this rule keeps moving, and each move has broken the form once. Migration `019` replaced a
 *  pass-level field with per-item dates; for two months after it, this function
 *  still demanded a pass-level `expected_return_date` the form no longer
 *  rendered, so every RGP submit failed validation on a field nobody could see
 *  or fill — that bug is why the per-item shape existed here at all. The client
 *  has now decided the OPPOSITE ("the return date of all individual items in the
 *  pass should be the expected return date of the entire pass", and again on
 *  2026-08-19 of the new mock: "department, vehicle number and expected date of
 *  return — all this should be for the entire pass"), so the pass-level field is
 *  once again the INPUT, and every item is written with the same date. The
 *  database column this validates — `gate_passes.expected_return_date` — never
 *  moved; it is still the one `gatepass.v_gate_passes` grades `is_overdue` /
 *  `due_state` from.
 *
 *  THE UNIT RULE IS BACK, because the line carries a unit again (client,
 *  2026-08-20). `isWholeUnit` is the ONE place a unit is judged countable and
 *  both this form and the gate's return box read it — so a pass can never be
 *  raised in a quantity `checkReturnQty` would later refuse to return.
 */
export function validateRaiseForm(form: NewGatePass, hasDepartment: boolean, today: string): FormErrors {
  const errs: FormErrors = {};

  if (!form.visitor_company.trim()) errs.visitor_company = 'Vendor name is required.';
  if (!form.visitor_name.trim()) errs.visitor_name = 'Enter the name of the person who will carry the material.';

  const mobile = form.visitor_phone.replace(/\D/g, '');
  if (!form.visitor_phone.trim()) {
    errs.visitor_phone = 'Mobile number is required.';
  } else if (mobile.length < 7 || mobile.length > 15) {
    // Deliberately not an India-only 10-digit rule: the form carries a dial-code
    // selector, and a supplier on a Gulf number is an ordinary vendor here.
    errs.visitor_phone = 'Enter a valid mobile number.';
  }

  if (!form.purpose.trim()) {
    errs.purpose = 'Purpose / description is required.';
  } else if (form.purpose.length > PURPOSE_MAX) {
    errs.purpose = `Keep the purpose under ${PURPOSE_MAX} characters.`;
  }

  if (form.items.length === 0) {
    errs.items = 'At least one material item is required.';
  } else {
    form.items.forEach((item, idx) => {
      if (!item.name.trim()) errs[`item_${idx}_name`] = 'Item description is required.';
      if (!item.make_model.trim()) errs[`item_${idx}_make_model`] = 'Make / model / size is required.';
      const qty = Number(item.quantity);
      if (!item.quantity || Number.isNaN(qty) || qty <= 0) {
        errs[`item_${idx}_quantity`] = 'Enter a quantity greater than 0.';
      } else if (isWholeUnit(item.unit) && !Number.isInteger(qty)) {
        // A COUNTED UNIT TAKES NO FRACTION, and the rule has to be here as well
        // as in the return box: 2.5 boxes raised is 2.5 the gate can never fully
        // return, since `checkReturnQty` would refuse every fraction that
        // clears it. A MEASURED unit (kg, litre, metre) keeps its decimals —
        // 800.5 Kg is an ordinary movement. No ceiling is passed: nothing caps
        // how much material a pass may be raised for.
        errs[`item_${idx}_quantity`] = wholeUnitError(item.unit, qty);
      }
    });
  }

  if (!hasDepartment) errs.department_id = 'You are not assigned to any department.';

  // ONE DATE PER LINE on an RGP (client, 2026-08-19: "we would expect a date of
  // return against each item in the RGP form"), checked against the same two
  // rules the pass-level field used to carry. The pass's own deadline is the
  // earliest of them (`earliestReturnDate`), so it cannot be missing or in the
  // past once every line passes here. An NRGP never comes back and is not asked.
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

/** The `{"n","a","v"}` blob for `visitor_company`, or null when the HOD filled in
 *  none of the three optional vendor fields.
 *
 *  Writing `{"n":"","a":"","v":""}` put a JSON blob in the column for a pass that
 *  has no vendor at all — the old `JSON.stringify({...}) || null` could never be
 *  null, since stringify always returns a non-empty string. `company_name_of()`
 *  and `parseCompanyInfo()` both cope with the blob now, but a null column is the
 *  honest record of "no vendor given".
 *
 *  THE PASS KEEPS ITS OWN COPY OF THE ADDRESS on purpose, even though migration
 *  045 gave the vendor profile a real `address` column: the profile is the
 *  vendor as it is TODAY, and a slip printed last month must not change because
 *  somebody corrected a pincode this morning. */
export function packVendor(form: NewGatePass): string | null {
  const n = form.visitor_company.trim();
  const a = form.company_address.trim();
  const v = form.visitor_phone.trim();
  if (!n && !a && !v) return null;
  return JSON.stringify({ n, a, v });
}
