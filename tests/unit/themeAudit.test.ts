// Static guards for the 2026-08-10 light/dark sweep. The mechanic behind every
// bug this session found: the neutral ramp (`--c-navy-*` / `--c-surface-*` in
// src/index.css) INVERTS under `.dark`, and the app ships dark by default
// (index.html hardcodes `class="dark"`). Two shapes of bug follow from that:
//   1. A literal hex/rgb colour on an in-app surface does not invert, so it
//      is wrong in one theme by construction.
//   2. A token-based surface (e.g. `bg-navy-950`) paired with a literal
//      "always visible" colour (`text-white`) assumes the surface stays one
//      shade — which breaks the moment the token flips under `.dark`.
// These specs cannot render the app (jsdom does no compositing/theme
// switching that matters here), so — like tests/unit/darkModeDropdown.test.ts
// and tests/security/sqlInvariants.test.ts — they grep source text.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '../../src');

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Deliberately always-light surfaces, per CLAUDE.md: tokens would render
 *  near-white on near-white there because the ramp inverts under `.dark`
 *  but these screens must not. Hardcoded hex is correct here — leave it. */
const HEX_EXEMPT_TSX = [
  'src/pages/Login.tsx',
  'src/pages/ForgotPasswordCard.tsx',
  'src/pages/ResetPassword.tsx',
  'src/pages/ForcePasswordChange.tsx',
  'src/components/AuthField.tsx',
  'src/pages/Shared/PassPrint.tsx',
  // The logo is redrawn brand geometry (gold gradient stops, the charcoal
  // wordmark on light/dark tone variants) — decorative, not a themed
  // in-app surface, and explicitly documented as such in CLAUDE.md.
  'src/components/QuestMark.tsx',
  // The admin dashboard's chart palette, and the ONLY .ts file allowed hex.
  // A chart series colour must NOT invert with the theme — a category that
  // changes hue between light and dark is not an identity — so these are
  // deliberately literal. Confining them to one module is what keeps the rest
  // of the rule absolute: every chart component imports from here, and a hex
  // literal at any call site still fails this spec.
  'src/components/charts/chartPalette.ts',
  // The approval notification emails (migration 047). Same category as the
  // printed slip above, and for a stronger reason: this HTML is not rendered by
  // this app at all. It is rendered by whatever mail client the approver opens
  // — Outlook, Gmail, a phone — none of which loads index.css, knows what
  // `--c-navy-500` is, or would honour a CSS custom property if it did. Mail
  // HTML takes literal, inline colour or it takes none. The palette here is
  // deliberately black-on-white with no colour-dependent information, the same
  // rule PassPrint follows, so the letter reads on a client that strips styles
  // entirely.
  // The letter's own palette. It moved out of `approvalNotice.ts` on
  // 2026-09-01 when that file was split under the 300-line cap; the whole
  // folder is exempt because every module in it composes mail HTML, and a
  // colour there is as always-light as one in `noticeFormat.ts` itself.
  'src/lib/notice/',
];

describe('theme audit — no stray hardcoded hex on an in-app (theme-following) surface', () => {
  // Both extensions: the rule is about colour, and a colour laundered through a
  // `.ts` constants file is exactly as un-invertible as one written inline.
  const files = listFiles(SRC, ['.tsx', '.ts']);

  it('every hex colour in src/** lives in an exempt always-light screen or the chart palette', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(join(__dirname, '../..'), file).split('\\').join('/');
      // An entry ending in `/` exempts a whole FOLDER, which is how one
      // always-light surface that outgrew a single file stays exempt without
      // listing every module it was split into. Everything else is still an
      // exact path — a prefix match by default would silently exempt
      // `src/lib/notice*` and anything else sharing a leading string.
      if (HEX_EXEMPT_TSX.some((ex) => (ex.endsWith('/') ? rel.startsWith(ex) : rel === ex))) continue;
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (matches) offenders.push(`${rel}: ${matches.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('theme audit — text-navy-400 (the ~2.3:1 AA-fail token) is gone from live UI', () => {
  const files = listFiles(SRC, ['.tsx']);

  it('no .tsx file applies text-navy-400 (use text-navy-500, which clears AA in both themes)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(join(__dirname, '../..'), file).split('\\').join('/');
      const content = readFileSync(file, 'utf-8');
      if (content.includes('text-navy-400')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('index.css has no @apply/utility use of text-navy-400 outside the print-safe override', () => {
    const cssPath = join(SRC, 'index.css');
    const css = readFileSync(cssPath, 'utf-8');
    // The print stylesheet fixes colours to literal greys for a mono laser
    // printer and does not use the class as a Tailwind utility — everywhere
    // else, text-navy-400 must not appear at all.
    const withoutPrintBlock = css.replace(/@media print \{[\s\S]*?\n\}\n/, '');
    expect(withoutPrintBlock).not.toMatch(/text-navy-400/);
  });
});

describe('theme audit — text on brand gold is always charcoal, never white', () => {
  const files = listFiles(SRC, ['.tsx']);

  it('no className string pairs a brand-500/600 background with text-white', () => {
    // CLAUDE.md: "Text on gold is charcoal (shell.ink/brand.ink), never
    // white — white on #C6A15B is ~2.4:1 and fails AA." This caught a real
    // instance: the department-chip toggles in UsersTab/DepartmentsTab used
    // `bg-brand-500 text-white`.
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const classAttrs = content.match(/className=(?:\{`[^`]*`\}|"[^"]*"|'[^']*'|\{[^}]*\})/g) ?? [];
      for (const attr of classAttrs) {
        if (/bg-brand-(500|600)\b/.test(attr) && /\btext-white\b/.test(attr)) {
          offenders.push(`${relative(join(__dirname, '../..'), file)}: ${attr}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('theme audit — no hardcoded bg-white surface paired with inverting neutral tokens', () => {
  const files = listFiles(SRC, ['.tsx']);

  // The mirror image of the rule below, and the shape that made the whole
  // NotificationBell popup unreadable in dark mode: an OPAQUE `bg-white`
  // (a literal that never inverts) carrying `text-navy-*` / `border-surface-*`
  // text, which DOES invert. In light mode that reads fine — near-black ink on
  // white. Under `.dark` (the shipped default) navy-900 becomes rgb(240 237 231)
  // and the panel is near-white text on a white card.
  //
  // Alpha overlays (`bg-white/5`, `bg-white/[0.06]`) are NOT this bug — they
  // tint whatever is underneath rather than establishing a surface — so the
  // pattern deliberately requires the bare class.
  const BG_WHITE_EXEMPT = [
    // Black-on-white by design, for a mono laser printer. Uses text-black.
    'src/pages/Shared/PassPrint.tsx',
  ];

  it('no .tsx pairs an opaque bg-white with text-navy-* or border-surface-*', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(join(__dirname, '../..'), file).split('\\').join('/');
      if (BG_WHITE_EXEMPT.includes(rel)) continue;
      const content = readFileSync(file, 'utf-8');
      if (!/\bbg-white(?![/\w-])/.test(content)) continue;
      if (/\btext-navy-\d/.test(content) || /\bborder-surface-\d/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('theme audit — no token-based surface paired with a hardcoded text-white/text-black', () => {
  const files = listFiles(SRC, ['.tsx']);

  it('no className pairs bg-navy-900/950 (near-white in dark mode) with text-white', () => {
    // The real bug this pins: an earlier version of RaisePass's "Serial /
    // Date / Raised By" strip (`PassIdentityPanel.tsx`, deleted 2026-08-19
    // with the raise-form rebuild) used `bg-navy-950` (which is near-black in
    // LIGHT mode but near-WHITE once `.dark` inverts the ramp — the app's
    // shipped default) together with a hardcoded `text-white`, going
    // invisible white-on-white by default. QrScanner had the same shape.
    // Fixed-dark chrome must use literal colours (like `.shell-sidebar`
    // does), never a navy-9xx token.
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/bg-navy-(900|950)\b/.test(content) && /\btext-white\b/.test(content)) {
        offenders.push(relative(join(__dirname, '../..'), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
