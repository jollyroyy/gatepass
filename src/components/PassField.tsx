// One labelled fact: a quiet micro-label over a value — the shadcn
// label/value idiom used inside a card's CardContent. `emphasize` bumps the
// VALUE's weight only, never its colour (colour means status, never
// decoration) — used for the four facts the client asked to read as primary:
// item value, who raised it, the vendor, and the expected return date.
import React from 'react';

type Props = { label: string; value: React.ReactNode; emphasize?: boolean; className?: string };

export default function PassField({ label, value, emphasize, className }: Props): React.ReactElement {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      {/* navy-500, not navy-400: at 11px a muted label needs 4.5:1 in light
          mode, and navy-400 measures ~2.3:1 there — the AA floor the
          ui-ux-pro-max skill flagged. navy-500 clears it in both themes. */}
      <p className="text-micro uppercase text-navy-500 mb-1">{label}</p>
      <p
        className={`text-body truncate ${
          emphasize ? 'font-semibold text-navy-900' : 'font-normal text-navy-700'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
