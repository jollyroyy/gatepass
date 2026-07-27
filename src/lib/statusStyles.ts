import type { DueState, PassStatus, ReturnStatus } from '../types';

export type StatusStyle = { bg: string; text: string; dot: string; label: string };

/** Direct lookup — never derive these from string matching on the enum value.
 *  `Record<PassStatus, …>` is deliberately exhaustive: adding a status to the
 *  Postgres enum breaks the build here until it has been given a look, rather
 *  than rendering as a blank badge in production. */
export const STATUS_STYLES: Record<PassStatus, StatusStyle> = {
  pending: { bg: 'bg-pending-50', text: 'text-pending-700', dot: 'bg-pending-500', label: 'Pending Gate Review' },
  // Amber like pending, because that is what a hold IS — the decision is still
  // open. Deliberately NOT red: a hold alleges nothing, and colouring it like a
  // flag would make guards avoid using it, which is how disputes end up
  // recorded as mismatches that never were.
  held: { bg: 'bg-pending-100', text: 'text-pending-800', dot: 'bg-pending-600', label: 'Held at Gate' },
  matched: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Matched' },
  flagged: { bg: 'bg-flagged-50', text: 'text-flagged-700', dot: 'bg-flagged-500', label: 'Flagged' },
  // Indigo — the HOD reviewed the flag and overrode it. Not green (that's
  // matched), not amber (that's still open), but a deliberate "decision made".
  hod_reviewed: { bg: 'bg-accent-50', text: 'text-accent-700', dot: 'bg-accent-500', label: 'HOD Approved' },
  // Neutral slate, not red: a voided pass is routine housekeeping by the HOD,
  // not a problem found at the gate. Only `flagged` earns an alarm colour.
  cancelled: { bg: 'bg-surface-100', text: 'text-navy-500', dot: 'bg-navy-400', label: 'Voided' },
};

/** An expired pass is still `pending` in the enum — expiry is derived from
 *  `expires_at`, not a status — so it needs its own badge rather than a row in
 *  STATUS_STYLES. Orange matches Overdue: both mean "time ran out", and neither
 *  is a mismatch the guard found. */
export const EXPIRED_STYLE: StatusStyle = {
  bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Expired',
};

export const RETURN_STYLES: Record<ReturnStatus, StatusStyle> = {
  not_applicable: { bg: 'bg-surface-100', text: 'text-navy-500', dot: 'bg-navy-400', label: '—' },
  awaiting_return: { bg: 'bg-brand-50', text: 'text-brand-700', dot: 'bg-brand-500', label: 'Awaiting Return' },
  // Indigo rather than a shade of the awaiting-return cyan: partially returned
  // is a genuinely different situation to reconcile, not "awaiting return, but
  // a bit less", and a guard scanning a list must be able to spot it.
  partially_returned: {
    bg: 'bg-accent-50', text: 'text-accent-700', dot: 'bg-accent-500', label: 'Partly Returned',
  },
  returned: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Returned' },
};

export const OVERDUE_STYLE: StatusStyle = {
  bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Overdue',
};

/** Graded due-date urgency, straight from `v_gate_passes.due_state`.
 *
 *  This is a display map ONLY. Never compute which bucket a pass falls in from
 *  `expected_return_date` in TypeScript — the view owns that comparison, in the
 *  site's timezone, and a screen that re-derives it will disagree with the
 *  database about what "today" means for every pass raised after 18:30 IST. */
export const DUE_STATE_STYLES: Record<DueState, StatusStyle> = {
  not_applicable: { bg: 'bg-surface-100', text: 'text-navy-500', dot: 'bg-navy-400', label: '—' },
  ok: { bg: 'bg-surface-100', text: 'text-navy-600', dot: 'bg-navy-400', label: 'On Track' },
  due_soon: { bg: 'bg-pending-50', text: 'text-pending-700', dot: 'bg-pending-500', label: 'Due Tomorrow' },
  due_today: { bg: 'bg-pending-100', text: 'text-pending-800', dot: 'bg-pending-600', label: 'Due Today' },
  overdue: { bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Overdue' },
};

/** Left-edge stripe for list rows, so urgency is legible without reading the
 *  badge. Empty for the two states that are not a warning. */
export const DUE_STATE_STRIPE: Record<DueState, string> = {
  not_applicable: '',
  ok: '',
  due_soon: 'border-l-4 border-l-pending-400',
  due_today: 'border-l-4 border-l-pending-600',
  overdue: 'border-l-4 border-l-overdue-500',
};
