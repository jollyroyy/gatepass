// "Pass Details", "Visitor Details" and "Vendor Details" cards for RaisePass.tsx.
import React from 'react';
import type { NewGatePass, PassType, VendorProfile } from '../../types';
import PassTypeSelector from './PassTypeSelector';

interface PassDetailsCardsProps {
  form: NewGatePass;
  errors: Record<string, string | undefined>;
  vendors: VendorProfile[];
  saveVendor: boolean;
  onTypeChange: (type: PassType) => void;
  onUpdate: <K extends keyof NewGatePass>(key: K, value: NewGatePass[K]) => void;
  onSaveVendorChange: (checked: boolean) => void;
}

export default function PassDetailsCards({
  form,
  errors,
  vendors,
  saveVendor,
  onTypeChange,
  onUpdate,
  onSaveVendorChange,
}: PassDetailsCardsProps): React.ReactElement {
  return (
    <>
      {/* Pass Type & Department */}
      <div className="card p-5">
        <h2 className="card-title mb-4">Pass Details</h2>
        <div>
          <label className="label">Pass Type</label>
          <PassTypeSelector value={form.type} onChange={onTypeChange} />
        </div>
      </div>

      {/* Visitor Details */}
      <div className="card p-5">
        <h2 className="card-title mb-4">Visitor Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Visitor Name</label>
            <input className="input" value={form.visitor_name} onChange={(e) => onUpdate('visitor_name', e.target.value)} placeholder="Person authorized to collect material" />
            {errors.visitor_name && <p className="field-error">{errors.visitor_name}</p>}
          </div>
          <div>
            <label className="label">Contact Number</label>
            <input type="tel" className="input" value={form.visitor_phone} onChange={(e) => onUpdate('visitor_phone', e.target.value)} placeholder="Phone number" />
          </div>
        </div>
      </div>

      {/* Vendor Details */}
      <div className="card p-5">
        <h2 className="card-title mb-4">Vendor Details</h2>
        <div>
          <label className="label">Vendor Name</label>
          <input className="input" value={form.visitor_company} onChange={(e) => onUpdate('visitor_company', e.target.value)} placeholder="Vendor name" />
          {vendors.length > 0 && (
            <select className="input mt-2 text-sm" defaultValue=""
              onChange={(e) => {
                const v = vendors.find((x) => x.id === e.target.value);
                if (!v) return;
                onUpdate('visitor_company', v.company_name);
                if (v.vehicle_number) onUpdate('vehicle_number', v.vehicle_number);
              }}>
              <option value="" disabled>Load from vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          )}
        </div>
        <div className="mt-4">
          <label className="label">Vendor Address</label>
          <textarea className="input" rows={2} value={form.company_address} onChange={(e) => onUpdate('company_address', e.target.value)} placeholder="Street, area, city, pincode" />
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Vehicle Number</label>
            <input className="input" value={form.vehicle_number} onChange={(e) => onUpdate('vehicle_number', e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-navy-600 cursor-pointer">
              <input type="checkbox" checked={saveVendor} onChange={(e) => onSaveVendorChange(e.target.checked)} />
              Save as vendor profile
            </label>
          </div>
        </div>
      </div>
    </>
  );
}
