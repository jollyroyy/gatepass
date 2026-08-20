import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, notifTime } from '../../lib/notifications';
import { useEscapeKey } from '../../lib/useEscapeKey';

/** Which notices open a DECISION screen rather than the pass record. A lookup,
 *  never a string chain: a notification type added without a decision screen
 *  falls through to the record, which is the safe default. */
const DECISION_ROUTE: Record<string, string> = { flagged: '/mismatch', expired: '/expired' };

export default function NotificationBell(): React.ReactElement {
  const { notifications, unreadCount, dismiss, dismissAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEscapeKey(() => setOpen(false), open);

  // A NOTICE THAT CARRIES A DECISION GOES TO ITS REVIEW SCREEN, not to the pass
  // detail. The client's requirement, for both kinds, is that clicking the notice
  // shows what happened to the pass and offers two decisions — void it outright,
  // or raise it again — and `/pass/:id` is a record, not a decision. Every other
  // kind of notice is purely informational and still opens the record.
  //
  // A decision row is NOT dismissed on click: it is dismissed by being DECIDED
  // (the review screen calls `dismissPass`), and clearing it on a glance would
  // let an HOD lose the only pointer to an open decision by mis-tapping.
  const handleNotifClick = useCallback(
    (passId: string | null, notifId: string, type: string) => {
      setOpen(false);
      if (!passId) {
        dismiss(notifId);
        return;
      }
      // NOT A PASS (060). The id is a department deletion request and the
      // decision lives on the HOD's own dashboard, so this row must never be
      // routed to `/pass/:id` — that record does not exist.
      if (type === 'dept_delete') {
        dismiss(notifId);
        navigate('/dashboard');
        return;
      }
      const route = DECISION_ROUTE[type];
      if (route) {
        navigate(`${route}/${passId}`);
        return;
      }
      dismiss(notifId);
      navigate(`/pass/${passId}`);
    },
    [dismiss, navigate],
  );

  return (
    // `no-print`: the bell is fixed to the viewport, so on the A5 slip it
    // would print stamped over the pass's top-right corner.
    <div ref={panelRef} className="no-print fixed top-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 rounded-xl flex items-center justify-center bg-surface-50 shadow-md border border-surface-200 text-navy-600 hover:bg-surface-100 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold leading-none rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-md">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 rounded-xl bg-surface-50 shadow-xl border border-surface-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
            <span className="text-sm font-semibold text-navy-900">
              Notifications
            </span>
            <div className="flex items-center gap-3">
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={dismissAll}
                  className="text-xs font-medium text-accent-600 dark:text-accent-300 hover:underline"
                >
                  Dismiss all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="h-6 w-6 rounded-full flex items-center justify-center text-navy-500 hover:text-navy-700 hover:bg-surface-100 active:scale-95 transition-all duration-150"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-navy-500">
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotifClick(n.passId, n.id, n.type)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-100 border-b border-surface-200 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 mt-0.5">
                      {n.type === 'flagged' ? (
                        <span className="inline-flex h-6 w-6 rounded-full bg-red-100 dark:bg-red-900/30 items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                        </span>
                      ) : n.type === 'expired' ? (
                        // Orange, matching EXPIRED_STYLE and the Overdue badge:
                        // both mean "time ran out", and neither is a mismatch
                        // the guard found. Deliberately not the red above.
                        <span className="inline-flex h-6 w-6 rounded-full bg-orange-100 dark:bg-orange-900/30 items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                      ) : n.type === 'rejected' ? (
                        // Red, like the mismatch above: both are somebody
                        // refusing this pass. A cross rather than the warning
                        // triangle, because nothing here is in doubt — the pass
                        // is closed. There is no decision screen for it, so the
                        // notice falls through DECISION_ROUTE to the record,
                        // which is where the ladder names the office that
                        // rejected it and prints their reason.
                        <span className="inline-flex h-6 w-6 rounded-full bg-red-100 dark:bg-red-900/30 items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </span>
                      ) : n.type === 'matched' ? (
                        <span className="inline-flex h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="inline-flex h-6 w-6 rounded-full bg-brand-100 dark:bg-brand-900/30 items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-brand-800 dark:text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-navy-900 truncate">
                        {n.title}
                      </p>
                      <p className="text-xs text-navy-500 mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-navy-500 mt-1 tabular-nums">
                        {notifTime(n.timestamp)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(n.id);
                      }}
                      className="shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-navy-500 hover:text-navy-900 hover:bg-surface-200 transition-colors"
                      aria-label="Dismiss"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
