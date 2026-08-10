// Big, tappable pass-type cards — the first decision on the Raise Pass form,
// so it is the largest control on the page. No <select>: the two types are
// few enough, and different enough in meaning, to deserve a card each.
import React from 'react';
import type { PassType } from '../../types';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';

interface PassTypeSelectorProps {
  value: PassType;
  onChange: (type: PassType) => void;
}

export default function PassTypeSelector({ value, onChange }: PassTypeSelectorProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {PASS_TYPE_LIST.map((t) => {
        const info = PASS_TYPES[t];
        const selected = value === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            aria-pressed={selected}
            className={`card-hover text-left p-4 flex flex-col gap-1.5 ${
              selected ? 'ring-2 ring-brand-600 border-brand-600' : ''
            }`}
          >
            <span className="type-chip w-fit">{info.code}</span>
            <span className="font-semibold text-navy-900 text-sm">{info.label}</span>
            <span className="text-xs text-navy-500">{info.description}</span>
          </button>
        );
      })}
    </div>
  );
}
