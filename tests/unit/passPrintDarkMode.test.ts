// 2026-08-11: "clicking on Print Pass in dark mode, the pass is not visible at
// all."
//
// The slip is deliberately black-on-white — it has to read on a cheap mono
// laser printer, so it uses LITERAL colours (`bg-white`, `text-black`) rather
// than the `navy-*`/`surface-*` tokens that invert under `.dark`. That was
// correct, and it was still invisible: `index.css` carries a blanket
// `.dark .bg-white { background-color: rgb(var(--glass-bg) / 0.8) }` override
// so the app's white cards go dark with the theme. It caught the slip too —
// near-black paper under black ink.
//
// The fix is an exemption scoped to `.pass-sheet`, not a change to the slip's
// classes: the sheet is a fixed-context, always-light surface (the same rule
// CLAUDE.md's design section states for the login card and AuthField).
//
// This is a CSS-source test because jsdom applies no stylesheet — a render
// test cannot see a background-color that comes from index.css at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');
const PRINT_TSX = readFileSync(resolve(__dirname, '../../src/pages/Shared/PassPrint.tsx'), 'utf8');

/** Strip comments so a rule quoted in prose can never satisfy these tests. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the printed slip stays light under the dark theme', () => {
  it('index.css still darkens .bg-white app-wide (the rule this exemption exists for)', () => {
    expect(RULES).toMatch(/\.dark\s+\.bg-white\s*\{/);
  });

  it('exempts .pass-sheet from that override with a literal white', () => {
    const exemption = RULES.match(/\.dark[^{}]*\.pass-sheet[^{}]*\{[^}]*\}/g) ?? [];
    expect(exemption.length).toBeGreaterThan(0);
    expect(exemption.join('\n')).toMatch(/background-color:\s*#fff\b/i);
  });

  it('pins the sheet to a light color-scheme so the UA paints it light too', () => {
    expect(RULES).toMatch(/\.pass-sheet\b[^{}]*\{[^}]*color-scheme:\s*light/);
  });

  it('the slip itself still uses literal light colours, not theme tokens', () => {
    expect(PRINT_TSX).toContain('bg-white text-black');
    // Only the sheet is a fixed-light surface — the "pass not found" state
    // above it is ordinary app chrome and SHOULD follow the theme.
    const sheet = PRINT_TSX.slice(PRINT_TSX.indexOf('className="pass-sheet'));
    // A tokenised ramp inside the sheet would invert with the theme and
    // re-break the slip.
    expect(sheet).not.toMatch(/\b(bg|text|border)-(navy|surface)-\d+/);
  });

  it('the sheet wrapper is what carries the .pass-sheet hook the exemption targets', () => {
    expect(PRINT_TSX).toMatch(/className="pass-sheet/);
  });
});
