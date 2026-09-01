// Everything on the raise form ABOVE the item table, drawn to the client's
// 2026-08-19 "Raise Gate Pass" mock-up, in the mock's own order:
//
//   Pass Type · Pass Details · Vendor Details · Carrier / Person Details · Purpose
//
// PASS DETAILS IS NOT ON THE MOCK, and is here on the client's instruction. It
// carries TWO things now (2026-08-19):
//
//   Reference Number — read-only, at the top: "show the reference number of the
//                      RGP or NRGP pass and it should be uneditable". See
//                      `passNumberPreview` for why the serial reads `####`.
//   Vehicle Number   — one vehicle for the whole pass.
//
// THE DEPARTMENT FIELD IS GONE FOR AN HOD (client: "no need to show the
// department because it will be automatically captured") — the form resolves it
// from their own `hod_departments` assignment and sends it, it is simply not
// asked for. IT IS A FIELD AGAIN FOR THE COO AND THE CEO, and only for them
// (client, 2026-08-31: "ceo and coo can select the department to raise the
// gatepass"): they head no department, so there is nothing to capture
// automatically and the pass has no department at all until they say which.
// That is the ONE difference between the two forms — `departments` is passed
// only when the reader may choose, and an absent list draws the HOD's form
// exactly as it was.
// THE PASS-LEVEL RETURN DATE IS GONE TOO: a date is taken against each ITEM
// now, and the pass's deadline is the earliest of them.
import React from 'react';
import type { DeptOption, NewGatePass, PassType } from '../../types';
import PassTypeSelector from './PassTypeSelector';
import { passNumberPreview, PURPOSE_MAX } from '../../lib/raisePassForm';
import { DIAL_CODES, joinMobile, splitMobile } from '../../lib/mobileNumber';

interface PassDetailsCardsProps {
  form: NewGatePass;
  errors: Record<string, string | undefined>;
  onTypeChange: (type: PassType) => void;
  onUpdate: <K extends keyof NewGatePass>(key: K, value: NewGatePass[K]) => void;
  /** The departments this reader may raise for, when they may CHOOSE one — a
   *  sitting COO or CEO (069). Absent for an HOD, whose department is resolved
   *  from their own assignment and never asked for. */
  departments?: DeptOption[];
  /** The code of the department the pass will be raised for, whether it was
   *  chosen or captured — it is the middle segment of the reference number
   *  (064), so an HOD who is never shown the field still sees `RGP-IT-####`. */
  deptCode?: string | null;
  /** The number really reserved for this pass (074), or null while it is being
   *  taken — or if it could not be. Null falls back to the `####` preview. */
  reservedNumber?: string | null;
}

function Legend({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h2 className="rp-legend">{children}</h2>;
}

function Req(): React.ReactElement {
  return <span className="rp-req" aria-hidden="true"> *</span>;
}

export default function PassDetailsCards({
  form,
  errors,
  onTypeChange,
  onUpdate,
  departments,
  deptCode,
  reservedNumber = null,
}: PassDetailsCardsProps): React.ReactElement {
  const mobile = splitMobile(form.visitor_phone);
  // The reference number's middle segment is the DEPARTMENT's code (064), so
  // the preview follows whatever department the pass will be raised for: an
  // HOD's own, or the one a COO picked a moment ago in the selector below.

  return (
    <>
      <section className="rp-section">
        <Legend>Pass Type</Legend>
        <PassTypeSelector value={form.type} onChange={onTypeChange} />
      </section>

      <section className="rp-section">
        <Legend>Pass Details</Legend>
        <div className="rp-grid">
          <div>
            <label className="label" htmlFor="rp-ref">Reference Number</label>
            {/* READ-ONLY, never `disabled`: a disabled input is skipped by the
                keyboard and greys the very characters the HOD is being asked to
                note down.
                IT IS THE REAL NUMBER NOW (client, 2026-09-01: "make the gate
                pass reference number visible fully while they are creating the
                pass"). Migration 074 reserves it when the form opens, so this
                is what the pass will carry rather than a shape ending `####`.
                The preview is still the fallback for the two moments there is
                no number: while the reservation is in flight, and when it could
                not be taken at all — in both, the pass still submits and the
                database numbers it on insert. */}
            <input
              id="rp-ref"
              className="input rp-ref"
              aria-label="Reference Number"
              value={reservedNumber ?? passNumberPreview(form.type, deptCode)}
              readOnly
            />
            <p className="rp-hint mt-1">
              {reservedNumber
                ? 'This is the number this pass will carry. Note it down if you need it.'
                : 'The serial is assigned when the pass is submitted.'}
            </p>
          </div>

          {departments && (
            <div>
              <label className="label" htmlFor="rp-dept">Department<Req /></label>
              {/* A NATIVE SELECT, not a search box: a mall has tens of
                  departments, not thousands, and the COO picking one is the
                  whole difference between this form and the HOD's. The blank
                  first option is deliberate — nothing is pre-selected, so a
                  pass cannot be raised against a department nobody chose. */}
              <select
                id="rp-dept"
                className="input"
                value={form.department_id}
                onChange={(e) => onUpdate('department_id', e.target.value)}
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
              {errors.department_id && <p className="field-error">{errors.department_id}</p>}
              <p className="rp-hint mt-1">
                The pass is raised on this department's behalf and carries its code.
              </p>
            </div>
          )}

          <div>
            <label className="label" htmlFor="rp-vehicle">Vehicle Number</label>
            <input
              id="rp-vehicle"
              className="input"
              value={form.vehicle_number}
              onChange={(e) => onUpdate('vehicle_number', e.target.value)}
              placeholder="Optional — e.g. KA01AB1234"
            />
          </div>
        </div>
      </section>

      <section className="rp-section">
        <Legend>Vendor Details</Legend>
        <div className="rp-grid">
          <div>
            <label className="label" htmlFor="rp-vendor">
              Vendor Name<Req />
            </label>
            <input
              id="rp-vendor"
              className="input"
              aria-label="Vendor Name"
              placeholder="Enter vendor name"
              value={form.visitor_company}
              onChange={(e) => onUpdate('visitor_company', e.target.value)}
            />
            {errors.visitor_company && <p className="field-error">{errors.visitor_company}</p>}
          </div>

          <div>
            <label className="label" htmlFor="rp-address">Vendor Address</label>
            <input
              id="rp-address"
              className="input"
              aria-label="Vendor Address"
              placeholder="Street, area, city, pincode"
              value={form.company_address}
              onChange={(e) => onUpdate('company_address', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rp-section">
        <Legend>Carrier / Person Details</Legend>
        <div className="rp-grid">
          <div>
            <label className="label" htmlFor="rp-carrier">
              Person Who Will Carry<Req />
            </label>
            <input
              id="rp-carrier"
              className="input"
              value={form.visitor_name}
              onChange={(e) => onUpdate('visitor_name', e.target.value)}
              placeholder="Enter person name"
            />
            {errors.visitor_name && <p className="field-error">{errors.visitor_name}</p>}
          </div>

          <div>
            <label className="label" htmlFor="rp-mobile">
              Mobile Number<Req />
            </label>
            <div className="rp-phone">
              <select
                className="input rp-dial"
                aria-label="Country code"
                value={mobile.dial}
                onChange={(e) => onUpdate('visitor_phone', joinMobile(e.target.value, mobile.digits))}
              >
                {DIAL_CODES.map((d) => (
                  <option key={d.code} value={d.code}>{d.label}</option>
                ))}
              </select>
              <input
                id="rp-mobile"
                type="tel"
                inputMode="numeric"
                className="input"
                placeholder="Enter mobile number"
                value={mobile.digits}
                onChange={(e) => onUpdate('visitor_phone', joinMobile(mobile.dial, e.target.value))}
              />
            </div>
            {errors.visitor_phone && <p className="field-error">{errors.visitor_phone}</p>}
          </div>
        </div>
      </section>

      <section className="rp-section">
        <Legend>Purpose</Legend>
        <label className="label" htmlFor="rp-purpose">
          Purpose / Description<Req />
        </label>
        <textarea
          id="rp-purpose"
          className="input rp-purpose"
          rows={3}
          maxLength={PURPOSE_MAX}
          value={form.purpose}
          onChange={(e) => onUpdate('purpose', e.target.value)}
          placeholder="Enter purpose / description for the gate pass"
        />
        <div className="rp-counter">{`${form.purpose.length}/${PURPOSE_MAX}`}</div>
        {errors.purpose && <p className="field-error">{errors.purpose}</p>}
      </section>
    </>
  );
}
