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

  it('table headers are gold ink at caption size — bigger than the old 11px micro', () => {
    // Client, 2026-08-18: "the colouring of all the column headings in the
    // golden format, and make them a little bit bigger in font size, across
    // all views." INK gold is brand-800 / brand-300 in the dark half, never
    // brand-600 — that is the FILL gold and is under 3:1 as text. The `dark:`
    // half is not polish: `brand-*` are literal hex and do not invert.
    const block = css.match(/\.table-base thead th\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/text-caption/);
    expect(block).toMatch(/font-semibold/);
    expect(block).toMatch(/text-brand-800/);
    expect(block).toMatch(/dark:text-brand-300/);
    expect(block).toMatch(/uppercase/);
    expect(block).not.toMatch(/text-micro/);
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

// THE GUARD'S SHELL IS A FIXED-LIGHT ISLAND, and it takes TWO mechanisms to be
// one. `.gb-main` re-declares the neutral ramp light (so `text-navy-700` and
// friends stop inverting), and the dark VARIANT in tailwind.config.ts excludes
// the subtree (so a literal `dark:` utility, which no var can reach, stops
// applying). Delete either and the other is not enough — the record a guard
// opens would go back to dark cards on a white ground.
describe('design system — the guard shell (.gb-main)', () => {

  // A `var()` nobody defined is not a fallback — it makes the whole declaration
  // invalid, and an inherited property like `color` then takes the value from
  // the app around it. On the shipped dark default that is near-white ink on
  // the skin's white card, which is how the pass record's item cells went
  // blank for a guard (client, 2026-08-19). `.gb-main` must therefore carry the
  // same six neutrals `.gb-board` does, not borrow them.
  it('declares the --gb-* palette for every island that paints with it', () => {
    const block = css.match(/\.gb-board,[\s\S]*?\.gb-stack\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    for (const name of ['--gb-ink', '--gb-body', '--gb-muted', '--gb-line', '--gb-line-soft', '--gb-head', '--gb-blue', '--gb-red']) {
      expect(block).toContain(`${name}:`);
    }
  });
  const config = readFileSync(join(__dirname, '../../tailwind.config.ts'), 'utf-8');

  it('re-declares the light neutral ramp so house components stop inverting', () => {
    const block = css.match(/\.gb-main\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/--c-navy-700:\s*69 64 57/);
    expect(block).toMatch(/--c-surface-200:\s*231 228 222/);
    expect(block).toMatch(/color-scheme:\s*light/);
  });

  it('sets the mock-up type and ground on the shell itself', () => {
    const block = css.match(/\.gb-main\s*{[^}]*}/)?.[0] ?? '';
    expect(block).toMatch(/font-family:\s*'Inter'/);
    expect(block).toMatch(/background:\s*#ffffff/);
    expect(block).toMatch(/color:\s*var\(--gb-ink\)/);
  });

  it('restates the heading ladder in Inter ink inside the guard shell', () => {
    expect(css).toMatch(/\.gb-main \.page-title/);
    expect(css).toMatch(/\.gb-main \.card-title/);
  });

  it('is excluded from the dark variant in tailwind.config.ts', () => {
    expect(config).toMatch(/darkMode:\s*\['variant'/);
    expect(config).toMatch(/:not\(:where\(\.gb-main, \.gb-main \*\)\)/);
  });
});

// A hand-written `.dark X` rule in index.css is plain CSS: neither the light
// ramp `.gb-main` re-declares nor the dark VARIANT can hold it back, so each
// one has to opt out of the guard's shell itself. Forget the tail on a new
// rule and something on the guard's record page — Print Pass was the one that
// showed it — renders its dark-theme treatment on a white ground.
describe('design system — every .dark rule opts out of the guard shell', () => {
  it('carries the :not(:where(.gb-main, .gb-main *)) tail', () => {
    // The var block itself (`.dark {`), the selection colour, and the printed
    // slip's own opt-out are exempt: none of them is a component treatment.
    const EXEMPT = /::selection|\.pass-sheet/;
    const offenders = css
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\.dark\s+[^{\s]/.test(line) && !EXEMPT.test(line))
      .filter((line) => !line.includes(':not(:where(.gb-main, .gb-main *))'));
    expect(offenders).toEqual([]);
  });
});

// THE BUILD BREAKS SILENTLY WHEN A COMMENT CLOSES ITSELF. `/* … navy-*/…` ends
// the comment at that `*/`, and the prose after it is parsed as a selector —
// so `npm run check` stays green (it never builds the CSS) while `vite build`
// dies with "Unexpected '/'" and a `line: undefined` it cannot point at. That
// shipped on 2026-08-19 in the raise-form sheet's own comment and cost a
// bisect of the whole file to find. This is the cheap version of that bisect.
describe('design system — index.css parses as CSS', () => {
  it('has no comment that closes itself early, so every rule is a real rule', () => {
    // Strip comments the way a parser does — first `*/` wins — and then require
    // that what remains is only selectors, declarations and at-rules. A
    // self-closed comment leaves a fragment of English, which fails both.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // Prose gives itself away as a "selector" carrying a comma-free sentence
    // with spaces AND punctuation no selector uses.
    const offenders = stripped
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[a-z][a-z ]{8,}[.,] /i.test(line));
    expect(offenders).toEqual([]);
  });

  it('leaves no orphan comment terminator outside a comment', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\*\//);
  });
});
