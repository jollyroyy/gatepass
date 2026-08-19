// Everything on the raise form ABOVE the item table, drawn to the client's
// 2026-08-19 "Raise Gate Pass" mock-up, in the mock's own order:
//
//   Pass Type · Pass Details · Vendor Details · Carrier / Person Details · Purpose
//
// PASS DETAILS IS NOT ON THE MOCK, and is here on the client's instruction the
// same day: "department, vehicle number and expected date of return — all this
// should be for the entire pass … mentioned on top of it. No need to give it
// that for each individual item." So the three pass-wide facts sit together,
// once, above the vendor.
import React from 'react';
import type { DeptOption, NewGatePass, PassType, VendorProfile } from '../../types';
import PassTypeSelector from './PassTypeSelector';
import { requiresReturnDate } from '../../lib/passTypes';
import { todayStr, PURPOSE_MAX } from '../../lib/raisePassForm';
import { DIAL_CODES, joinMobile, splitMobile } from '../../lib/mobileNumber';

/** The sentinel the vendor select carries when the HOD is typing a vendor this
 *  department has never dealt with. Not a UUID, and not `''` — an empty value on
 *  a select is "nothing chosen yet", which is a different state. */
export const NEW_VENDOR = '__new';

interface PassDetailsCardsProps {
  form: NewGatePass;
  errors: Record<string, string | undefined>;
  depts: DeptOption[];
  vendors: VendorProfile[];
  vendorId: string;
  onTypeChange: (type: PassType) => void;
  onUpdate: <K extends keyof NewGatePass>(key: K, value: NewGatePass[K]) => void;
  onVendorPick: (vendorId: string) => void;
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
  depts,
  vendors,
  vendorId,
  onTypeChange,
  onUpdate,
  onVendorPick,
}: PassDetailsCardsProps): React.ReactElement {
  const mobile = splitMobile(form.visitor_phone);
  // An address that came off a stored vendor is READ-ONLY, exactly as the mock
  // draws it ("Auto-filled"). It is editable only while a new vendor is being
  // typed, because that is the one moment the app has nowhere else to get it.
  const addressLocked = vendorId !== NEW_VENDOR && vendorId !== '';

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
            <label className="label" htmlFor="rp-dept">Department</label>
            <select
              id="rp-dept"
              className="input"
              value={form.department_id}
              onChange={(e) => onUpdate('department_id', e.target.value)}
              disabled={depts.length <= 1}
            >
              {depts.length === 0 && <option value="">No department assigned</option>}
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{`${d.name} (${d.code})`}</option>
              ))}
            </select>
            {errors.department_id && <p className="field-error">{errors.department_id}</p>}
          </div>

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

          {/* ONE deadline for the whole pass — client, 2026-08-19: "the return
              date of all individual items in the pass should be the expected
              return date of the entire pass." Every item is written with this
              same date at submit; there is no per-item input any more. An NRGP
              never comes back, so the field is not drawn at all for one. */}
          {requiresReturnDate(form.type) && (
            <div>
              <label className="label" htmlFor="rp-return">
                Expected Return Date<Req />
              </label>
              <input
                id="rp-return"
                type="date"
                className="input"
                aria-label="Expected Return Date"
                value={form.expected_return_date}
                onChange={(e) => onUpdate('expected_return_date', e.target.value)}
                min={todayStr()}
              />
              {errors.expected_return_date && <p className="field-error">{errors.expected_return_date}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="rp-section">
        <Legend>Vendor Details</Legend>
        <div className="rp-grid">
          <div>
            <label className="label" htmlFor="rp-vendor">
              Vendor Name<Req />
            </label>
            <select
              id="rp-vendor"
              className="input"
              value={vendorId}
              onChange={(e) => onVendorPick(e.target.value)}
            >
              <option value="">Select or enter vendor name</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.company_name}</option>
              ))}
              <option value={NEW_VENDOR}>+ Enter a new vendor</option>
            </select>
            {vendorId === NEW_VENDOR && (
              <input
                className="input mt-2"
                aria-label="New vendor name"
                placeholder="Enter vendor name"
                value={form.visitor_company}
                onChange={(e) => onUpdate('visitor_company', e.target.value)}
              />
            )}
            {errors.visitor_company && <p className="field-error">{errors.visitor_company}</p>}
          </div>

          <div>
            <label className="label" htmlFor="rp-address">
              Vendor Address <span className="rp-hint">(Auto-filled)</span>
            </label>
            <input
              id="rp-address"
              className="input"
              aria-label="Vendor Address"
              placeholder={addressLocked ? 'Will be auto-filled based on selected vendor' : 'Street, area, city, pincode'}
              value={form.company_address}
              readOnly={addressLocked}
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
