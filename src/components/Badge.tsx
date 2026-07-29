import React from 'react';
import type { StatusStyle } from '../lib/statusStyles';
import type { PassType } from '../types';
import { PASS_TYPES } from '../lib/passTypes';

type BadgeProps = { style: StatusStyle };

export default function Badge({ style }: BadgeProps): React.ReactElement {
  return (
    <span className={`status-badge ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

type TypeChipProps = { type: PassType; direction?: string };

export function TypeChip({ type }: TypeChipProps): React.ReactElement {
  return (
    <span className="type-chip" title={PASS_TYPES[type].label}>
      {type}
    </span>
  );
}
