// The board's top bar: what this board is, what day it is, and a way to re-read
// the database.
//
// THERE IS NO PERIOD SELECTOR. The board is today-only (client, 2026-08-17), and
// the control was removed rather than defaulted — a filter offering one option is
// a label, and one still offering five would promise a scope the page below no
// longer has.
//
// THE DATE IS PRINTED IN FULL ("Today · Monday, 17 Aug 2026"), and with the
// selector gone it is now the ONLY thing on the page that says which day the
// figures belong to: a board left open overnight on a wall screen would
// otherwise present yesterday's numbers under today's heading.
//
// THE WORD "TODAY" LIVES HERE AND NOWHERE ELSE (client, 2026-08-18). It used to
// be appended to every day-scoped tile — fourteen times on one screen — and was
// removed from all of them; this chip is what carries it now, which is why it
// leads with the word rather than the date. Do not put it back on a tile.
import React from 'react';

const TODAY_FORMAT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Props = {
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export default function BoardHeader({
  title, subtitle, onRefresh, refreshing,
}: Props): React.ReactElement {
  return (
    <div className="page-header flex flex-wrap items-end justify-between gap-4 border-b border-surface-200 pb-5">
      {/* The gold rule marks the board's own heading the way `.board-accent`
          marks every section heading below it — one family, top to bottom. The
          bottom hairline is what separates the heading from the attention strip,
          which is itself a coloured band and would otherwise read as part of the
          header. */}
      <div className="flex items-stretch gap-3 min-w-0">
        <span className="board-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-navy-600 border border-surface-200 rounded-xl px-3 py-2 whitespace-nowrap">
          <span className="font-semibold text-navy-800">Today</span>
          {` · ${TODAY_FORMAT.format(new Date())}`}
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-secondary px-3 py-2 text-caption whitespace-nowrap disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}
