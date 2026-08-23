// Display labels for the unit codes stored in gate_pass_items.unit.
//
// The stored value stays the lowercase code — the column is free `text` and
// existing rows already store these codes; changing what gets submitted would
// just create a second casing convention. This map exists because the client
// found the raw code ("nos") reading as an opaque abbreviation, in the
// raise-pass dropdown AND on the printed slip ("the unit should be numbers
// not nos", 2026-08-11). One function, used everywhere a unit is shown.
const UNIT_LABELS: Record<string, string> = {
  nos: 'Numbers',
  kg: 'Kg',
  box: 'Box',
  roll: 'Roll',
  litre: 'Litre',
  metre: 'Metre',
  set: 'Set',
  bag: 'Bags',
  drum: 'Drums',
  lot: 'Lots',
};

/**
 * Every unit this form may raise material in, in the order the dropdown draws
 * them (client, 2026-08-20: "add all the previous types of units and add
 * lots"). The counted units come first because `nos` is the default and the
 * overwhelming case; the measured ones follow.
 *
 * It is DERIVED from UNIT_LABELS above, so a code can never be offered under a
 * label no other screen would print — the guard reads the same `unitLabel` back
 * off the pass.
 */
export const UNIT_OPTIONS: { code: string; label: string }[] = [
  'nos', 'box', 'set', 'roll', 'bag', 'drum', 'lot', 'kg', 'litre', 'metre',
].map((code) => ({ code, label: UNIT_LABELS[code] }));

/** Human-readable label for a stored unit code; unknown codes pass through. */
export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '—';
  return UNIT_LABELS[unit] ?? unit;
}

/** The unit every line shares, or null when the lines disagree (or there are
 *  none). It no longer decides how a CELL reads — every cell names its own unit
 *  now — and its one caller sums a column, which only means anything when the
 *  lines are in one unit. */
export function sharedUnit(units: (string | null | undefined)[]): string | null {
  const first = units[0];
  if (!first) return null;
  return units.every((u) => u === first) ? first : null;
}

/**
 * What one quantity cell reads: the figure and ITS OWN UNIT, always.
 *
 * NO HEADING EVER CARRIES THE UNIT ANY MORE, and no unit is ever suppressed —
 * client, 2026-08-23: "whatever unit has been selected, you need to show all of
 * them, no matter what, no deviation across all the views". `nos` used to print
 * bare (a count of 3 reading "3"), and a column whose lines all shared one unit
 * printed it in the heading instead of the cells; both are gone, so the same
 * line reads the same way on the board, in the record, on the CSV and on the
 * printed slip. `sharedUnit` / `headingUnit` / `quantityHeading` are DELETED
 * with the rule they served — a stale reference is a build error.
 *
 * A line with no unit at all (nothing in the column) still prints the bare
 * figure: inventing "Numbers" for it would state a unit nobody chose.
 */
export function quantityCell(quantity: number, unit: string | null | undefined): string {
  return unit ? `${quantity} ${unitLabel(unit)}` : String(quantity);
}

/**
 * The unit codes that name a DISCRETE OBJECT, and therefore cannot carry a
 * fraction (client, 2026-08-19).
 *
 * Half a box is not a quantity anybody can hand over at a barrier, and a
 * fractional return is worse than a fractional issue: `apply_item_returns` has
 * no undo, so `10 - 2.5` sits on that line as an outstanding 7.5 boxes for the
 * rest of the pass's life. Kg, litres and metres are MEASURED and stay
 * fractional — 800.5 Kg is an ordinary movement.
 *
 * An unknown code is deliberately NOT treated as whole: a code this app does
 * not recognise is no evidence that it is countable, and refusing a fraction on
 * it would block a return with no other way to record it.
 */
const WHOLE_UNITS = new Set(['nos', 'box', 'roll', 'set', 'bag', 'drum', 'lot']);

export function isWholeUnit(unit: string | null | undefined): boolean {
  return !!unit && WHOLE_UNITS.has(unit);
}

/**
 * What a guard or an HOD is told when they type a fraction of a counted unit.
 *
 * It names the two whole numbers either side of what they typed, because
 * "enter a whole number" leaves them to do the rounding and decide, at a
 * barrier, which way. `max` is the ceiling the caller enforces (the line's
 * outstanding quantity); the upper suggestion is dropped rather than offered
 * and then refused. Below 1 there is no lower suggestion to make.
 */
export function wholeUnitError(unit: string | null | undefined, qty: number, max?: number): string {
  const low = Math.floor(qty);
  const high = Math.ceil(qty);
  const options: number[] = [];
  if (low >= 1) options.push(low);
  if (max === undefined || high <= max) options.push(high);
  const suffix = options.length ? ` — enter ${options.join(' or ')}.` : ' — enter a whole number.';
  return `${unitLabel(unit)} cannot be split${suffix}`;
}
