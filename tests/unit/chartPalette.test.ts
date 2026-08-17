// Gold is the THEME. It is the sidebar's active link, the primary button, the
// wordmark — so a donut slice or a trend line drawn in it reads as chrome
// rather than as a category, and the reader cannot tell the chart apart from
// the frame around it. Client's call, 2026-08-17: every chart series is a
// non-theme hue.
//
// This test is the backstop. It fails if the brand gold (or either of the two
// golds on questmall.in's own stylesheet, which is where the palette came
// from) reappears in any colour a chart actually draws with.
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_COLORS,
  PASS_STATUS_COLORS,
  RETURNABLE_COLORS,
  RANK_COLORS,
  SERIES_COLORS,
  NEUTRAL_SERIES,
  rankColor,
} from '../../src/components/charts/chartPalette';

/** Brass gold and the two source golds. Lowercase — every comparison below
 *  normalises, so a `#c6a15b` written in the other casing cannot slip past. */
const GOLDS = ['#c6a15b', '#d0ad68', '#d09918'];

function assertNoGold(where: string, colors: string[]): void {
  for (const c of colors) {
    expect(GOLDS, `${where} draws with the theme gold ${c}`).not.toContain(c.toLowerCase());
  }
}

describe('no chart draws in the theme gold', () => {
  it.each([
    ['SERIES_COLORS', Object.values(SERIES_COLORS)],
    ['CATEGORY_COLORS', Object.values(CATEGORY_COLORS)],
    ['PASS_STATUS_COLORS', Object.values(PASS_STATUS_COLORS)],
    ['RETURNABLE_COLORS', Object.values(RETURNABLE_COLORS)],
    ['RANK_COLORS', RANK_COLORS],
    ['NEUTRAL_SERIES', [NEUTRAL_SERIES]],
  ])('%s', (name, colors) => assertNoGold(name, colors as string[]));

  it('gives the three pass categories three distinct, non-gold hues', () => {
    const vals = Object.values(CATEGORY_COLORS);
    expect(new Set(vals).size).toBe(vals.length);
    assertNoGold('CATEGORY_COLORS', vals);
  });

  it('never repeats a hue on adjacent ranks', () => {
    for (let i = 1; i < RANK_COLORS.length; i += 1) {
      expect(rankColor(i)).not.toBe(rankColor(i - 1));
    }
  });
});
