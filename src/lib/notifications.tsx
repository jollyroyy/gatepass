// The bell.
//
// TWO SOURCES, AND THE SECOND ONE IS THE POINT. Realtime tells a signed-in
// reader what just happened; a query on mount tells them what happened while
// they were not looking. Until 2026-08-17 there was only the first, so a
// mismatch raised at the gate while the HOD was signed out was announced to
// nobody and never appeared again — the bell was empty precisely when it had
// the most to say. Mismatches are now DERIVED FROM THE DATABASE on every mount
// (`status = 'flagged'`, the reader's own passes), which needs no new table: a
// flagged pass IS the outstanding notification, and it stops being one the
// moment the HOD rejects it or raises it again.
//
// DISMISSAL IS PERSISTED, for the same reason. With the derivation above, an
// in-memory dismissal would come straight back on the next page load, so the
// bell would be un-clearable. Dismissed keys live in localStorage — a display
// preference, not a fact about the pass, which is why it is not a column.
// `localStorage` is wrapped in try/catch throughout: Safari in private mode
// throws on write, and a bell that crashes the app is worse than one that
// forgets what was dismissed.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { gp, supabase } from '../supabaseClient';
import { factKey, readDismissed, writeDismissed } from './notificationDismissals';
import type { GatePassView, UserRole } from '../types';

export type NotificationType = 'flagged' | 'matched' | 'new_pass';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  passId: string | null;
  passNumber: string;
  timestamp: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Clear every notification about one pass. Called by the mismatch review
   *  screen once the HOD has decided: the pass is no longer flagged, so the
   *  bell must not keep offering a decision that has already been made. */
  dismissPass: (passId: string) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  dismiss: () => undefined,
  dismissAll: () => undefined,
  dismissPass: () => undefined,
});

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext);
}

const NOTIF_PREFIX = 'notif';

let nextId = 1;
function genId(): string {
  return `${NOTIF_PREFIX}-${nextId++}-${Date.now()}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The words the HOD reads on a mismatch. It names the guard where the view
 *  knows one, because "who did it" is the client's own requirement and an
 *  accusation with no author is not reviewable. */
export function mismatchMessage(passNumber: string, reason: string | null, by: string | null): string {
  const who = by ? ` by ${by}` : '';
  return `${passNumber} was mismatched at the gate${who}. Reason: ${reason || 'No reason recorded'}. Review and either reject it or raise it again.`;
}

type Props = {
  session: Session;
  role: UserRole | null;
  children: React.ReactNode;
};

export function NotificationProvider({ session, role, children }: Props): React.ReactElement {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Every fact the bell has already accounted for — shown, or dismissed in an
  // earlier session. Seeded from storage so a dismissed mismatch is not
  // re-derived on the next mount.
  const seenRef = useRef<Set<string>>(readDismissed());
  const dismissedRef = useRef<Set<string>>(readDismissed());

  const addNotification = useCallback((n: AppNotification) => {
    const key = factKey(n.passId, n.type);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    setNotifications((prev) => [n, ...prev]);
  }, []);

  /** Remember a dismissal, so the mount-time derivation does not undo it. */
  const remember = useCallback((n: AppNotification | undefined) => {
    if (!n) return;
    dismissedRef.current.add(factKey(n.passId, n.type));
    writeDismissed(dismissedRef.current);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        remember(prev.find((n) => n.id === id));
        return prev.filter((n) => n.id !== id);
      });
    },
    [remember],
  );

  const dismissAll = useCallback(() => {
    setNotifications((prev) => {
      prev.forEach(remember);
      return [];
    });
  }, [remember]);

  const dismissPass = useCallback(
    (passId: string) => {
      setNotifications((prev) => {
        prev.filter((n) => n.passId === passId).forEach(remember);
        return prev.filter((n) => n.passId !== passId);
      });
    },
    [remember],
  );

  const userId = session.user?.id;

  // ─── What happened while nobody was looking ────────────────────────────────
  // HOD only, and mismatches only. A guard's "new pass waiting" is a queue they
  // are already looking at on the console; a mismatch is a decision that is
  // waiting on one specific person and has nowhere else to surface.
  useEffect(() => {
    if (role !== 'hod' || !userId) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await gp()
          .from('v_gate_passes')
          .select('*')
          .eq('raised_by', userId)
          .eq('status', 'flagged')
          .order('flagged_at', { ascending: false });
        if (error || cancelled) return;
        for (const p of (data as GatePassView[] | null) ?? []) {
          addNotification({
            id: genId(),
            type: 'flagged',
            title: 'Gate Pass Mismatched',
            message: mismatchMessage(p.pass_number, p.flag_reason, p.verified_by_name),
            passId: p.id,
            passNumber: p.pass_number,
            timestamp: p.flagged_at ?? p.verified_at ?? p.created_at,
          });
        }
      } catch {
        // The bell is an aid, never a gate. A failed read leaves it empty rather
        // than blocking the app behind an error nobody can act on.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, userId, addNotification]);

  // ─── What is happening right now ───────────────────────────────────────────
  useEffect(() => {
    if (!role || !userId) return undefined;

    const isHod = role === 'hod';
    const isGuard = role === 'guard' || role === 'admin' || role === 'super_admin';
    if (!isHod && !isGuard) return undefined;

    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase.channel('app-notifications');

      if (isHod) {
        ch.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'gatepass', table: 'gate_passes' },
          (payload: Record<string, unknown>) => {
            const rec = payload.new as Record<string, unknown> | undefined;
            if (!rec) return;
            if (rec.raised_by !== userId) return;

            const status = rec.status as string | undefined;
            const passId = rec.id as string;
            const passNumber = rec.pass_number as string;
            const ts = (rec.updated_at ?? rec.created_at) as string;

            if (status === 'flagged') {
              addNotification({
                id: genId(),
                type: 'flagged',
                title: 'Gate Pass Mismatched',
                // `gate_passes` is the base table, so there is no verifier NAME
                // in this payload — only an id, which is not worth showing. The
                // review screen reads the name off the view.
                message: mismatchMessage(passNumber, (rec.flag_reason as string) ?? null, null),
                passId,
                passNumber,
                timestamp: ts || new Date().toISOString(),
              });
            } else if (status === 'matched') {
              addNotification({
                id: genId(),
                type: 'matched',
                title: 'Pass Matched',
                message: `${passNumber} was matched at the gate and material released.`,
                passId,
                passNumber,
                timestamp: ts || new Date().toISOString(),
              });
            }

            // A pass that has LEFT the flagged state no longer needs a decision,
            // so its mismatch notice goes — whether this HOD decided it here, in
            // another tab, or the gate re-verified it.
            if (status !== 'flagged') {
              setNotifications((prev) => prev.filter((n) => !(n.passId === passId && n.type === 'flagged')));
            }
          },
        );
      }

      if (isGuard) {
        ch.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'gatepass', table: 'gate_passes' },
          (payload: Record<string, unknown>) => {
            const rec = payload.new as Record<string, unknown> | undefined;
            if (!rec) return;

            addNotification({
              id: genId(),
              type: 'new_pass',
              title: 'New Pass Request',
              message: `${rec.pass_number as string} is waiting at the gate.`,
              passId: rec.id as string,
              passNumber: rec.pass_number as string,
              timestamp: (rec.created_at as string) || new Date().toISOString(),
            });
          },
        );
      }

      ch.subscribe();
    } catch {
      // No realtime available — the app still works without push notifications.
    }

    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [role, userId, addNotification]);

  const unreadCount = notifications.length;

  return (
    <NotificationContext.Provider
      value={{ notifications, unreadCount, dismiss, dismissAll, dismissPass }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export { formatTime as notifTime };
