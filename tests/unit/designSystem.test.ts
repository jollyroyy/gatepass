// Static assertions for the 2026-08-10 premium redesign. These check the
// design-token contract without rendering every screen: the shared classes
// in src/index.css, and a repo-wide grep for the one rule most likely to be
// broken by someone later — pairing the single-weight display serif with a
// synthesised bold.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CSS_PATH = join(__dirname, '../../src/index.css');
const css = readFileSync(CSS_PATH, 'utf-8');

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('design system — shared tokens (src/index.css)', () => {
  it('page-title uses the h1 scale (28px/-0.02em) and stays weight-normal (font-display forbids bold)', () => {
    const block = css.match(/\.page-title\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/font-display/);
    expect(block).toMatch(/font-normal/);
    expect(block).not.toMatch(/font-bold/);
    expect(block).toMatch(/1\.75rem|text-h1/);
  });

  it('page-subtitle stays at least two steps below page-title', () => {
    const block = css.match(/\.page-subtitle\s*{[^}]*}/)?.[0] ?? '';
    // caption/body sit well under the 28px/700 h1 — never h2/h3/h1/kpi tokens.
    expect(block).not.toMatch(/text-h1|text-h2|text-h3|text-kpi/);
  });

  // SUPERSEDED RULE, kept visible so it is not "restored" by someone reading an
  // old comment: this used to assert that a section heading was Inter and NEVER
  // brand gold. The client asked (2026-08-17) for headings to differ from body
  // text in both face and colour, in the theme's own gold, so the whole ladder
  // is now the display serif in `brand-800 / dark:brand-300`. The rule that
  // replaced it is stricter, not looser — see tests/unit/headingIdentity.test.ts,
  // which computes the contrast ratios from the real tokens.
  it('section-title is a real heading at the h2 SIZE, and never a tiny eyebrow', () => {
    const block = css.match(/\.section-title\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/font-size:\s*1\.375rem/);
    expect(block).not.toMatch(/text-micro|text-caption/);
    // The size token carries font-weight 700, which the single-weight display
    // serif can only synthesise. Size longhand, weight normal.
    expect(block).toMatch(/font-normal/);
    expect(block).not.toMatch(/font-bold/);
  });

  it('kpi-value uses the kpi token (36px/800/tabular) and never the display serif', () => {
    const block = css.match(/\.kpi-value\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/text-kpi/);
    expect(block).toMatch(/tabular/);
    expect(block).not.toMatch(/font-display/);
  });

  it('kpi-label is a text-micro uppercase eyebrow', () => {
    const block = css.match(/\.kpi-label\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/text-micro/);
    expect(block).toMatch(/uppercase/);
  });

  it('table headers use text-micro uppercase, not an ad hoc small size', () => {
    const block = css.match(/\.table-base thead th\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/text-micro/);
    expect(block).toMatch(/uppercase/);
  });

  it('card carries the two-layer premium shadow token', () => {
    const block = css.match(/(?<!-hover)\n\s*\.card\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/shadow-card-premium\b/);
  });

  it('label (form field labels) is a text-micro uppercase eyebrow', () => {
    const block = css.match(/\.label\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/text-micro/);
    expect(block).toMatch(/uppercase/);
  });
});

describe('design system — no element combines font-display with a synthesised bold', () => {
  const files = listTsxFiles(join(__dirname, '../../src'));

  it('no className string pairs font-display with font-bold anywhere in src/**/*.tsx', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Look at each quoted/templated className-looking string in isolation
      // so a font-bold elsewhere in the file (a different element) is not a
      // false positive.
      const classAttrs = content.match(/className=(?:{`[^`]*`}|"[^"]*"|'[^']*')/g) ?? [];
      for (const attr of classAttrs) {
        if (attr.includes('font-display') && attr.includes('font-bold')) {
          offenders.push(`${file}: ${attr}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
