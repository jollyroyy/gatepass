// WHAT A PRINTOUT MAY CARRY — one contract, for every page in the app.
//
// Client, 2026-08-21: "on the print page the Quest Malls logo is getting hidden
// under that sandwich bar icon. Make sure the sandwich bar is completely gone …
// all the icons on the page should not appear on the print page. Make sure you
// do not duplicate any of the headings. Do this across all kinds of printing,
// not only for the admin report but for any kind of printing. Do the
// customization so it does not show on the website and never ever hide the
// logo."
//
// THE BUG WAS ONE MISSING CLASS. The mobile hamburger is `fixed top-3.5 left-4
// z-50` and had no `no-print`, so it printed — at the top-left corner of the
// sheet, which is exactly where both the gate-pass slip and the report
// letterhead put the Quest lockup. The desktop sidebar and the notification
// bell had carried `no-print` since they landed; this one control never did.
//
// THE RULE IS AN OPT-OUT FOR THE PAGE AND AN OPT-IN FOR THE ART, and it is
// stated in `@media print` in index.css rather than on each component:
//
//   * NOTHING ANCHORED TO THE VIEWPORT PRINTS. `position: fixed` is a screen
//     idea — paper does not scroll — and every element that overlapped the
//     letterhead was fixed. That catches the hamburger, its drawer, the bell,
//     the sidebar and every modal overlay, whether or not somebody remembered
//     `no-print` on it.
//   * NO ICON PRINTS, and an icon is any `svg` that has not asked to stay. The
//     opt-in is `.print-keep`, worn by exactly two kinds of thing: the Quest
//     mark, and a chart, which is data rather than decoration. Everything else
//     — the calendar, the printer, the chevrons, the glyph plates — is a
//     pointer at a control, and there is no control on a sheet of paper.
//
// AN OPT-IN IS THE ONLY SAFE DIRECTION HERE. Most of the 140-odd `svg` tags in
// `src/` carry no `aria-hidden`, so a rule keyed on that attribute would have
// left a third of the glyphs printing; and a rule that named the icons to hide
// would have to be extended every time somebody drew a new one — silently, on
// paper, where nobody looks. The logo is what must never disappear, so the logo
// is what says so, in its own file.
//
// NONE OF THIS SHOWS ON SCREEN: every rule below is inside `@media print`, and
// `.print-keep` has no screen-side declaration at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

/** Source with every comment removed, so a heading QUOTED in prose — and this
 *  repo's files are mostly prose — can never satisfy or break a test that is
 *  asking what the component actually renders. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CSS = read('src/index.css');
/** Comments stripped, so a rule quoted in prose can never satisfy a test. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `@media print { … }` blocks, concatenated. Brace-matched rather than
 *  regex-sliced: these blocks contain nested rules and `@page`. */
function printBlocks(css: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media print', from);
    if (at === -1) break;
    let i = css.indexOf('{', at);
    let depth = 0;
    const start = i;
    for (; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(css.slice(start, i));
    from = i;
  }
  return out.join('\n');
}

const PRINT = printBlocks(RULES);

describe('the sandwich bar never reaches paper', () => {
  const SIDEBAR = read('src/components/layout/Sidebar.tsx');

  it('marks the mobile hamburger no-print — the control that covered the logo', () => {
    const button = SIDEBAR.slice(SIDEBAR.indexOf("aria-label=\"Open menu\""));
    const cls = button.slice(button.indexOf('className='), button.indexOf('>'));
    expect(cls).toContain('no-print');
  });

  it('marks the mobile drawer no-print as well', () => {
    const drawer = SIDEBAR.slice(SIDEBAR.indexOf('{mobileOpen && ('));
    const cls = drawer.slice(drawer.indexOf('className='), drawer.indexOf('\n', drawer.indexOf('className=')));
    expect(cls).toContain('no-print');
  });

  it('keeps the desktop sidebar and the bell no-print, as they already were', () => {
    expect(SIDEBAR).toMatch(/className=\{?`?no-print hidden lg:flex/);
    expect(read('src/components/layout/NotificationBell.tsx')).toContain('no-print fixed');
  });
});

describe('nothing anchored to the viewport prints', () => {
  it('hides every fixed element, class-based or inline', () => {
    expect(PRINT).toMatch(/\.fixed[^{}]*\{[^}]*display:\s*none\s*!important/);
    expect(PRINT).toMatch(/position:\s*fixed/); // the [style*=] arm
  });

  it('hides the modal overlay, which is fixed and would print over the sheet', () => {
    expect(PRINT).toMatch(/\.modal-overlay/);
  });

  it('drops the shell padding that only exists to clear the hamburger', () => {
    // `main` carries pt-20 on small screens for a control that no longer prints.
    expect(PRINT).toMatch(/main[^{}]*\{[^}]*padding-top:\s*0/);
  });
});

describe('icons do not print, and the logo always does', () => {
  it('hides every svg that has not opted in', () => {
    expect(PRINT).toMatch(/svg:not\([^)]*print-keep/);
  });

  it('.print-keep is print-only — it declares nothing on screen', () => {
    const outside = RULES.replace(PRINT, '');
    expect(outside).not.toMatch(/\.print-keep\s*[,{]/);
  });

  it('the Quest mark itself carries the opt-in, so no page can lose the logo', () => {
    const mark = read('src/components/QuestMark.tsx');
    const svg = mark.slice(mark.indexOf('<svg'), mark.indexOf('</svg>'));
    expect(svg).toContain('print-keep');
  });

  it('a chart carries it too — a chart is data, not an icon', () => {
    for (const f of ['src/components/admin/OverviewTrend.tsx', 'src/components/admin/OverviewStatus.tsx']) {
      expect(read(f)).toContain('print-keep');
    }
  });

  it('the QR code is an <img>, so the svg rule cannot touch it', () => {
    expect(read('src/components/QrPass.tsx')).toMatch(/<img\s/);
  });
});

describe('a printed sheet states its heading once', () => {
  it('the report draws its title only on paper, and the screen head draws none', () => {
    const page = read('src/pages/Admin/ReportsPage.tsx');
    expect(page).toMatch(/print-only[\s\S]{0,120}ReportsPrintHeader/);
    // The on-screen title was removed on 2026-08-21; if it ever comes back, the
    // printed sheet would carry the same words twice.
    expect(code('src/pages/Admin/ReportsHeader.tsx')).not.toMatch(/Gate Pass Report/);
  });

  it('the slip prints one identity — the lockup with no subtitle over one h1', () => {
    // `PassSlip` is the sheet itself since 2026-09-01 — `PassPrint` is the
    // screen around it, and the vendor's WhatsApp copy is a photograph of the
    // same component.
    const slip = code('src/components/print/PassSlip.tsx');
    // The lockup's own subtitle is suppressed because the h1 under it already
    // says "…Gate Pass"; the two together were the duplicate heading.
    expect(slip).toMatch(/QuestLockup[^/]*subtitle=\{null\}/);
    expect((slip.match(/<h1/g) ?? []).length).toBe(1);
  });
});
