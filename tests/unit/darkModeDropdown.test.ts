// A native <select>'s popup list is painted by the browser in its own layer,
// with no page behind it. `.dark .input` lifts the control with
// `rgb(255 255 255 / 0.04)` — 4% white — which looks right ON the dark page but
// composites to near-white in that popup, putting near-white option text on a
// near-white list. The dropdown reads as empty.
//
// This cannot be caught by rendering: jsdom does no compositing and no native
// widget painting, so a component test sees a perfectly healthy <select>. The
// stylesheet itself is the only thing that can be asserted, which is why this
// spec greps CSS rather than a component — the same approach
// tests/security/cspAllowsSupabase.test.ts takes for a header that only exists
// in production.
//
// The sibling VMS app already carries these rules; GatePass never received
// them. If you are tempted to delete any of this, open a <select> on the Users
// tab in dark mode first.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

/** Collapse whitespace so a reformat of the stylesheet cannot fail these. */
const flat = css.replace(/\s+/g, ' ');

describe('dark-mode dropdowns are actually readable', () => {
  it('tells the browser to paint native select chrome dark', () => {
    // Without this the OS draws the popup's scrollbar and hover highlight from
    // the LIGHT scheme when the user's system theme is light — which it often
    // is, because this app forces `class="dark"` in index.html regardless.
    expect(flat).toMatch(/\.dark select\s*\{[^}]*color-scheme:\s*dark/);
  });

  it('gives the select control an OPAQUE background in dark mode', () => {
    // Opaque is the whole point. A translucent value here is the bug.
    expect(flat).toMatch(/\.dark select\.input\s*\{[^}]*background-color:\s*rgb\(var\(--c-surface-100\)\)/);
  });

  it('paints option and optgroup rows explicitly', () => {
    // Chrome on Windows inherits the control's background into the list only
    // sometimes; Firefox does not. Naming the rows removes the guesswork.
    const optionRule = flat.match(/\.dark select option,\s*\.dark select optgroup\s*\{([^}]*)\}/);
    expect(optionRule, 'no `.dark select option, .dark select optgroup` rule found').not.toBeNull();
    expect(optionRule![1]).toMatch(/background-color:\s*rgb\(var\(--c-surface-100\)\)/);
    expect(optionRule![1]).toMatch(/color:\s*rgb\(var\(--c-navy-900\)\)/);
  });

  it('uses tokens that actually invert between the two themes', () => {
    // The rules above are only correct because these two tokens flip. If a
    // future edit hardcodes a hex here, the fix silently breaks in light mode.
    const light = css.match(/:root\s*\{[\s\S]*?--c-surface-100:\s*([^;]+);/);
    const dark = css.match(/\.dark\s*\{[\s\S]*?--c-surface-100:\s*([^;]+);/);
    expect(light?.[1].trim()).not.toEqual(dark?.[1].trim());
  });
});
