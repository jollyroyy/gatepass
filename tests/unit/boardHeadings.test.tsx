// THE BOARD'S HEADING LADDER — admin (`/admin-dashboard`) and HOD (`/dashboard`)
// alike, since both render the same `GateBoard`.
//
// WHAT WENT WRONG AND WHY THIS FILE EXISTS. The three KPI band headings — "RGP
// Overview", "NRGP Overview", "Quick Summary" — were `text-micro text-navy-500
// uppercase`: 11px, grey, and LIGHTER than the tile labels sitting directly
// underneath them. That inverts the ladder the type scale in tailwind.config.ts
// is written to enforce ("a heading sits at least two steps above, and 200 weight
// units heavier than, the text directly beneath it"), and the practical effect on
// a dense board is that a reader scanning it cannot see where one section ends
// and the next begins.
//
// So every heading on this board now carries two things, and this spec pins both:
//
//   1. A REAL HEADING SIZE AND THE HOUSE HEADING FACE. `.board-section-title` is
//      18px in the display serif, the same rung the panel cards use — a KPI band
//      and a chart panel are peers in the layout, so they must read as peers.
//      The face and colour contract itself lives in headingIdentity.test.ts.
//   2. A MARKER. `.board-accent`, the gold rule to the left of the words. It is
//      the same device `BoardAttention` uses two inches above with a status hue,
//      and it is deliberately DECORATIVE-ONLY: `aria-hidden`, so a screen reader
//      gets the heading text and nothing else.
//
// The marker is brand gold and that is NOT "saturated colour as decoration". Gold
// is this system's structural fill (sidebar active link, primary button, the
// ordinal badge); the status hues stay reserved for the pills and the attention
// strip, which is exactly what makes the red rule above these headings mean
// something.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import GateBoard from '../../src/components/board/GateBoard';

const SRC = join(__dirname, '../../src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf-8');
const css = read('index.css');

/** A class's @layer components definition. Matched on the `@apply` it carries,
 *  because the print block further up ends its own selector list with the same
 *  class names and would otherwise be the first hit. */
function cssBlock(name: string): string {
  const all = css.match(new RegExp(`\\.${name}\\s*{[^}]*}`, 'g')) ?? [];
  return all.find((b) => b.includes('@apply')) ?? '';
}

/** The board with nothing on it. The headings are static markup — they do not
 *  depend on a single row — so an empty board is the honest fixture here. */
function renderBoard(): void {
  render(
    <MemoryRouter>
      <GateBoard
        title="Gate Pass Management Dashboard"
        subtitle="Today's Gate Pass Summary"
        rows={[]}
        items={[]}
        loading={false}
        error={null}
        registerTo="/all-passes"
        outstandingMode="department"
      />
    </MemoryRouter>,
  );
}

/** The nearest `<section>` (or header block) that owns a heading. */
function blockOf(heading: HTMLElement): HTMLElement {
  const block = heading.closest('section, .page-header');
  if (!block) throw new Error(`"${heading.textContent}" is in no section`);
  return block as HTMLElement;
}

const SECTIONS = ['RGP Overview', 'NRGP Overview', 'Quick Summary'];
const PANELS = [
  'Daily Movement Trend',
  'RGP Status Breakdown',
  'RGP Return Watch',
  'Department Wise Outstanding RGP',
  'Top Items Today',
];

describe('board headings — the page title', () => {
  it('is the only h1, and carries the accent marker', () => {
    renderBoard();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Gate Pass Management Dashboard' });
    expect(h1).toHaveClass('page-title');
    expect(blockOf(h1).querySelector('.board-accent')).not.toBeNull();
  });

  it('keeps its subtitle, so the accent never replaces the words', () => {
    renderBoard();
    expect(screen.getByText("Today's Gate Pass Summary")).toBeInTheDocument();
  });
});

describe('board headings — the KPI band subheadings', () => {
  it.each(SECTIONS)('"%s" is a real h2 at the h3 rung, not a micro eyebrow', (name) => {
    renderBoard();
    const h2 = screen.getByRole('heading', { level: 2, name });
    expect(h2).toHaveClass('board-section-title');
    // The specific regression: an 11px grey uppercase label heading a band of
    // tiles whose own labels are heavier than it.
    expect(h2.className).not.toMatch(/text-micro/);
    expect(h2.className).not.toMatch(/uppercase/);
  });

  it.each(SECTIONS)('"%s" carries an accent marker, hidden from assistive tech', (name) => {
    renderBoard();
    const marker = blockOf(screen.getByRole('heading', { level: 2, name })).querySelector('.board-accent');
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    // A marker with words in it would be read out as part of the heading.
    expect(marker?.textContent).toBe('');
  });

  it.each(SECTIONS)('"%s" is separated from its tiles by a rule', (name) => {
    renderBoard();
    // The rule sits on the header ROW (heading + hint), not on the heading
    // itself — a `border-b` under the words alone would underline the title.
    const heading = screen.getByRole('heading', { level: 2, name });
    const ruled = heading.closest('div[class*="border-b"]');
    expect(ruled).not.toBeNull();
    expect(ruled).toContainElement(heading);
  });
});

describe('board headings — the chart panels', () => {
  it.each(PANELS)('"%s" carries the same accent marker as the bands', (name) => {
    renderBoard();
    const h2 = screen.getByRole('heading', { level: 2, name });
    expect(blockOf(h2).querySelector('.board-accent')).not.toBeNull();
  });

  it('panel titles stay one family with the bands — both at the h3 rung', () => {
    // `.card-title` and `.board-section-title` must not drift apart: a KPI band
    // and a chart panel sit side by side in the same grid. Size is written
    // longhand at both (the h3 token carries a 600 weight the single-weight
    // display serif cannot honour) — see tests/unit/headingIdentity.test.ts.
    const card = cssBlock('card-title');
    const band = cssBlock('board-section-title');
    expect(card).toMatch(/font-size:\s*1\.125rem/);
    expect(band).toMatch(/font-size:\s*1\.125rem/);
  });
});

describe('board headings — the token contract', () => {
  it('board-section-title takes the house heading colour, in both themes', () => {
    // The board's bands are on the same ladder as every other heading in the
    // app, so they take the same gold — and the same `dark:` partner, without
    // which they would be #866A31 on a near-black surface. The full contract,
    // contrast ratios included, is tests/unit/headingIdentity.test.ts.
    const block = cssBlock('board-section-title');
    expect(block).toMatch(/text-brand-\d+/);
    expect(block).toMatch(/dark:text-brand-\d+/);
  });

  it('board-accent is the marker, and it is the brand fill', () => {
    const block = cssBlock('board-accent');
    expect(block).toMatch(/bg-brand-/);
    expect(block).toMatch(/rounded/);
  });

  it('no board heading re-introduces the micro eyebrow', () => {
    // A source grep, because the failure mode is one panel quietly reverting
    // while the others stay correct — which renders as "slightly off" and is
    // invisible in a screenshot.
    for (const file of ['components/board/BoardKpiSection.tsx', 'components/board/BoardHeader.tsx']) {
      const src = read(file);
      const heading = src.match(/<h[12][^>]*className="([^"]*)"/)?.[1] ?? '';
      expect(heading).not.toMatch(/text-micro/);
    }
  });
});
