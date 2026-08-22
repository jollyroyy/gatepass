// The row above both guard tables: the tab strip on the left, the global
// search and Scan QR on the right (client mock-up, 2026-08-19).
//
// The tabs carry a count over the WHOLE list, never the filtered one — a tab
// reading "(0)" is exactly what tells a reader not to click it.
//
// THE TABS ARE A PLAIN LIST OF `{key, label, count}`, not a `TypeTab` union.
// The two pages ask different questions of their rows — Pending OUT tabs by
// pass TYPE, Pending RGP Return by return STATUS — and each keeps its own
// exhaustive `Record` in its own filters module, which is where a missing tab
// should be a compile error. This component only draws them.
import React from 'react';

export interface GuardTab {
  key: string;
  label: string;
  count: number;
}

type Props = {
  tabs?: {
    /** Accessible name of the strip — what the tabs are a choice OF. */
    label: string;
    items: GuardTab[];
    active: string;
    onSelect: (key: string) => void;
  };
  /** The search bar element from `useGuardSearch`. OPTIONAL since 2026-08-22:
   *  the guard's search is drawn ONCE, by the dashboard, above everything —
   *  the drilled Pending OUT panel below it carries the tab strip alone. */
  search?: React.ReactElement;
};

export default function GuardToolbar({ tabs, search }: Props): React.ReactElement {
  return (
    <div className="gb-toolbar">
      {tabs ? (
        <div className="gb-tabs" role="tablist" aria-label={tabs.label}>
          {tabs.items.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tabs.active === t.key}
              className="gb-tab"
              onClick={() => tabs.onSelect(t.key)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
      ) : (
        <span />
      )}
      {search ?? null}
    </div>
  );
}
