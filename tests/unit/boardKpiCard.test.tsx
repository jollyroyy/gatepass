// A headline KPI card carries a number, not a chart.
//
// Client's call, 2026-08-17: "make sure you don't put the small graphs inside
// the KPI numbers — those are not looking good." The 7-day sparkline that sat
// beside each figure was removed outright rather than restyled: it was
// normalised against its own peak, so two of them on the same row were not
// comparable to each other, and it competed with the one thing on the card
// anybody reads. The trend over time still exists, once, as the Passes Trend
// line — which has an axis and a window the reader chose.
//
// This test pins the absence at both ends: no chart element renders inside a
// card, and the row above no longer computes a per-day series to hand it.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import BoardKpiCard from '../../src/components/board/BoardKpiCard';
import { BOARD_KPIS } from '../../src/lib/boardDrills';

const SRC = path.resolve(__dirname, '../../src');

describe('BoardKpiCard', () => {
  it('renders the figure with no chart beside it', () => {
    const { container } = render(
      <BoardKpiCard
        kpi={BOARD_KPIS.raised}
        value={42}
        delta={12}
        deltaLabel="vs yesterday"
        loading={false}
        active={false}
        onClick={vi.fn()}
      />,
    );

    const value = screen.getByText('42');
    expect(value).toBeInTheDocument();
    // Nothing is drawn beside the figure. The card's only `svg` is the tone
    // icon in the header, which is an icon and not a chart — so count, rather
    // than "no svg at all".
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(value.parentElement?.querySelector('svg')).toBeNull();
  });
});

describe('the sparkline is gone from the source, not just from the render', () => {
  it('has no Sparkline component left to import', () => {
    expect(fs.existsSync(path.join(SRC, 'components/charts/Sparkline.tsx'))).toBe(false);
  });

  it('is not imported or computed anywhere', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(SRC);

    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, `${f} still references a sparkline`).not.toMatch(/Sparkline|countsPerDay/);
    }
  });
});
