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

/** Human-readable label for a stored unit code; unknown codes pass through. */
export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '—';
  return UNIT_LABELS[unit] ?? unit;
}

/** The unit every line shares, or null when the lines disagree (or there are none). */
export function sharedUnit(units: (string | null | undefined)[]): string | null {
  const first = units[0];
  if (!first) return null;
  return units.every((u) => u === first) ? first : null;
}

/**
 * The unit that belongs in a quantity COLUMN HEADING rather than in every cell
 * under it (client, 2026-08-18: "if it is kg, just mention kg in the heading").
 *
 * Null when the lines disagree — the cells must then carry their own unit or
 * the numbers stop meaning anything — and null for `nos`, which is a plain
 * count and reads as one without being named.
 */
export function headingUnit(units: (string | null | undefined)[]): string | null {
  const shared = sharedUnit(units);
  return !shared || shared === 'nos' ? null : shared;
}

/** "Quantity" or "Quantity (Kg)". */
export function quantityHeading(base: string, units: (string | null | undefined)[]): string {
  const unit = headingUnit(units);
  return unit ? `${base} (${unitLabel(unit)})` : base;
}

/**
 * What one quantity cell reads. Bare when the heading already names the unit,
 * and bare for `nos` — a count of 3 is "3", never "3 Numbers".
 */
export function quantityCell(
  quantity: number,
  unit: string | null | undefined,
  units: (string | null | undefined)[]
): string {
  if (headingUnit(units)) return String(quantity);
  return !unit || unit === 'nos' ? String(quantity) : `${quantity} ${unitLabel(unit)}`;
}
