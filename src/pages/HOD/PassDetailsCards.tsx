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
// THE DEPARTMENT FIELD IS GONE (client: "no need to show the department because
// it will be automatically captured") — the form still resolves it from the
// HOD's own `hod_departments` assignment and sends it, it is simply not asked
// for. THE PASS-LEVEL RETURN DATE IS GONE TOO: a date is taken against each ITEM
// now, and the pass's deadline is the earliest of them.
import React from 'react';
import type { NewGatePass, PassType, VendorProfile } from '../../types';
import PassTypeSelector from './PassTypeSelector';
import { passNumberPreview, PURPOSE_MAX } from '../../lib/raisePassForm';
import { DIAL_CODES, joinMobile, splitMobile } from '../../lib/mobileNumber';

/** The sentinel the vendor select carries when the HOD is typing a vendor this
 *  department has never dealt with. Not a UUID, and not `''` — an empty value on
 *  a select is "nothing chosen yet", which is a different state. */
export const NEW_VENDOR = '__new';

interface PassDetailsCardsProps {
  form: NewGatePass;
  errors: Record<string, string | undefined>;
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
            <label className="label" htmlFor="rp-ref">Reference Number</label>
            {/* READ-ONLY, never `disabled`: a disabled input is skipped by the
                keyboard and greys the very characters the HOD is being asked to
                note down. The number itself is assigned by the database when
                the pass is inserted — the modal after the submit states it in
                full. */}
            <input
              id="rp-ref"
              className="input rp-ref"
              aria-label="Reference Number"
              value={passNumberPreview(form.type)}
              readOnly
            />
            <p className="rp-hint mt-1">The serial is assigned when the pass is submitted.</p>
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
