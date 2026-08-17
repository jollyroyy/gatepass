// The chart palette.
//
// This is the one place in the app where saturated colour appears WITHOUT
// meaning status — a donut needs its slices told apart, and "RGP In" is not a
// state of alarm. The design system's rule (CLAUDE.md: "saturated colour means
// status, never decoration") is therefore bent here on purpose, and bounded so
// it does not leak:
//
//   * Series colour is only ever used INSIDE a chart, against its own legend.
//     A pass anywhere else on the board still takes its colour from
//     statusStyles.ts / passStage.ts.
//   * The return-loop charts do NOT get series colours. Returned / Awaiting /
//     Overdue are real statuses, so they reuse the real status hues — an
//     overdue arc that was some arbitrary purple, while every overdue badge on
//     the same screen is orange, would be the exact confusion the rule exists
//     to prevent.
//
// Literal hex, never a `navy-*`/`surface-*` token: those INVERT under `.dark`,
// and a chart series that changes hue with the theme stops being a stable
// identity for its category. The status hues below are the fixed 500-level
// values from tailwind.config.ts (which are themselves literals), so a chart
// and a badge of the same status are the same colour in both themes.
//
// THIS IS THE ONLY MODULE IN src/ ALLOWED TO CONTAIN LITERAL HEX, and
// tests/unit/themeAudit.test.ts enforces that — it exempts this file by name
// and fails on hex anywhere else. Add a colour here, never at a call site.
/** Series identities for the category donut and the trend lines.
 *
 *  NONE OF THESE IS THE BRAND GOLD, and that is a rule rather than a taste
 *  (client, 2026-08-17). Gold is the theme: the sidebar's active link, the
 *  primary button, the wordmark. A slice drawn in it reads as part of the
 *  frame rather than as a category, and on a board where every other chart
 *  hue means something specific, the one that means "our brand" is noise.
 *  `tests/unit/chartPalette.test.ts` fails if it comes back.
 *
 *  The three are picked to stay apart for the common colour-vision
 *  deficiencies too: blue → violet → teal separates by hue AND by lightness,
 *  so the ring is still readable when the legend is not. */
export const SERIES_COLORS = {
  blue: '#2563EB', // royal blue  — RGP Out, the bulk of the traffic
  violet: '#7C3AED', // violet    — RGP In
  teal: '#0D9488', // deep teal   — NRGP Out
  slate: '#7C766C', // warm stone — the fallback, and anything unranked
} as const;

/** Status hues, matching tailwind.config.ts exactly. Used by the return-loop
 *  charts, where the categories ARE statuses. */
export const STATUS_COLORS = {
  matched: '#10b981',
  pending: '#f59e0b',
  flagged: '#ef4444',
  overdue: '#f97316',
} as const;

export const CATEGORY_COLORS: Record<string, string> = {
  'RGP-out': SERIES_COLORS.blue,
  'RGP-in': SERIES_COLORS.violet,
  'NRGP-out': SERIES_COLORS.teal,
};

/** The status ring. These ARE statuses, so they take the real status hues —
 *  the same ones `statusStyles.ts` gives the badges beside them. `hod_reviewed`
 *  borrows the accent blue (it is a decision, not an alarm) and the two rare
 *  terminal states take neutral stone. */
export const PASS_STATUS_COLORS: Record<string, string> = {
  pending: STATUS_COLORS.pending,
  // Maroon, from questmall.in's own stylesheet. NOT the flagged red it sits
  // next to in the ring: expired and mismatched are different failures and two
  // adjacent arcs of the same hue would read as one arc.
  expired: '#740e0c',
  matched: STATUS_COLORS.matched,
  flagged: STATUS_COLORS.flagged,
  hod_reviewed: SERIES_COLORS.blue,
  held: SERIES_COLORS.slate,
  cancelled: '#A8A399',
};

export const RETURNABLE_COLORS: Record<string, string> = {
  returned: STATUS_COLORS.matched,
  awaiting: STATUS_COLORS.pending,
  overdue: STATUS_COLORS.overdue,
};

/** The ranked bar lists (departments, top materials) cycle this. Order matters:
 *  adjacent ranks must not be adjacent hues, or a reader comparing bar 2 and
 *  bar 3 has to check the labels. */
export const RANK_COLORS: string[] = [
  SERIES_COLORS.blue,
  SERIES_COLORS.violet,
  STATUS_COLORS.matched,
  STATUS_COLORS.overdue,
  SERIES_COLORS.teal,
  STATUS_COLORS.flagged,
];

export function rankColor(index: number): string {
  return RANK_COLORS[index % RANK_COLORS.length];
}

/** What a chart falls back to when a slice key has no colour of its own. */
export const NEUTRAL_SERIES = SERIES_COLORS.slate;
