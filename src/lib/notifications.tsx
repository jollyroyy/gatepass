import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import type { UserRole } from '../types';

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
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  dismiss: () => undefined,
  dismissAll: () => undefined,
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

type Props = {
  session: Session;
  role: UserRole | null;
  children: React.ReactNode;
};

export function NotificationProvider({ session, role, children }: Props): React.ReactElement {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const addNotification = useCallback((n: AppNotification) => {
    const key = `${n.passId}|${n.type}`;
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    setNotifications((prev) => [n, ...prev]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    if (!role || !session.user?.id) return undefined;

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
            if (rec.raised_by !== session.user.id) return;

            const status = rec.status as string | undefined;
            const passId = rec.id as string;
            const passNumber = rec.pass_number as string;
            const ts = (rec.updated_at ?? rec.created_at) as string;

            if (status === 'flagged') {
              const reason = (rec.flag_reason as string) ?? 'No reason recorded';
              addNotification({
                id: genId(),
                type: 'flagged',
                title: 'Pass Flagged',
                message: `${passNumber} was flagged at the gate. Reason: ${reason}`,
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

            const passId = rec.id as string;
            const passNumber = rec.pass_number as string;
            const ts = rec.created_at as string;

            addNotification({
              id: genId(),
              type: 'new_pass',
              title: 'New Pass Request',
              message: `${passNumber} is waiting at the gate.`,
              passId,
              passNumber,
              timestamp: ts || new Date().toISOString(),
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
  }, [role, session.user?.id, addNotification]);

  const unreadCount = notifications.length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, dismiss, dismissAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

export { formatTime as notifTime };
