import React from 'react';
import type { StatusStyle } from '../lib/statusStyles';
import type { PassType, PassDirection } from '../types';
import { PASS_TYPES, PASS_DIRECTIONS } from '../lib/passTypes';

type BadgeProps = { style: StatusStyle };

export default function Badge({ style }: BadgeProps): React.ReactElement {
  return (
    <span className={`status-badge ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

type TypeChipProps = { type: PassType; direction?: PassDirection };

/**
 * Pass-type chip (RGP / NRGP), optionally with direction alongside it (e.g.
 * "RGP · OUT"). Direction is a separate column since migration 010 — the old
 * IGP/OGP split baked direction into the type, but that is gone, so a chip
 * showing only the type no longer tells a guard which way material moves.
 * `direction` is optional so every existing bare-type caller keeps working.
 */
export function TypeChip({ type, direction }: TypeChipProps): React.ReactElement {
  const title = direction
    ? `${PASS_TYPES[type].label} — ${PASS_DIRECTIONS[direction].label}`
    : PASS_TYPES[type].label;
  return (
    <span className="type-chip" title={title}>
      {type}
      {direction && <> · {PASS_DIRECTIONS[direction].short}</>}
    </span>
  );
}
