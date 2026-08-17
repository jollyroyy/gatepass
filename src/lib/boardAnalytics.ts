// The shape every chart aggregate on the board reduces to.
//
// ONE RULE GOVERNS IT: an aggregate carries the rows it counted. Not the count
// and a predicate that a caller re-applies somewhere else — the actual array.
// That is the same invariant the KPI cards have always had in this app ("a KPI's
// number is `rows.length` of the very list the click opens"), extended to chart
// segments, because a slice reading 6 that drills into 8 passes is a board
// nobody can trust and nobody can debug.
//
// This file used to also hold `departmentSlices`, `topMaterials`,
// `movementBuckets` and `MOVEMENT_SERIES`. They went with the panels that drew
// them when the board was cut back to today only (2026-08-17) — the daily
// movement trend, the status ring, the return watch and the outstanding
// ranking. `Slice` survives them because the one remaining chart, Today's Gate
// Activity, is built on it (`gateActivitySlices` in gateActivity.ts).
//
// Nothing here queries. The board fetches once and day-scopes once; a producer
// of these only ever sees an array that is already in scope.
import type { GatePassView } from '../types';

/** A labelled aggregate plus the exact passes behind it. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  rows: GatePassView[];
}
