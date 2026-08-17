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
  ACTIVITY_COLORS,
  SERIES_COLORS,
  STATUS_COLORS,
  NEUTRAL_SERIES,
} from '../../src/components/charts/chartPalette';
import { ACTIVITY_LABEL } from '../../src/lib/gateActivity';

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
    ['STATUS_COLORS', Object.values(STATUS_COLORS)],
    ['ACTIVITY_COLORS', Object.values(ACTIVITY_COLORS)],
    ['NEUTRAL_SERIES', [NEUTRAL_SERIES]],
  ])('%s', (name, colors) => assertNoGold(name, colors as string[]));

  it('gives the four activity kinds four distinct, non-gold hues', () => {
    // The ring's legend is the only place a reader learns which colour means
    // "returned" — two kinds sharing a hue makes the legend a guess.
    const vals = Object.values(ACTIVITY_COLORS);
    expect(new Set(vals).size).toBe(vals.length);
    assertNoGold('ACTIVITY_COLORS', vals);
  });

  it('colours every activity kind the ring can draw', () => {
    // `ACTIVITY_LABEL` is a `Record<GateActivityKind, string>`, so this walks
    // the real enum: a fifth kind of movement added without a colour would fall
    // back to the neutral stone and be indistinguishable from an unranked slice.
    for (const kind of Object.keys(ACTIVITY_LABEL)) {
      expect(ACTIVITY_COLORS[kind], `no colour for the "${kind}" movement`).toBeDefined();
    }
  });
});
