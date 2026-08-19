// The "Pass Type" choice, drawn to the client's 2026-08-19 mock-up: two wide
// plates side by side, each with a radio dot, a tinted icon square, the type's
// name and one line saying what it is for. The selected plate takes an accent
// border and a pale accent wash.
//
// A RADIO GROUP, not two buttons with `aria-pressed`. The mock draws radios, and
// the semantics are the truth of it — exactly one type, always one chosen. That
// also gives arrow-key movement between the two for free, which `aria-pressed`
// buttons do not have.
//
// THERE IS NO "ENERGY PAY GATE PASS". The mock's second plate carried that name;
// the client corrected it on sight — "it should not be energy gate pass, it
// should be NRGP" — so the plate keeps the mock's green skin and takes the type
// this database actually has.
import React from 'react';
import type { PassType } from '../../types';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';

interface PassTypeSelectorProps {
  value: PassType;
  onChange: (type: PassType) => void;
}

/** Per-type skin. The tone is decoration, so it lives beside the glyph rather
 *  than in `PASS_TYPES`, which is the domain fact and is read by the printed
 *  slip and every list row. */
const SKIN: Record<PassType, { tone: 'blue' | 'green'; glyph: React.ReactElement; blurb: string }> = {
  RGP: {
    tone: 'blue',
    blurb: 'For materials / equipment that will be returned to the organization.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
  NRGP: {
    tone: 'green',
    blurb: 'For materials leaving permanently — scrap, sale, disposal, transfer.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />
      </svg>
    ),
  },
};

export default function PassTypeSelector({ value, onChange }: PassTypeSelectorProps): React.ReactElement {
  return (
    <div className="rp-type-grid" role="radiogroup" aria-label="Pass Type">
      {PASS_TYPE_LIST.map((t) => {
        const info = PASS_TYPES[t];
        const skin = SKIN[t];
        const selected = value === t;
        return (
          <label key={t} className={`rp-type-plate${selected ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="pass-type"
              className="rp-type-radio"
              value={t}
              checked={selected}
              onChange={() => onChange(t)}
            />
            <span className={`rp-type-icon rp-tint-${skin.tone}`} aria-hidden="true">
              {skin.glyph}
            </span>
            <span className="rp-type-text">
              <span className="rp-type-name">{`${info.code} (${info.label})`}</span>
              <span className="rp-type-note">{skin.blurb}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
