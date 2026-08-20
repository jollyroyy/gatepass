// The report's head, drawn to the client's mock-up (2026-08-20): the title and
// what the page is for on the left, the date stamp and the three-button cluster
// on the right.
//
// TWO ACTIONS EXIST, AND THE MOCK DRAWS THREE BUTTONS. This app can put the
// register in a spreadsheet (`downloadCsv`) and it can print it (`window.print`,
// through the `report-sheet` print rules) — there is no PDF renderer and no
// server-side export. So the Export menu is the FORMAT LIST, and Print and
// Download are the two shortcuts the mock puts beside it, each landing on one of
// its entries. Shortcuts to menu items is an ordinary pattern; a button wired to
// nothing is not, and this repo has refused those before (the guard board's
// fourth quick-action tile).
//
// The stamp is taken ONCE by the page at mount. A ticking clock would re-render
// a 250-row table every second for a fact that changes by the minute.
import React, { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/formatDate';

const CALENDAR = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
    <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
  </svg>
);

const DOWNLOAD = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v10m0 0l-3.5-3.5M12 14.5l3.5-3.5" />
    <path strokeLinecap="round" d="M4.75 16.75v1.5a1.5 1.5 0 001.5 1.5h11.5a1.5 1.5 0 001.5-1.5v-1.5" />
  </svg>
);

const PRINTER = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 9V4.5h10V9M7 18H5.5A1.5 1.5 0 014 16.5v-5A1.5 1.5 0 015.5 10h13a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-1.5 1.5H17" />
    <rect x="7" y="14.5" width="10" height="5" rx="1" />
  </svg>
);

type Props = {
  /** ISO stamp, taken once at mount by the page. */
  stamp: string;
  onExportCsv: () => void;
  onPrint: () => void;
};

export default function ReportsHeader({ stamp, onExportCsv, onPrint }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // A menu that will not close is worse than no menu, and a click anywhere else
  // on the page is what a reader expects to dismiss it.
  useEffect(() => {
    if (!open) return undefined;
    function away(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function pick(run: () => void) {
    setOpen(false);
    run();
  }

  return (
    <div className="gb-rep-head">
      <div className="min-w-0">
        <h1 className="gb-rep-title">Gate Pass Report (RGP &amp; NRGP)</h1>
        <p className="gb-sub">
          View and download RGP and NRGP gate pass transactions with detailed information.
        </p>
      </div>

      <div className="gb-rep-side no-print">
        <span className="gb-stamp">
          {CALENDAR}
          {formatDateTime(stamp)}
        </span>

        <div className="gb-rep-actions">
          <div className="gb-rep-menu-wrap" ref={wrap}>
            <button
              type="button"
              className="gb-btn-ghost"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {DOWNLOAD}
              Export ▾
            </button>
            {open && (
              <div className="gb-rep-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => pick(onExportCsv)}>
                  Spreadsheet (.csv)
                </button>
                <button type="button" role="menuitem" onClick={() => pick(onPrint)}>
                  Print / PDF
                </button>
              </div>
            )}
          </div>

          <button type="button" className="gb-btn-ghost" onClick={onPrint}>
            {PRINTER}
            Print
          </button>

          <button type="button" className="gb-btn-primary" onClick={onExportCsv}>
            {DOWNLOAD}
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
