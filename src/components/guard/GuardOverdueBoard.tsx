// OVERDUE RGP GATE PASSES — the guard's overdue screen (client, 2026-08-19).
//
// ONE COUNT, AND THE STACK IT OPENS. The client stripped this page back to a
// single card: "just keep the main total overdue ... only keep that card and
// count and make that reliable ... once it is clicked all the cards will be
// stacked". So there are no other KPI tiles, no filter bar, no export button
// and no Guard Actions block at the foot — every one of those was on the
// screen this replaces, and every one of them was asked for by name to go.
//
// THE COUNT IS PASSES, NOT LINES, and it is derived rather than re-asked:
// `buildOverduePasses` groups exactly the rows `buildOverdueRows` produces, so
// the number on the card is `rows.length` of the very array the stack renders.
// It cannot say 5 over a stack of 4, and it cannot disagree with Overdue Items
// or with the return queue about what "late" means — see overduePasses.ts.
//
// THE HOD'S AND THE ADMIN'S PAGE IS UNCHANGED. This is the guard's screen
// alone; OverdueItemsPage still hands those two roles the item-level board,
// which carries the filters, the department chart and the trend they read it
// for. The guard chases a slip, not a backlog's shape.
//
// IT IS SPELLED RGP. The client's mock-up says "RJP"; the schema, the pass
// numbers, the printed slip and every other screen in this app say RGP, and a
// screen that renames the thing it is showing teaches the wrong word to the one
// person who reads the number off the paper.
import React, { useMemo, useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import { buildOverduePasses } from '../../lib/overduePasses';
import { pageOf } from '../../lib/scheduledReturns';
import GuardPageHeader from './GuardPageHeader';
import GuardIcon from './GuardIcon';
import GuardPager from './GuardPager';
import OverduePassCard from './OverduePassCard';

/** Ten cards is about a screen and a half on the tablet at the gate. Unlike a
 *  table row a card is tall, so the page size is the pager's, not the table's
 *  five. */
const PAGE_SIZE = 10;

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <svg
    className="gpo-chev"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

type Props = {
  passes: GatePassView[];
  items: GatePassItemView[];
  loading: boolean;
  error: string | null;
};

export default function GuardOverdueBoard({
  passes,
  items,
  loading,
  error,
}: Props): React.ReactElement {
  const rows = useMemo(() => buildOverduePasses(passes, items), [passes, items]);
  // OPEN BY DEFAULT ONCE THERE IS SOMETHING TO SHOW. The card is a toggle, as
  // asked; starting it closed would mean a guard who walks up to a screen
  // reading "5" has to press before the app tells them which five.
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(PAGE_SIZE);
  // Stamped once, at mount — a clock that ticks re-renders every card on the
  // page every second for a fact that changes by the day.
  const [stamp] = useState(() => new Date().toISOString());

  const view = pageOf(rows, page, size);
  const total = rows.length;

  return (
    <div className="gb-board">
      <GuardPageHeader
        title="Overdue RGP Gate Passes"
        subtitle="RGP gate passes that are past their return deadline."
        glyph="alert"
        tone="red"
        stamp={stamp}
      />

      {error && <div className="gb-alert">{error}</div>}

      {loading ? (
        <div className="gb-card gb-panel">
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="gpo-total"
            aria-expanded={open}
            aria-controls="overdue-stack"
            disabled={total === 0}
            onClick={() => setOpen((v) => !v)}
          >
            <GuardIcon glyph="alert" tone="red" shape="square" />
            <span className="gpo-total-body">
              <span className="gpo-total-title">Overdue Passes</span>
              <span className="gpo-total-figure">{total}</span>
              <span className="gpo-total-note">
                {total === 0
                  ? 'Nothing is past its return deadline'
                  : 'Past return deadline — tap to see them'}
              </span>
            </span>
            {total > 0 && <Chevron open={open} />}
          </button>

          {total === 0 ? (
            <div className="gb-card gb-panel">
              <div className="gb-empty">
                Nothing is overdue. Every RGP still out is within its return date.
              </div>
            </div>
          ) : (
            open && (
              <div id="overdue-stack">
                <ul className="gpo-stack">
                  {view.rows.map((row) => (
                    <OverduePassCard key={row.pass.id} row={row} />
                  ))}
                </ul>
                <div className="gb-card gb-panel gpo-stack-foot">
                  <GuardPager
                    page={view}
                    size={size}
                    onPage={setPage}
                    onSize={(n) => {
                      setSize(n);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
