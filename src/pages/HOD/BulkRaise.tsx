import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gp, pub } from '../../supabaseClient';
import type { NewGatePass, NewGatePassItem, PassDirection } from '../../types';
import { EMPTY_ITEM } from '../../types';
import { PASS_TYPES, PASS_TYPE_LIST, requiresReturnDate } from '../../lib/passTypes';
import { safeErrorMessage } from '../../lib/errors';

interface BulkResult {
  pass_id: string;
  pass_number: string;
}

const todayStr = (): string => new Date().toISOString().slice(0, 10);

type BulkForm = Omit<NewGatePass, 'type' | 'direction' | 'count'> & {
  type: NewGatePass['type'];
  direction: PassDirection;
  namePrefix: string;
  count: string;
};

type FormErrors = Partial<Record<keyof BulkForm, string>> & Record<string, string | undefined>;

export default function BulkRaise(): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BulkForm>({
    type: 'NRGP', direction: 'out', department_id: '',
    visitor_name: '', visitor_phone: '', visitor_company: '', company_address: '',
    vehicle_number: '', purpose: '',
    expected_return_date: '', items: [{ ...EMPTY_ITEM }], namePrefix: '', count: '2',
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
          if (list.length > 0) setForm((f) => ({ ...f, department_id: list[0].id }));
        }
      } catch { /* ignore */ }
    }
    loadDepts();
    return () => { cancelled = true; };
  }, []);

  function handleTypeChange(t: NewGatePass['type']) {
    setForm((f) => ({
      ...f,
      type: t,
      direction: t === 'NRGP' ? 'out' : f.direction,
      expected_return_date: requiresReturnDate(t) ? f.expected_return_date : '',
      items: f.items.map((item) => ({
        ...item,
        expected_return_date: requiresReturnDate(t) ? item.expected_return_date : '',
      })),
    }));
    setErrors((e) => ({ ...e, expected_return_date: undefined }));
  }

  function update<K extends keyof BulkForm>(key: K, value: BulkForm[K]) {
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
    if (!form.namePrefix.trim()) errs.namePrefix = 'Name prefix is required';
    const count = Number(form.count);
    if (!form.count || Number.isNaN(count) || count < 2 || count > 100) {
      errs.count = 'Count must be between 2 and 100';
    }
    if (!form.department_id) errs.department_id = 'No department assigned';
    const hasItem = form.items.some((it) => it.description.trim().length > 0);
    if (!hasItem) errs.items = 'Add at least one material line';
    form.items.forEach((it, i) => {
      if (!it.description.trim()) return;
      const qty = Number(it.quantity);
      if (!it.quantity || Number.isNaN(qty) || qty <= 0) {
        errs[`item_${i}_quantity`] = 'Enter a quantity greater than 0';
      }
    });
    if (!form.visitor_company.trim()) errs.visitor_company = 'Vendor is required';
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
          name: it.name.trim() || null,
          description: it.description.trim(),
          purpose: it.purpose.trim() || null,
          quantity: Number(it.quantity),
          unit: it.unit.trim() || null,
          serial_no: it.serial_no.trim() || null,
          approx_value: it.approx_value.trim() ? Number(it.approx_value) : null,
          expected_return_date: requiresReturnDate(form.type) ? (it.expected_return_date || null) : null,
        }));

      const { data, error: rpcErr } = await gp().rpc('bulk_create_passes', {
        p_type: form.type,
        p_direction: form.direction,
        p_department_id: form.department_id,
        p_visitor_company: JSON.stringify({
          n: form.visitor_company.trim(),
          a: form.company_address.trim(),
          v: form.visitor_phone.trim(),
        }) || null,
        p_vehicle_number: form.vehicle_number.trim() || null,
        p_purpose: form.purpose.trim(),
        p_expected_return_date: requiresReturnDate(form.type) ? (form.expected_return_date || null) : null,
        p_items: items,
        p_count: Number(form.count),
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

      <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-5 max-w-3xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bulk-name-prefix">Name Prefix</label>
            <input id="bulk-name-prefix" className={`input ${errors.namePrefix ? 'input-error' : ''}`} value={form.namePrefix}
              onChange={(e) => update('namePrefix', e.target.value)} placeholder="Contractor / staff name" />
            {errors.namePrefix && <p className="field-error">{errors.namePrefix}</p>}
          </div>
          <div>
            <label className="label" htmlFor="bulk-count">Number of Passes</label>
            <input id="bulk-count" type="number" className={`input ${errors.count ? 'input-error' : ''}`} min={2} max={100}
              value={form.count} onChange={(e) => update('count', e.target.value)} />
            {errors.count && <p className="field-error">{errors.count}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bulk-type">Pass Type</label>
            <select id="bulk-type" className="input" value={form.type} onChange={(e) => handleTypeChange(e.target.value as NewGatePass['type'])}>
              {PASS_TYPE_LIST.map((t) => <option key={t} value={t}>{PASS_TYPES[t].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bulk-direction">Direction</label>
            <select id="bulk-direction" className="input" value={form.direction}
              onChange={(e) => update('direction', e.target.value as PassDirection)}>
              <option value="out">Out</option>
              <option value="in" disabled={form.type === 'NRGP'}>In</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bulk-vendor">Vendor</label>
            <input id="bulk-vendor" className={`input ${errors.visitor_company ? 'input-error' : ''}`} value={form.visitor_company}
              onChange={(e) => update('visitor_company', e.target.value)} placeholder="Contractor / vendor name" />
            {errors.visitor_company && <p className="field-error">{errors.visitor_company}</p>}
          </div>
          <div>
            <label className="label" htmlFor="bulk-vehicle">Vehicle Number</label>
            <input id="bulk-vehicle" className="input" value={form.vehicle_number}
              onChange={(e) => update('vehicle_number', e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="bulk-phone">Contact Number</label>
            <input id="bulk-phone" type="tel" className="input" value={form.visitor_phone}
              onChange={(e) => update('visitor_phone', e.target.value)} placeholder="Phone number" />
          </div>
          <div>
            <label className="label" htmlFor="bulk-address">Company Address</label>
            <textarea id="bulk-address" className="input" rows={1} value={form.company_address}
              onChange={(e) => update('company_address', e.target.value)} placeholder="Street, area, city, pincode" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="bulk-purpose">Purpose</label>
          <input id="bulk-purpose" className={`input ${errors.purpose ? 'input-error' : ''}`} value={form.purpose}
            onChange={(e) => update('purpose', e.target.value)} placeholder="e.g. Event setup materials" />
          {errors.purpose && <p className="field-error">{errors.purpose}</p>}
        </div>

        {requiresReturnDate(form.type) && (
          <div>
            <label className="label" htmlFor="bulk-return">Expected Return Date</label>
            <input id="bulk-return" type="date" className="input" min={todayStr()} value={form.expected_return_date}
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
            <div key={i} className="flex flex-col gap-2 mb-3 p-3 bg-surface-50 rounded-lg">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[140px]">
                  <input className={`input ${errors[`item_${i}_name`] ? 'input-error' : ''}`} placeholder="Item name" value={item.name}
                    onChange={(e) => updateItem(i, 'name', e.target.value)} />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <input className={`input ${errors[`item_${i}_description`] ? 'input-error' : ''}`} placeholder="Description" value={item.description}
                    onChange={(e) => updateItem(i, 'description', e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-[2] min-w-[180px]">
                  <input className="input" placeholder="Purpose" value={item.purpose}
                    onChange={(e) => updateItem(i, 'purpose', e.target.value)} />
                </div>
                {requiresReturnDate(form.type) && (
                  <div className="w-[170px]">
                    <input type="date" className="input" min={todayStr()} value={item.expected_return_date}
                      onChange={(e) => updateItem(i, 'expected_return_date', e.target.value)} />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="label !text-[11px] !mb-1" htmlFor={`bulk-qty-${i}`}>Qty</label>
                  <input id={`bulk-qty-${i}`} type="number" min="0.01" step="0.01" className={`input w-20 ${errors[`item_${i}_quantity`] ? 'input-error' : ''}`}
                    value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} />
                  {errors[`item_${i}_quantity`] && <p className="field-error">{errors[`item_${i}_quantity`]}</p>}
                </div>
                <div>
                  <label className="label !text-[11px] !mb-1" htmlFor={`bulk-unit-${i}`}>Unit</label>
                  <input id={`bulk-unit-${i}`} className="input w-20" value={item.unit}
                    onChange={(e) => updateItem(i, 'unit', e.target.value)} placeholder="nos" />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <input className="input" placeholder="Serial no." value={item.serial_no}
                    onChange={(e) => updateItem(i, 'serial_no', e.target.value)} />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <input type="number" min="0" step="0.01" className="input" placeholder="Approx value" value={item.approx_value}
                    onChange={(e) => updateItem(i, 'approx_value', e.target.value)} />
                </div>
                <button type="button" className="btn-danger btn-sm" disabled={form.items.length <= 1}
                  onClick={() => removeItem(i)}>×</button>
              </div>
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
