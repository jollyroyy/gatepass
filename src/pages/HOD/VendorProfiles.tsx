import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { VendorProfile } from '../../types';
import { safeErrorMessage } from '../../lib/errors';

const EMPTY_FORM = { company_name: '', contact_person: '', phone: '', vehicle_number: '', typical_material: '' };

export default function VendorProfiles(): React.ReactElement {
  const [rows, setRows] = useState<VendorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: rpcErr } = await gp().rpc('list_vendor_profiles', {});
      if (rpcErr) throw rpcErr;
      setRows((data as VendorProfile[]) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) return;
    setSaving(true);
    try {
      const { error: rpcErr } = await gp().rpc('save_vendor_profile', {
        p_company_name: form.company_name.trim(),
        p_contact_person: form.contact_person.trim() || null,
        p_phone: form.phone.trim() || null,
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_typical_material: form.typical_material.trim() || null,
        p_department_id: null, // Will be set by the function's dept check
      });
      if (rpcErr) throw rpcErr;
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error: rpcErr } = await gp().rpc('delete_vendor_profile', { p_id: id });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err) {
      setError(safeErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Vendor Profiles</h1>
        <p className="page-subtitle">Saved contractor and vendor data for quick pass creation.</p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="flex justify-end mb-4">
        <button type="button" className="btn-primary" onClick={() => { setShowForm(!showForm); setForm(EMPTY_FORM); }}>
          {showForm ? 'Cancel' : 'Add Vendor'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="card p-5 mb-6 flex flex-col gap-3 max-w-lg">
          <input className="input" placeholder="Company name *" value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
          <input className="input" placeholder="Contact person" value={form.contact_person}
            onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          <input className="input" placeholder="Phone" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="input" placeholder="Vehicle number" value={form.vehicle_number}
            onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
          <input className="input" placeholder="Typical material" value={form.typical_material}
            onChange={(e) => setForm({ ...form, typical_material: e.target.value })} />
          <button type="submit" className="btn-primary self-start" disabled={saving || !form.company_name.trim()}>
            {saving ? 'Saving…' : 'Save Vendor'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty-state">No vendor profiles saved yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Typical Material</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-navy-900">{r.company_name}</td>
                  <td>{r.contact_person ?? '—'}</td>
                  <td>{r.phone ?? '—'}</td>
                  <td>{r.vehicle_number ?? '—'}</td>
                  <td className="max-w-[200px] truncate">{r.typical_material ?? '—'}</td>
                  <td>
                    <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
