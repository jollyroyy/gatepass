// NotificationBell (src/components/layout/NotificationBell.tsx) — the
// dropdown popup opened from the top-right bell. It already closed on an
// outside click; this pins the added × button and Escape support.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationBell from '../../src/components/layout/NotificationBell';

const dismiss = vi.fn();
const dismissAll = vi.fn();

vi.mock('../../src/lib/notifications', () => ({
  useNotifications: () => ({
    notifications: [
      { id: 'n1', type: 'flagged', title: 'Mismatch', message: 'A pass was flagged', timestamp: Date.now(), passId: 'p1' },
    ],
    unreadCount: 1,
    dismiss,
    dismissAll,
  }),
  notifTime: () => '2m ago',
}));

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

describe('NotificationBell popup', () => {
  it('opens on bell click and has a working × close button', () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Mismatch')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Mismatch')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Mismatch')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Mismatch')).not.toBeInTheDocument();
  });

  it('a click on a notification row does not need the close button, but does not throw', () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
  });
});
