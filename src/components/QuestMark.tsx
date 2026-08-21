import React, { useId } from 'react';

/**
 * Quest Mall identity, rebuilt as vector.
 *
 * The client publishes their logo only as `questmall.in/images/quest-logo.jpg` — a
 * JPEG matted onto white. Dropping that on the charcoal shell would show a white box
 * with compression fringing around the letterforms, which is the single most obvious
 * "cheap" tell in a rebrand. So the mark is redrawn here instead: it scales to any
 * size, tints to any colour, needs no network request, and has no matte to knock out.
 *
 * The mark is a cut gem — a diamond split into four facets with graduated gold. That
 * is doing two jobs at once: it echoes the mall's actual facade (a tessellation of
 * lit triangular panels, the building's whole visual signature) and it reads as
 * luxury retail, which is how the client positions itself ("the one and only high end
 * luxury retail destination in East India").
 *
 * Colour comes from `currentColor` for the outline and from the gold ramp for the
 * facets, so the lockup works on the dark shell and on white paper without a variant.
 */

type MarkProps = {
  /** Rendered size in px. The art is drawn on a 32-unit grid and scales cleanly. */
  size?: number;
  className?: string;
  /** Sets the outer-edge stroke, which is drawn in `currentColor`. */
  style?: React.CSSProperties;
};

/** The faceted-diamond glyph on its own — use where there is no room for the wordmark. */
export function QuestMark({ size = 32, className = '', style }: MarkProps): React.ReactElement {
  // useId keeps the gradient ids unique when the mark appears more than once on a
  // page (sidebar + login card, say). Duplicate ids would make one instance adopt
  // the other's gradient, and the bug only shows on the second render.
  const uid = useId().replace(/:/g, '');
  const lit = `q-lit-${uid}`;
  const shade = `q-shade-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Quest Mall"
      /* `print-keep` is the opt-in for the app-wide print rule that hides every
         other `svg` on paper (see @media print in index.css, client 2026-08-21:
         "never ever hide the logo"). It is declared on the MARK rather than on
         each caller so no page can print without its logo by forgetting a
         class, and it does nothing at all on screen. */
      className={`print-keep ${className}`.trim()}
      style={style}
    >
      <defs>
        <linearGradient id={lit} x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EBD9B4" />
          <stop offset="55%" stopColor="#D0AD68" />
          <stop offset="100%" stopColor="#C6A15B" />
        </linearGradient>
        <linearGradient id={shade} x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C6A15B" />
          <stop offset="100%" stopColor="#8A6C32" />
        </linearGradient>
      </defs>

      {/* Four facets. The two lit ones face up-left, matching a single overhead key
          light — keep it that way; lighting two opposite facets flattens the gem. */}
      <path d="M16 1.6 16 16 2.2 16Z" fill={`url(#${lit})`} />
      <path d="M16 1.6 29.8 16 16 16Z" fill={`url(#${shade})`} opacity="0.82" />
      <path d="M2.2 16 16 16 16 30.4Z" fill={`url(#${shade})`} opacity="0.62" />
      <path d="M29.8 16 16 30.4 16 16Z" fill={`url(#${lit})`} opacity="0.9" />

      {/* Girdle — the horizontal split. A hairline, so it survives at 16px. */}
      <path d="M2.2 16H29.8" stroke="#16161A" strokeOpacity="0.28" strokeWidth="0.7" />
      {/* Outer edge, drawn last so nothing overlaps it. */}
      <path
        d="M16 1.6 29.8 16 16 30.4 2.2 16Z"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LockupProps = {
  /** `dark` = on the charcoal shell / photo. `light` = on white, incl. the printed slip. */
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  /** The line under the wordmark. Pass null to show the wordmark alone. */
  subtitle?: string | null;
  className?: string;
};

const MARK_PX: Record<NonNullable<LockupProps['size']>, number> = {
  sm: 26,
  md: 34,
  lg: 46,
};

const WORD_CLS: Record<NonNullable<LockupProps['size']>, string> = {
  sm: 'text-[17px] tracking-[0.30em]',
  md: 'text-[22px] tracking-[0.32em]',
  lg: 'text-[30px] tracking-[0.34em]',
};

const SUB_CLS: Record<NonNullable<LockupProps['size']>, string> = {
  sm: 'text-[8px] tracking-[0.24em]',
  md: 'text-[9px] tracking-[0.26em]',
  lg: 'text-[10px] tracking-[0.28em]',
};

/**
 * Mark + wordmark + subtitle, horizontally locked up.
 *
 * The wordmark is HTML text in the display face, not SVG `<text>`. SVG text would
 * render in the fallback serif for the first paint and reflow once Antic Didone
 * arrives — on a wordmark that jump is very visible. HTML text gets the browser's
 * normal font-swap handling instead.
 *
 * Antic Didone is a single-weight didone. It is never bolded here: the wide tracking
 * is what gives it presence, and a synthesised bold would smear its hairline strokes.
 */
export function QuestLockup({
  tone = 'dark',
  size = 'md',
  subtitle = 'Gate Pass',
  className = '',
}: LockupProps): React.ReactElement {
  const onDark = tone === 'dark';

  // Literal colours, not navy-*/brand-* utilities. Both tones are fixed-context —
  // the charcoal shell, or white paper — and the neutral tokens INVERT under `.dark`,
  // which is this app's shipped default. A tokenised light tone renders near-white on
  // the printed slip: invisible, and only on paper, where nobody would catch it.
  const wordColor = onDark ? '#FFFFFF' : '#16161A';
  const subColor = onDark ? '#D8B878' : '#A8853F';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <QuestMark size={MARK_PX[size]} style={{ color: onDark ? '#EBD9B4' : '#866A31' }} />
      <div className="flex flex-col justify-center">
        <span
          className={`font-display font-normal leading-none ${WORD_CLS[size]}`}
          style={{ color: wordColor }}
        >
          QUEST
        </span>
        {subtitle !== null && (
          <span
            className={`mt-[5px] font-sans font-semibold uppercase leading-none ${SUB_CLS[size]}`}
            style={{ color: subColor }}
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

export default QuestLockup;
