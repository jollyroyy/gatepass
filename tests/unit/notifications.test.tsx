import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { NotificationProvider, useNotifications } from '../../src/lib/notifications';
import type { UserRole } from '../../src/types';

function fakeSession(userId: string, email: string): Session {
  return { user: { id: userId, email } } as unknown as Session;
}

function TestConsumer(): React.ReactElement {
  const { notifications, unreadCount, dismiss, dismissAll } = useNotifications();
  return (
    <div>
      <span data-testid="count">{unreadCount}</span>
      <ul data-testid="list">
        {notifications.map((n) => (
          <li key={n.id} data-testid={`notif-${n.id}`}>
            <span data-testid={`title-${n.id}`}>{n.title}</span>
            <span data-testid={`msg-${n.id}`}>{n.message}</span>
            <button data-testid={`dismiss-${n.id}`} onClick={() => dismiss(n.id)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {notifications.length > 0 && (
        <button data-testid="dismiss-all" onClick={dismissAll}>
          Dismiss All
        </button>
      )}
    </div>
  );
}

function renderProvider(role: UserRole | null = 'hod', userId = 'hod-1') {
  return render(
    <MemoryRouter>
      <NotificationProvider session={fakeSession(userId, 'hod@x.com')} role={role}>
        <TestConsumer />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

describe('NotificationProvider', () => {
  it('starts with zero notifications', () => {
    renderProvider();
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('renders children correctly', () => {
    render(
      <MemoryRouter>
        <NotificationProvider session={fakeSession('u1', 'a@b.com')} role="hod">
          <div>Child Content</div>
        </NotificationProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Child Content')).toBeInTheDocument();
  });

  it('accepts null role without crashing', () => {
    renderProvider(null);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('accepts guard role without crashing', () => {
    renderProvider('guard', 'guard-1');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('accepts admin role without crashing', () => {
    renderProvider('admin', 'admin-1');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('accepts staff role without crashing (no subscription)', () => {
    renderProvider('staff', 'staff-1');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('dismiss functions', () => {
  it('dismiss on empty list does not throw', () => {
    function Test(): React.ReactElement {
      const { dismiss } = useNotifications();
      return (
        <button data-testid="call-dismiss" onClick={() => dismiss('nonexistent')}>
          Dismiss
        </button>
      );
    }
    render(
      <MemoryRouter>
        <NotificationProvider session={fakeSession('u1', 'a@b.com')} role="hod">
          <Test />
        </NotificationProvider>
      </MemoryRouter>,
    );
    expect(() => {
      fireEvent.click(screen.getByTestId('call-dismiss'));
    }).not.toThrow();
  });

  it('dismissAll on empty list does not throw', () => {
    function Test(): React.ReactElement {
      const { dismissAll } = useNotifications();
      return (
        <button data-testid="call-dismiss-all" onClick={dismissAll}>
          Dismiss All
        </button>
      );
    }
    render(
      <MemoryRouter>
        <NotificationProvider session={fakeSession('u1', 'a@b.com')} role="hod">
          <Test />
        </NotificationProvider>
      </MemoryRouter>,
    );
    expect(() => {
      fireEvent.click(screen.getByTestId('call-dismiss-all'));
    }).not.toThrow();
  });
});
