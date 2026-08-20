// The stacked pass card's palette — the ONE place a pass's stage becomes one of
// the guard skin's five pill tones.
//
// Every stacked list in the app now draws the guard's card (client, 2026-08-19:
// "all the cards across admin and HOD level should mimic the exact same stacked
// card style of the guard's view"), and that skin has its own five-colour
// vocabulary (`.gb-pill-*`) rather than the house status ramp. This maps one to
// the other in a single lookup, so the HOD's dashboard, the admin's drills and
// My Passes cannot colour the same pass three ways.
//
// IT IS KEYED ON THE STAGE'S OWN LABEL, which is the closed set
// `passStageStyle` can return: `STATUS_STYLES` (six), `RGP_STAGE_STYLES`
// (three), `EXPIRED_STYLE` and the overdue rename. `stageTones.test.ts` walks
// the exported maps and fails when a label appears with no tone, which is the
// drift a Record keyed on an enum would catch at compile time and this one
// cannot — the label is the only thing all four maps have in common.
import type { GatePassView } from '../types';
import { passStageStyle } from './passStage';
import type { ItemLineStage } from './passRecordView';

/** The guard skin's pill vocabulary. `.gb-pill-<tone>` in index.css. */
export type GbTone = 'blue' | 'green' | 'orange' | 'red' | 'grey';

export const STAGE_TONES: Record<string, GbTone> = {
  // Waiting on somebody — the mock's amber.
  'Pending Gate Review': 'orange',
  'Pending Approval': 'orange',
  'Held at Gate': 'orange',
  'Expired': 'orange',
  // A deadline missed, or an accusation made.
  'Overdue': 'red',
  'Rejected at Security Gate': 'red',
  // Routine housekeeping, not a problem found at the gate.
  'Voided': 'grey',
  // Moving, and nothing is wrong.
  'HOD Approved': 'blue',
  'Out — Not Returned': 'blue',
  'Partly Returned': 'blue',
  // Finished.
  'Closed': 'green',
  'Matched': 'green',
};

type StageInput = Pick<
  GatePassView, 'status' | 'return_status' | 'is_expired' | 'is_overdue' | 'awaits_approval'
>;

/** The pill tone for a pass's LATEST state. Grey for a label nobody has toned
 *  yet — a colourless pill still carries its own words, which is the rule the
 *  whole design system follows. */
export function stageTone(p: StageInput): GbTone {
  return STAGE_TONES[passStageStyle(p).label] ?? 'grey';
}

/** ONE MATERIAL LINE'S own pill, for the panels that unfold inside a stacked
 *  card (the approver's queue, My Passes). Keyed on `ItemLineStage`, so a stage
 *  added there is a compile error here rather than a colourless cell — the
 *  `Record<Enum, T>` this file's own header says the label map cannot be.
 *
 *  Every value is one of the guard skin's pills, so no colour is introduced and
 *  `themeAudit` stays absolute. The tones agree with `STAGE_TONES` above: red
 *  for a refusal, orange for something still owed, blue for half-done, green for
 *  finished. */
export const ITEM_STAGE_PILL: Record<ItemLineStage, string> = {
  rejected: 'gb-pill gb-pill-red',
  pending: 'gb-pill gb-pill-orange',
  partial: 'gb-pill gb-pill-blue',
  returned: 'gb-pill gb-pill-green',
  closed: 'gb-pill gb-pill-green',
};
