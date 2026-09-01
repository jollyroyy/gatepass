// "RETURNED" IS A CLAIM ABOUT MATERIAL, AND IT MUST BE TRUE.
//
// Client, 2026-09-01: "once a NRGP gate pass is cleared out the status of it
// should show as out, not returned yet or something on that line, very
// professional — and its status should be changed to returned or partially
// returned only when any of its items has been returned. Change the status
// across all the views everywhere, starting from the reporting, from the print
// pass everywhere, in the details of the page everywhere."
//
// THIS RETIRES THE COST 2026-08-21 KNOWINGLY TOOK. `RGP_STAGE_STYLES` printed
// "Partially Returned" for BOTH open stages, and said so in a flagged comment:
// "a pass with NOTHING back reads 'Partially Returned' too". That is the exact
// sentence this file now forbids. An RGP the gate has just cleared has nothing
// back, and a badge claiming a part-return on it is a false statement about
// where the mall's material is — the one thing this register exists to say.
//
// The four words, and each is now earned:
//
//   Out — Awaiting Return   the gate cleared it, NOTHING is back yet
//   Partially Returned      at least one line has come back, not all
//   Returned                every line is back  (was "Closed")
//   Out — No Return Due     an NRGP through the gate: nothing is coming back
//
// "Closed" is gone from the BADGE and kept on the timeline's own closing rung
// (`passLadderLegs.returnStep`), where it means the end of the pass rather than
// the whereabouts of the goods. Overdue still outranks the two open stages.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import { passStageStyle } from '../../src/lib/passStage';
import { rgpStageStyle } from '../../src/lib/rgpLifecycle';
import { reportStatusLabel, reportStatusOf } from '../../src/lib/gatePassReport';
import { stageTone } from '../../src/lib/passStackCard';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    type: 'RGP',
    status: 'matched',
    return_status: 'awaiting_return',
    is_overdue: false,
    is_expired: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const clearedNrgp = pass({ type: 'NRGP', status: 'matched', return_status: 'not_applicable' });
const nothingBack = pass({ return_status: 'awaiting_return' });
const someBack = pass({ return_status: 'partially_returned' });
const allBack = pass({ return_status: 'returned' });

describe('the badge never claims a return that has not happened', () => {
  it('an RGP with nothing back reads "Out — Awaiting Return"', () => {
    expect(passStageStyle(nothingBack).label).toBe('Out — Awaiting Return');
  });

  it('"Partially Returned" is reserved for a pass that really has a line back', () => {
    expect(passStageStyle(someBack).label).toBe('Partially Returned');
  });

  it('a fully returned RGP reads "Returned", not "Closed"', () => {
    expect(passStageStyle(allBack).label).toBe('Returned');
  });

  it('a cleared NRGP reads "Out — No Return Due" — it is out, and owes nothing', () => {
    expect(passStageStyle(clearedNrgp).label).toBe('Out — No Return Due');
  });

  it('never says "Closed" on any of the four', () => {
    for (const p of [clearedNrgp, nothingBack, someBack, allBack]) {
      expect(passStageStyle(p).label).not.toBe('Closed');
    }
  });

  // The stage helper underneath must agree — it is what the return legend and
  // the drill pills read, and a second vocabulary is how the two drift apart.
  it('rgpStageStyle carries the same three words', () => {
    expect(rgpStageStyle(nothingBack)?.label).toBe('Out — Awaiting Return');
    expect(rgpStageStyle(someBack)?.label).toBe('Partially Returned');
    expect(rgpStageStyle(allBack)?.label).toBe('Returned');
  });

  // Overdue outranks BOTH open stages and is unchanged by this: a missed date
  // is the sharper fact, and it is a word rather than a hue on the mono laser.
  it('overdue still outranks either open stage', () => {
    expect(passStageStyle(pass({ return_status: 'awaiting_return', is_overdue: true })).label)
      .toBe('Overdue');
    expect(passStageStyle(pass({ return_status: 'partially_returned', is_overdue: true })).label)
      .toBe('Overdue');
  });

  // Every new word must have a tone, or the stacked card silently greys out.
  it('every new word has a tone on the stacked card', () => {
    expect(stageTone(nothingBack)).toBe('blue');
    expect(stageTone(someBack)).toBe('blue');
    expect(stageTone(allBack)).toBe('green');
    expect(stageTone(clearedNrgp)).toBe('green');
  });
});

describe('the register says exactly what the badge over it says', () => {
  // The bucket still lumps both open stages — one card cannot say two things —
  // but the ROW must not, which is where the false claim was being printed.
  it('an in-progress ROW distinguishes nothing-back from something-back', () => {
    expect(reportStatusLabel(nothingBack)).toBe('Out — Awaiting Return');
    expect(reportStatusLabel(someBack)).toBe('Partially Returned');
  });

  it('a returned RGP and a cleared NRGP read as the badge does', () => {
    expect(reportStatusLabel(allBack)).toBe('Returned');
    expect(reportStatusLabel(clearedNrgp)).toBe('Out — No Return Due');
  });

  it('the buckets themselves are untouched — the filter keys still sort', () => {
    expect(reportStatusOf(nothingBack)).toBe('in_progress');
    expect(reportStatusOf(someBack)).toBe('in_progress');
    expect(reportStatusOf(allBack)).toBe('completed');
    expect(reportStatusOf(clearedNrgp)).toBe('completed');
  });

  it('overdue and expired still outrank the row word', () => {
    expect(reportStatusLabel(pass({ is_overdue: true }))).toBe('Overdue');
    expect(reportStatusLabel(pass({ status: 'pending', return_status: 'not_applicable', is_expired: true })))
      .toBe('Expired');
  });
});
