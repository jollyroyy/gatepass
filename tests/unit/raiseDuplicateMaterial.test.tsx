// THE SAME MATERIAL MAY BE TYPED ON AS MANY LINES AS THE HOD NEEDS (client,
// 2026-09-01: "make sure same material type can be typed in the items multiple
// times").
//
// Two lines reading "Laptop" are not a double-typed line: they are two laptops
// with different serials, different make/model, different return dates, or the
// same noun bought on two order numbers. The rule that refused them lived in
// the DATABASE — the partial unique index over
// `normalize_material(description)` per pass (013 → 020 → 037), dropped by
// migration `073` — and `validateRaiseForm` never carried it. This file pins
// both halves: the form admits the duplicate, and nothing in the item card
// keys a row by its description.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaterialItemsCard from '../../src/pages/HOD/MaterialItemsCard';
import { validateRaiseForm, todayStr } from '../../src/lib/raisePassForm';
import { EMPTY_ITEM } from '../../src/types';
import type { NewGatePass, NewGatePassItem } from '../../src/types';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function line(over: Partial<NewGatePassItem> = {}): NewGatePassItem {
  return { ...EMPTY_ITEM, name: 'Laptop', make_model: 'Dell 5420', quantity: '1', ...over };
}

function form(items: NewGatePassItem[]): NewGatePass {
  return {
    type: 'NRGP',
    visitor_name: 'R Kumar',
    visitor_company: 'Quest Facilities',
    company_address: '',
    visitor_phone: '+91 9876543210',
    purpose: 'Repair',
    vehicle_number: '',
    items,
  } as unknown as NewGatePass;
}

describe('a pass may list the same material on more than one line', () => {
  it('validates two identical descriptions without an error', () => {
    const errs = validateRaiseForm(form([line(), line()]), true, todayStr());
    expect(errs).toEqual({});
  });

  it('keeps the two lines apart on screen — the second is editable in its own right', () => {
    render(
      <MaterialItemsCard
        items={[line({ serial_no: 'A1' }), line({ serial_no: 'A2' })]}
        errors={{}}
        onItemChange={() => {}}
        onRemoveItem={() => {}}
        onAddItem={() => {}}
        showReturnDate={false}
      />
    );
    const descriptions = screen.getAllByLabelText('Item Description') as HTMLInputElement[];
    expect(descriptions).toHaveLength(2);
    expect(descriptions.every((d) => d.value === 'Laptop')).toBe(true);
    const serials = screen.getAllByLabelText('Serial / Asset Tag') as HTMLInputElement[];
    expect(serials.map((s) => s.value)).toEqual(['A1', 'A2']);
  });

  it('no migration leaves a unique index over normalize_material in force', () => {
    // The database is where the old rule lived, so this is where the client's
    // decision has to be pinned. A re-introduced index would refuse the very
    // pass the form above now accepts, at submit, with a 23505.
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let live: string | null = null;
    // ONE PASS OVER THE STATEMENTS IN ORDER, creates and drops together: 037
    // drops the index and re-creates it under the same name in the same file,
    // so scanning all creates before all drops would call it retired when it
    // is live — a false green on exactly the rule this test guards.
    const stmt =
      /create\s+unique\s+index\s+(?:if not exists\s+)?(\w+)\s+on\s+gatepass\.gate_pass_items([\s\S]*?);|drop\s+index\s+(?:if exists\s+)?gatepass\.(\w+)/gi;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf-8');
      for (const m of sql.matchAll(stmt)) {
        if (m[1]) {
          if (/normalize_material/i.test(m[0])) live = m[1];
        } else if (m[3] && m[3] === live) {
          live = null;
        }
      }
    }
    expect(live, `${live} still enforces one line per material — migration 073 retired that rule`).toBeNull();
  });
});
