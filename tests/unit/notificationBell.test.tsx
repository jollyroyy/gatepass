// NotificationBell (src/components/layout/NotificationBell.tsx) — the
// dropdown popup opened from the top-right bell. It already closed on an
// outside click; this pins the added × button and Escape support.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
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

// Light-mode legibility. jsdom does no compositing, so these assert the class
// that decides the colour rather than a computed contrast ratio — the same
// approach tests/unit/themeAudit.test.ts takes. Every ratio below is against
// the panel's own surface, measured from the light values in src/index.css.
describe('NotificationBell — every control is legible in LIGHT mode', () => {
  const SOURCE = readFileSync(
    join(__dirname, '../../src/components/layout/NotificationBell.tsx'),
    'utf-8',
  );

  it('"Dismiss all" is not brass gold on a near-white panel (#C6A15B ≈ 2.2:1, fails AA)', () => {
    // Gold is the primary FILL colour of this design system; as ink on a light
    // surface it is barely there. Links elsewhere in the app use accent-600.
    expect(SOURCE).not.toMatch(/text-brand-600/);
  });

  it('the per-row dismiss × is not text-navy-300 (≈1.4:1 on white — effectively invisible)', () => {
    // navy-300 is rgb(213 209 201) in light mode. text-navy-400 is already
    // banned app-wide by themeAudit for the same reason; navy-300 is worse.
    expect(SOURCE).not.toMatch(/text-navy-300/);
  });

  it('the new-pass icon is not gold-on-cream (brand-600 on brand-100 ≈ 1.9:1)', () => {
    // The flagged and matched icons already clear 3:1 (red-600/emerald-600 on
    // their own 100-tints). The third one must not be the odd one out.
    expect(SOURCE).toMatch(/bg-brand-100[^"]*"[\s\S]{0,200}?text-brand-800/);
  });

  it('the row hover tint differs from the panel surface it sits on', () => {
    // A hover of bg-surface-50 on a bg-surface-50 panel is a no-op in both themes.
    expect(SOURCE).toMatch(/hover:bg-surface-100/);
    expect(SOURCE).not.toMatch(/hover:bg-surface-50\b/);
  });
});
