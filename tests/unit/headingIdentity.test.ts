// THE HEADING IDENTITY — one face, one colour, every view.
//
// Client, 2026-08-17: headings and subheadings must be a different colour AND a
// different typeface from ordinary text, and "consistent with the theme". The
// theme's colour is the Quest brass gold and its display face is Antic Didone,
// so every rung of the ladder now takes both:
//
//   .page-title           28px  h1 — the page
//   .section-title        22px  h2 — a region of a page
//   .modal-title          22px  h2 — a dialog's own title (no rule under it)
//   .card-title           18px  h3 — one card inside a region
//   .board-section-title  18px  h2 — a KPI band on the dashboard
//
// THREE THINGS HERE ARE LOAD-BEARING, and each is a defect this file exists to
// prevent:
//
//   1. `font-normal` ON EVERY ONE OF THEM. Antic Didone ships weight 400 only.
//      The h2/h3 tokens in tailwind.config.ts carry font-weight 700/600, so a
//      heading that took `text-h2` and the display face together would render a
//      SYNTHESISED bold — smeared didone hairlines, the exact "cheap" tell the
//      design system spends its comment budget avoiding. The sizes are therefore
//      written out longhand at font-normal instead of using the size tokens.
//   2. A `dark:` PARTNER FOR THE COLOUR. brand-200…950 are literal hex in
//      tailwind.config.ts — unlike navy/surface they do NOT invert with the
//      theme. A heading painted only `text-brand-800` would be #866A31 on the
//      near-black `.dark` surface, which is the shipped default: ~1.9:1, i.e.
//      invisible. The dark half is not polish, it is the difference between a
//      heading and no heading.
//   3. MEASURED CONTRAST, not a chosen-by-eye gold. The ratios are computed
//      below from the real token values. brand-600 (#C6A15B), the primary FILL,
//      is ~2.2:1 as ink on a light card and has already shipped as an unreadable
//      control once (the notification panel, 2026-08-17). Ink gold and fill gold
//      are different rungs and must stay that way.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '../../src/index.css'), 'utf-8');
const twConfig = readFileSync(join(__dirname, '../../tailwind.config.ts'), 'utf-8');

const HEADINGS = [
  'page-title',
  'section-title',
  'modal-title',
  'card-title',
  'board-section-title',
] as const;

/** The @layer components definition — NOT the print override further up, which
 *  ends its own selector list with the same class name and would otherwise be
 *  the first match. The real definition is the one that carries an `@apply`. */
function block(name: string): string {
  const all = css.match(new RegExp(`\\.${name}\\s*{[^}]*}`, 'g')) ?? [];
  const found = all.find((b) => b.includes('@apply'));
  if (!found) throw new Error(`.${name} is not defined in src/index.css`);
  return found;
}

/** A `brand` step's literal hex, read out of the palette rather than retyped. */
function brandHex(step: number): string {
  const hex = twConfig.match(new RegExp(`\\n\\s*${step}: '(#[0-9A-Fa-f]{6})'`))?.[1];
  if (!hex) throw new Error(`brand-${step} is not a literal hex in tailwind.config.ts`);
  return hex;
}

/** A CSS-variable neutral, as `r g b`, from :root (light) or .dark. */
function surfaceRgb(theme: 'light' | 'dark'): [number, number, number] {
  const scope = theme === 'light' ? css.slice(0, css.indexOf('.dark {')) : css.slice(css.indexOf('.dark {'));
  const raw = scope.match(/--c-surface-50:\s*(\d+)\s+(\d+)\s+(\d+)/);
  if (!raw) throw new Error(`no surface-50 for ${theme}`);
  return [Number(raw[1]), Number(raw[2]), Number(raw[3])];
}

function luminance([r, g, b]: [number, number, number]): number {
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function hexRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('heading identity — the display face', () => {
  it.each(HEADINGS)('.%s is set in the display face', (name) => {
    expect(block(name)).toMatch(/font-display/);
  });

  it.each(HEADINGS)('.%s stays weight-normal — Antic Didone has no bold to reach for', (name) => {
    const b = block(name);
    expect(b).toMatch(/font-normal/);
    expect(b).not.toMatch(/font-bold|font-semibold|font-extrabold/);
  });

  it.each(HEADINGS)('.%s sizes itself longhand, never through a weighted size token', (name) => {
    // text-h1/h2/h3 each carry a fontWeight in tailwind.config.ts, so applying
    // one would reintroduce the faux-bold through the back door.
    const b = block(name);
    expect(b).not.toMatch(/text-h[123]\b/);
    expect(b).toMatch(/font-size:\s*[\d.]+rem/);
  });
});

describe('heading identity — the theme colour', () => {
  it.each(HEADINGS)('.%s is painted the brand gold, not neutral ink', (name) => {
    expect(block(name)).toMatch(/(?<!dark:)text-brand-\d+/);
  });

  it.each(HEADINGS)('.%s carries a dark: partner — brand hexes do not invert', (name) => {
    expect(block(name)).toMatch(/dark:text-brand-\d+/);
  });

  it('the light ink clears WCAG AA against the light surface', () => {
    const step = Number(block('card-title').match(/(?<!dark:)text-brand-(\d+)/)?.[1]);
    expect(ratio(hexRgb(brandHex(step)), surfaceRgb('light'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the dark ink clears WCAG AA against the dark surface', () => {
    const step = Number(block('card-title').match(/dark:text-brand-(\d+)/)?.[1]);
    expect(ratio(hexRgb(brandHex(step)), surfaceRgb('dark'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the primary FILL gold is not what a heading is painted with', () => {
    // #C6A15B is the button and the active nav link. As ink on a card it is
    // ~2.2:1 — this asserts the number rather than trusting the memory of it.
    expect(ratio(hexRgb('#C6A15B'), surfaceRgb('light'))).toBeLessThan(3);
    for (const name of HEADINGS) expect(block(name)).not.toMatch(/(?<!dark:)text-brand-600/);
  });
});

describe('heading identity — paper', () => {
  it('headings print as near-black, whatever they are on screen', () => {
    // The slip and the register must read on a cheap mono laser printer, where
    // a mid-tone gold lands as pale grey. `body { color: #111 }` does not reach
    // an element that sets its own colour, so the print block must name them.
    const print = css.slice(css.lastIndexOf('@media print'));
    const rule = print.match(/\.page-title[^{]*{[^}]*}/)?.[0] ?? '';
    expect(rule).toMatch(/#111|#000|black/);
    for (const name of HEADINGS) expect(rule.slice(0, rule.indexOf('{'))).toContain(name);
  });
});
