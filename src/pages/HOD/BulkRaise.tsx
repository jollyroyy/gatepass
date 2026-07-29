import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gp, pub } from '../../supabaseClient';
import type { NewGatePass, NewGatePassItem } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { PASS_TYPES, PASS_TYPE_LIST, requiresReturnDate } from '../../lib/passTypes';
import { safeErrorMessage } from '../../lib/errors';

interface BulkResult {
  pass_id: string;
  pass_number: string;
}

interface DeptOption { id: string; name: string; }

const todayStr = (): string => new Date().toISOString().slice(0, 10);

type FormErrors = Partial<Record<keyof NewGatePass | 'count' | 'namePrefix', string>>;

export default function BulkRaise(): React.ReactElement {
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewGatePass & { namePrefix: string; count: number }>({
    type: 'NRGP', direction: 'out', department_id: '',
    visitor_name: '', visitor_company: '', company_contact: '', company_phone: '', company_address: '',
    vehicle_number: '', purpose: '',
    expected_return_date: '', items: [{ ...EMPTY_ITEM }], namePrefix: 'Worker', count: 5,
  });
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    let cancelled = false;
    async function loadDepts() {
      try {
        const { data } = await gp().from('hod_departments').select('department_id');
        if (!data || data.length === 0) return;
        const ids = data.map((r: { department_id: string }) => r.department_id);
        const { data: depts } = await pub().from('departments').select('id, name').in('id', ids).order('name');
        if (!cancelled && depts) {
          const list = (depts as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name }));
          setDepts(list);
          if (list.length > 0) setForm((f) => ({ ...f, department_id: list[0].id }));
        }
      } catch { /* ignore */ }
    }
    loadDepts();
    return () => { cancelled = true; };
  }, []);

  function handleTypeChange(t: NewGatePass['type']) {
    setForm((f) => ({ ...f, type: t }));
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function addItem() { setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] })); }
  function removeItem(i: number) {
    if (form.items.length <= 1) return;
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  }
  function updateItem(i: number, key: keyof NewGatePassItem, value: string) {
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], [key]: value };
      return { ...f, items };
    });
  }

  function validate(): boolean {
    const errs: FormErrors = {};
    if (form.count < 2 || form.count > 100) errs.count = 'Count must be between 2 and 100';
    if (!form.namePrefix.trim()) errs.namePrefix = 'Name prefix is required';
    if (!form.department_id) errs.department_id = 'No department assigned';
    const hasItem = form.items.some((it) => it.description.trim().length > 0);
    if (!hasItem) errs.items = 'Add at least one material line';
    if (!form.visitor_company.trim()) errs.visitor_company = 'Company is required';
    if (!form.purpose.trim()) errs.purpose = 'Purpose is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = form.items
        .filter((it) => it.description.trim())
        .map((it) => ({
          description: it.description.trim(),
          quantity: parseFloat(it.quantity) || 1,
          unit: it.unit.trim() || 'nos',
          serial_no: it.serial_no.trim() || undefined,
          approx_value: it.approx_value.trim() || undefined,
        }));

      const { data, error: rpcErr } = await gp().rpc('bulk_create_passes', {
        p_type: form.type,
        p_direction: 'out',
        p_department_id: form.department_id,
        p_visitor_company: JSON.stringify({
          n: form.visitor_company.trim(),
          c: form.company_contact.trim(),
          p: form.company_phone.trim(),
          a: form.company_address.trim(),
        }) || null,
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_purpose: form.purpose.trim(),
        p_expected_return_date: form.expected_return_date || null,
        p_items: items,
        p_count: form.count,
        p_name_prefix: form.namePrefix.trim(),
      });
      if (rpcErr) throw rpcErr;
      setResults((data as BulkResult[]) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (results) {
    return (
      <div className="card p-6">
        <div className="alert-success mb-4">{results.length} passes created successfully.</div>
        <div className="flex flex-col gap-2 mb-6 max-h-96 overflow-y-auto">
          {results.map((r) => (
            <Link key={r.pass_id} to={`/pass/${r.pass_id}`} className="list-item text-sm font-mono">
              {r.pass_number}
            </Link>
          ))}
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn-primary" onClick={() => setResults(null)}>Create Another Batch</button>
          <Link to="/my-passes" className="btn-secondary">View All in My Passes</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bulk Create Passes</h1>
        <p className="page-subtitle">Generate multiple passes from one template.</p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-5 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name Prefix</label>
            <input className={`input ${errors.namePrefix ? 'input-error' : ''}`} value={form.namePrefix}
              onChange={(e) => update('namePrefix', e.target.value)} placeholder="Worker" />
            {errors.namePrefix && <p className="field-error">{errors.namePrefix}</p>}
          </div>
          <div>
            <label className="label">Number of Passes</label>
            <input type="number" className={`input ${errors.count ? 'input-error' : ''}`} min={2} max={100}
              value={form.count} onChange={(e) => update('count', parseInt(e.target.value) || 5)} />
            {errors.count && <p className="field-error">{errors.count}</p>}
          </div>
        </div>

        <div>
          <div>
            <label className="label">Pass Type</label>
            <select className="input" value={form.type} onChange={(e) => handleTypeChange(e.target.value as NewGatePass['type'])}>
              {PASS_TYPE_LIST.map((t) => <option key={t} value={t}>{PASS_TYPES[t].label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Department</label>
          {depts.length > 0 ? (
            <p className="text-sm font-medium text-navy-900 py-2">{depts[0].name}</p>
          ) : (
            <p className="text-sm text-flagged-700 py-2">No department assigned</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Company</label>
            <input className={`input ${errors.visitor_company ? 'input-error' : ''}`} value={form.visitor_company}
              onChange={(e) => update('visitor_company', e.target.value)} placeholder="Contractor / vendor name" />
            {errors.visitor_company && <p className="field-error">{errors.visitor_company}</p>}
          </div>
          <div>
            <label className="label">Vehicle Number</label>
            <input className="input" value={form.vehicle_number} onChange={(e) => update('vehicle_number', e.target.value)}
              placeholder="Optional" />
          </div>
        </div>

        <div>
          <label className="label">Purpose</label>
          <input className={`input ${errors.purpose ? 'input-error' : ''}`} value={form.purpose}
            onChange={(e) => update('purpose', e.target.value)} placeholder="e.g. Event setup materials" />
          {errors.purpose && <p className="field-error">{errors.purpose}</p>}
        </div>

        {requiresReturnDate(form.type) && (
          <div>
            <label className="label">Expected Return Date</label>
            <input type="date" className="input" min={todayStr()} value={form.expected_return_date}
              onChange={(e) => update('expected_return_date', e.target.value)} />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label !mb-0">Material Lines</label>
            <button type="button" className="btn-sm" onClick={addItem}>+ Add Line</button>
          </div>
          {errors.items && <p className="field-error mb-2">{errors.items}</p>}
          {form.items.map((item, i) => (
            <div key={i} className="flex flex-wrap gap-2 mb-2 items-end">
              <input className="input flex-1 min-w-[140px]" placeholder="Description" value={item.description}
                onChange={(e) => updateItem(i, 'description', e.target.value)} />
              <input type="number" className="input w-20" placeholder="Qty" value={item.quantity}
                onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
              <input className="input w-20" placeholder="Unit" value={item.unit}
                onChange={(e) => updateItem(i, 'unit', e.target.value)} />
              <input className="input w-28" placeholder="Serial no." value={item.serial_no}
                onChange={(e) => updateItem(i, 'serial_no', e.target.value)} />
              <input type="number" className="input w-28" placeholder="Approx value" value={item.approx_value}
                onChange={(e) => updateItem(i, 'approx_value', e.target.value)} />
              <button type="button" className="btn-danger btn-sm" disabled={form.items.length <= 1}
                onClick={() => removeItem(i)}>×</button>
            </div>
          ))}
        </div>

        <button type="submit" className="btn-primary self-start" disabled={submitting}>
          {submitting ? `Creating ${form.count} passes…` : `Create ${form.count} Passes`}
        </button>
      </form>
    </div>
  );
}
