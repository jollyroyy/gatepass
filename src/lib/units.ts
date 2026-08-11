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
};

/** Human-readable label for a stored unit code; unknown codes pass through. */
export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '—';
  return UNIT_LABELS[unit] ?? unit;
}
