import type { PassStatus, ReturnStatus } from '../types';

export type StatusStyle = { bg: string; text: string; dot: string; label: string };

/** Direct lookup — never derive these from string matching on the enum value.
 *  `Record<PassStatus, …>` is deliberately exhaustive: adding a status to the
 *  Postgres enum breaks the build here until it has been given a look, rather
 *  than rendering as a blank badge in production. */
export const STATUS_STYLES: Record<PassStatus, StatusStyle> = {
  pending: { bg: 'bg-pending-50', text: 'text-pending-700', dot: 'bg-pending-500', label: 'Pending' },
  matched: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Matched' },
  flagged: { bg: 'bg-flagged-50', text: 'text-flagged-700', dot: 'bg-flagged-500', label: 'Flagged' },
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
  returned: { bg: 'bg-matched-50', text: 'text-matched-700', dot: 'bg-matched-500', label: 'Returned' },
};

export const OVERDUE_STYLE: StatusStyle = {
  bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Overdue',
};
