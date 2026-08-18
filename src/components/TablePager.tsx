// "Showing 1–5 of 12" and the numbered pager under it.
//
// Extracted from ScheduledReturnsTable so Overdue Items renders the identical
// control rather than a second copy that drifts. The page arithmetic itself is
// `pageOf` in src/lib/scheduledReturns.ts — this is only the buttons.
import React from 'react';
import type { ReturnsPage } from '../lib/scheduledReturns';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { page: ReturnsPage<any>; onPage: (page: number) => void };

export default function TablePager({ page, onPage }: Props): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-surface-200/60">
      <span className="text-sm text-navy-500">
        Showing {page.from}–{page.to} of {page.total}
      </span>
      {page.pages > 1 && (
        <div className="flex items-center gap-1">
          <PagerButton label="Previous page" disabled={page.page === 1} onClick={() => onPage(page.page - 1)}>
            ‹
          </PagerButton>
          {Array.from({ length: page.pages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-current={n === page.page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={`min-w-[2rem] h-8 px-2 rounded-lg text-sm font-medium border transition-colors ${
                n === page.page
                  ? 'border-brand-600 text-brand-800 dark:text-brand-300 bg-brand-600/10'
                  : 'border-surface-200 text-navy-600 hover:border-surface-300'
              }`}
            >
              {n}
            </button>
          ))}
          <PagerButton label="Next page" disabled={page.page === page.pages} onClick={() => onPage(page.page + 1)}>
            ›
          </PagerButton>
        </div>
      )}
    </div>
  );
}

function PagerButton({
  label, disabled, onClick, children,
}: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="min-w-[2rem] h-8 px-2 rounded-lg text-sm border border-surface-200 text-navy-600
                 hover:border-surface-300 disabled:opacity-40 disabled:cursor-default"
    >
      {children}
    </button>
  );
}
