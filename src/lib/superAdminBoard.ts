// THE SUPER ADMIN'S BOARD — the admin's own five figures, regrouped into the
// two summary cards the guard's dashboard is built from.
//
// The client, 2026-08-20: "follow the same dashboard look and feel of guard
// except the functionalities … for superadmin dashboard". So the LOOK is the
// guard's — a greeting, two big tinted cards each carrying its figures side by
// side, and a row of Quick Action tiles — and the FUNCTIONALITY is the admin's:
// the same five counts, over the same one `v_gate_passes` read, drilling into
// the same stacked list in place.
//
// ⚠ THIS MODULE COUNTS NOTHING. It is handed `buildOverviewCards`'s output and
// only decides which figure sits on which card. That is deliberate and it is
// what keeps the board invariant intact for free: every figure still carries
// the very `BoardDrill` the admin Overview built for it, so the number and the
// rows its press opens cannot disagree — there is no second predicate here to
// drift from the first. Adding a count to this file would be the bug.
//
// THE SPLIT IS BY SCOPE, NOT BY SUBJECT, and that is the whole reason there are
// exactly two cards rather than five tiles in a row:
//
//   RAISED IN THE WINDOW — the RGP and NRGP FIGURES. Two cuts of one array.
//   RUNNING RIGHT NOW    — overdue returns, and the two desk lines under each
//                          pass-type figure. None of them resets at the window
//                          boundary, because an obligation does not close
//                          because the window rolled past the day it started in
//                          (the admin Overview's own rule).
//
// Putting a windowed figure beside a running one inside a single card is what
// this grouping exists to prevent: the guard's card shape states one heading
// over several figures, and a heading that is true of one figure and false of
// its neighbour is worse than no heading.
//
// IT NAMES NO GLYPH AND NO TONE. `hodIconTypes.ts` exists so a lib can name an
// icon without importing a component; this module does not need even that,
// because which plate a card wears is a fact about the drawing and lives in
// `SuperSummaryCards.tsx`. A lib that picked the colour would be a lib the
// designer has to edit.
import type { OverviewCard, OverviewKey, OverviewNote } from './adminOverview';

export type SuperGroupKey = 'raised' | 'attention';

/** One figure inside a card — the short label the guard's split uses, and the
 *  rows it counted. */
export interface SuperFigure {
  key: OverviewKey;
  /** Deliberately SHORTER than the Overview card's own label. The card states
   *  the subject once in its heading, so the figure under it says only which
   *  cut of it this is — exactly how the guard's RGP / NRGP split reads. */
  label: string;
  value: number;
  /** The rows the figure counted, for the page its press opens. */
  drill: OverviewCard['drill'];
  /** Where the figure goes when pressed. Every figure navigates (client,
   *  2026-08-23): `/admin-dashboard/<key>` for the two pass types, `/overdue`
   *  for the item-level page. */
  to: string;
  /** The two desk lines under a pass-type figure. */
  notes?: OverviewNote[];
}

export interface SuperGroup {
  key: SuperGroupKey;
  title: string;
  figures: SuperFigure[];
}

/** Which card each of the admin's five keys belongs on, and what it is called
 *  once its card has stated the subject. A `Record` over the whole union, so a
 *  sixth Overview figure is a TYPE ERROR here rather than a figure that
 *  silently never renders — which is how the Total figure's removal
 *  (2026-08-23) reached this file rather than being left behind as a label for
 *  a card that no longer exists. */
const PLACEMENT: Record<OverviewKey, { group: SuperGroupKey; label: string }> = {
  rgp: { group: 'raised', label: 'RGP' },
  nrgp: { group: 'raised', label: 'NRGP' },
  overdue: { group: 'attention', label: 'Overdue Returns' },
};

const GROUPS: readonly { key: SuperGroupKey; title: string }[] = [
  { key: 'raised', title: 'Gate Passes Raised' },
  { key: 'attention', title: 'Needs Attention' },
];

/**
 * The admin's five Overview cards, regrouped into the guard's two.
 *
 * ORDER IS THE OVERVIEW'S, not this file's: the figures inside a card come out
 * in the order `buildOverviewCards` produced them, so the mock-up's own
 * sequence (RGP · NRGP, then Pending · Overdue) survives without being
 * restated in a second place that could disagree with the first.
 *
 * A group with no figures is DROPPED rather than rendered empty — an empty
 * bordered card reads as a screen that failed to load.
 *
 * `windowNote` is the windowed card's second line, and it is a PARAMETER rather
 * than something computed here for the same reason nothing else in this file is
 * computed: the dates a window covers are `windowBounds`/`rangeLabel`'s answer
 * already, and a second derivation of them is a second answer that can differ
 * from the one the rest of the board is using. Only the WINDOWED card takes it —
 * putting a date range on the running card would state a scope it does not have.
 */
export function superAdminGroups(cards: OverviewCard[]): SuperGroup[] {
  return GROUPS.map((g) => ({
    ...g,
    figures: cards
      .filter((c) => PLACEMENT[c.key].group === g.key)
      .map((c) => ({
        key: c.key,
        label: PLACEMENT[c.key].label,
        value: c.value,
        drill: c.drill,
        to: c.to,
        notes: c.notes,
      })),
  })).filter((g) => g.figures.length > 0);
}
