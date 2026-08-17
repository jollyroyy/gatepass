// One KPI tile on the board.
//
// WHAT THIS PINS is the client's instruction of 2026-08-17: "remove the 8 vs
// yesterday, 9 vs yesterday from all the KPI cards under admin." A tile that
// merely stopped RENDERING its delta would leave the prop, the previous-window
// array and the arithmetic in place, one line of JSX away from coming back — so
// the assertions below are about the tile's API as much as its output.
//
// The second case is the pre-existing rule that a long label WRAPS rather than
// truncating ("make sure all the texts are properly fitted inside the box"): a
// grid row stretches to its tallest item, so a two-line label costs one line of
// height, where `truncate` hides half of "RGP Mismatched at Gate" behind an
// ellipsis and a `title` nobody hovers.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BoardKpiTile from '../../src/components/board/BoardKpiTile';
import { BOARD_KPIS } from '../../src/lib/boardKpis';

function renderTile(key: 'rgpOut' | 'rgpMismatch' | 'rgpOverdue', value = 8) {
  render(
    <BoardKpiTile
      kpi={BOARD_KPIS[key]}
      label={BOARD_KPIS[key].label}
      value={value}
      loading={false}
      active={false}
      onClick={vi.fn()}
    />,
  );
  return screen.getByRole('button');
}

describe('a KPI tile', () => {
  it('prints no comparison against any previous window', () => {
    const tile = renderTile('rgpOut');
    expect(tile.textContent).toContain('8');
    expect(tile.textContent).not.toMatch(/vs (yesterday|previous)/i);
    expect(tile.textContent).not.toMatch(/[↑↓]/);
  });

  it('has no previous-window machinery left in the board at all', () => {
    // Removed rather than ignored. A tile that still ACCEPTED a previous figure
    // would let the delta be restored by one line of JSX, and `BoardWindows`
    // would have to keep computing a window nothing draws. Read from source,
    // because "this prop no longer exists" is not observable in a render.
    const dir = resolve(__dirname, '../../src');
    for (const [file, src] of [
      ['BoardKpiTile.tsx', readFileSync(resolve(dir, 'components/board/BoardKpiTile.tsx'), 'utf8')],
      ['BoardKpiSection.tsx', readFileSync(resolve(dir, 'components/board/BoardKpiSection.tsx'), 'utf8')],
      ['boardKpis.ts', readFileSync(resolve(dir, 'lib/boardKpis.ts'), 'utf8')],
      ['boardWindows.ts', readFileSync(resolve(dir, 'lib/boardWindows.ts'), 'utf8')],
    ] as const) {
      expect(src, `${file} still refers to a previous window`).not.toMatch(
        /previousRowsFor|raisedPrev|returnedPrev|comparisonLabel/,
      );
    }
  });

  it('shows a dash instead of a figure while loading, never a spinner', () => {
    render(
      <BoardKpiTile
        kpi={BOARD_KPIS.rgpOut}
        label="RGP Out Today"
        value={8}
        loading
        active={false}
        onClick={vi.fn()}
      />,
    );
    // A figure that flashes on every silent refresh is worse than a placeholder.
    expect(screen.getByRole('button').textContent).toContain('—');
    expect(screen.getByRole('button').textContent).not.toContain('8');
  });

  it('lets a long label wrap instead of truncating it', () => {
    const tile = renderTile('rgpMismatch');
    const label = tile.querySelector('span.break-words');
    expect(label?.textContent).toBe('RGP Mismatched at Gate');
    expect(label?.className).not.toContain('truncate');
  });
});
