// THE ONE CALL THAT CREATES A GATE PASS, and the one narrow read that follows
// it.
//
// Split out of `RaisePass.tsx` for the 300-line cap. It is the same request for
// every reader — an HOD raising for their own department, or (069) a COO or CEO
// raising for one they picked. The DIFFERENCE between those two forms is which
// departments load (`useRaiseDepartments`) and nothing else, and keeping the
// request in one function is what holds that true.
import { gp } from '../../supabaseClient';
import type { GatePassView, NewGatePass } from '../../types';
import { requiresReturnDate } from '../../lib/passTypes';
import { earliestReturnDate, packVendor } from '../../lib/raisePassForm';

/**
 * Raises the pass and returns the row, with `awaits_approval` filled in where
 * it could be read.
 */
export async function createPass(form: NewGatePass, departmentId: string): Promise<GatePassView> {
  // THE PASS'S DEADLINE IS THE EARLIEST LINE'S. `v_gate_passes` grades
  // `is_overdue` / `due_state` off this one column, and a pass is late the
  // moment its first line is — see `earliestReturnDate`.
  const returnDate = requiresReturnDate(form.type) ? earliestReturnDate(form.items) : null;
  const { data, error } = await gp().rpc('raise_pass', {
    p_type: form.type,
    p_direction: 'out',
    p_department_id: departmentId,
    p_visitor_name: form.visitor_name.trim(),
    p_visitor_company: packVendor(form),
    p_vehicle_number: form.vehicle_number.trim() || null,
    // ONE reason for the whole pass (the mock asks once). `raise_pass` (045)
    // also uses it as each line's `purpose`, which is NOT NULL — so the
    // record and the printed slip show the reason that was authorised
    // instead of the literal 'Material movement' fallback.
    p_purpose: form.purpose.trim() || null,
    p_expected_return_date: returnDate,
    p_items: form.items.map((item) => ({
      // ONE "Item Description" on the mock, two NOT NULL columns behind it.
      // `description` is what `normalize_material` keys the one-open-line-
      // per-material index on, so it must be the material and nothing else.
      name: item.name.trim(),
      description: item.name.trim(),
      quantity: Number(item.quantity),
      // THE UNIT THE HOD PICKED (client, 2026-08-20). `nos` is the select's
      // own default, so a line nobody touched still lands as a plain count —
      // the same value every line raised between 2026-08-19 and today
      // carries — and the guard reads it back read-only at the barrier.
      unit: item.unit || 'nos',
      // WHAT THE LINE IS ROUGHLY WORTH (client, 2026-08-20). A blank stays
      // NULL — `raise_pass` does `nullif(…, '')::numeric` — so `total_value`
      // adds only the lines somebody actually priced, and an unpriced pass
      // still prints a dash rather than ₹0. Sent as a string on purpose:
      // the RPC casts it, and Number('') is 0, which would price every
      // blank line at nothing.
      approx_value: item.approx_value.trim(),
      make_model: item.make_model.trim() || null,
      serial_no: item.serial_no.trim() || null,
      invoice_no: item.invoice_no.trim() || null,
      remarks: item.remarks.trim() || null,
      // EACH LINE CARRIES ITS OWN DATE — client, 2026-08-19: "we would
      // expect a date of return against each item in the RGP form." The
      // pass-level date above is the earliest of these, so the two can
      // never disagree about when the FIRST piece of material is due.
      expected_return_date: requiresReturnDate(form.type) ? item.expected_return_date : null,
    })),
  });
  if (error) throw error;
  const created = data as unknown as GatePassView;
  // `raise_pass` returns a `gatepass.gate_passes` ROW, not a view row, so it
  // carries no `awaits_approval` — and the confirmation badge would say
  // "Pending Gate Review" over a pass the gate is not even allowed to see
  // yet. One narrow read of the view fixes the one field that matters here.
  // FAILURE IS TOLERATED on purpose: the pass is already raised, and a
  // confirmation modal is not worth a red error over a badge word.
  let awaits: boolean | undefined;
  try {
    const { data: view } = await gp()
      .from('v_gate_passes')
      .select('awaits_approval')
      .eq('id', created.id)
      .limit(1);
    const row = (Array.isArray(view) ? view[0] : view) as { awaits_approval?: boolean } | null;
    awaits = row?.awaits_approval;
  } catch {
    awaits = undefined;
  }
  return awaits === undefined ? created : { ...created, awaits_approval: awaits };
}
