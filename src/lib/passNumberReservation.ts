// THE REFERENCE NUMBER, TAKEN BEFORE THE FORM IS FILLED (migration 074).
//
// Client, 2026-09-01: "make the gate pass reference number visible fully while
// they are creating the pass in that page."
//
// `passNumberPreview` could only ever print `RGP-IT-####`: the serial was
// assigned inside the INSERT, under an advisory lock, and nothing outside that
// transaction could know it. 074 changes the shape of the problem rather than
// the honesty of the answer — the number is now really allocated when the form
// opens, so what the field shows is what the pass will carry.
//
// THE COST IS A GAP IN THE SERIES, and the client chose it knowingly: a form
// opened and abandoned burns a number. `releasePassNumber` is what keeps that
// rare — the counter on the server is a live max rather than a stored cursor,
// so giving back the highest number really does hand it to the next reserver,
// and switching the pass type back and forth costs nothing.
//
// BOTH CALLS ARE BEST-EFFORT BY DESIGN. A reservation that cannot be taken
// leaves the form showing the `####` preview and submitting perfectly well —
// `set_pass_number` numbers the pass the ordinary way when no valid reservation
// arrives with it. So neither failure is ever put on screen as an error: the
// worst case is the field the client asked to improve degrading to exactly what
// it showed the day before.
import { gp } from '../supabaseClient';
import type { PassType } from '../types';

/**
 * The number this person's next pass of this type, for this department, will
 * carry — or null if one could not be taken.
 *
 * Null is not an error state. Callers render the `####` preview instead and
 * submit without a number; the server assigns one on insert.
 */
export async function reservePassNumber(
  type: PassType,
  departmentId: string,
): Promise<string | null> {
  if (!departmentId) return null;
  try {
    const { data, error } = await gp().rpc('reserve_pass_number', {
      p_type: type,
      p_department_id: departmentId,
    });
    if (error) return null;
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/**
 * Give an unconsumed number back, so changing the pass type or the department
 * does not burn a serial.
 *
 * Deliberately returns nothing and reports nothing. It is called while the
 * person is still typing — on a type toggle, a department change, and on
 * unmount — and there is no version of "we could not release your reservation"
 * that a person filling in a form can act on. The reservation expires by itself
 * in twelve hours either way.
 */
export async function releasePassNumber(passNumber: string | null): Promise<void> {
  if (!passNumber) return;
  try {
    await gp().rpc('release_pass_number', { p_pass_number: passNumber });
  } catch {
    // See above: nothing to tell anybody.
  }
}
