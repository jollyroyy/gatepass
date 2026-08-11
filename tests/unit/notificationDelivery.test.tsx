// The guard's bell must show a RED badge the moment a pass is raised and is
// waiting at the gate. This drives the provider's realtime INSERT callback
// directly — the path the earlier notifications tests never fired — and then
// renders the actual bell on top of the provider, so a payload on the wire
// becomes a visible red count.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { NotificationProvider } from '../../src/lib/notifications';
import NotificationBell from '../../src/components/layout/NotificationBell';
import type { UserRole } from '../../src/types';

interface MockChannel {
  name: string;
  handlers: { opts: Record<string, unknown>; cb: (payload: Record<string, unknown>) => void }[];
  on: (kind: string, opts: Record<string, unknown>, cb: (payload: Record<string, unknown>) => void) => MockChannel;
  subscribe: ReturnType<typeof vi.fn>;
}

const channels: MockChannel[] = [];

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    channel: (name: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch: any = { name, handlers: [] };
      ch.on = (kind: string, opts: Record<string, unknown>, cb: (payload: Record<string, unknown>) => void) => {
        ch.handlers.push({ opts, cb });
        return ch;
      };
      ch.subscribe = vi.fn();
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(),
  },
}));

function fakeSession(userId: string): Session {
  return { user: { id: userId } } as unknown as Session;
}

function renderGuardApp() {
  channels.length = 0;
  return render(
    <MemoryRouter>
      <NotificationProvider session={fakeSession('guard-1')} role={'guard' as UserRole}>
        <NotificationBell />
      </NotificationProvider>
    </MemoryRouter>,
  );
}

function insertHandler() {
  const ch = channels[0];
  return ch.handlers.find((h) => h.opts.event === 'INSERT' && h.opts.table === 'gate_passes');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guard bell — new pass raised', () => {
  it('subscribes to INSERTs on gatepass.gate_passes', () => {
    renderGuardApp();
    const handler = insertHandler();
    expect(handler).toBeDefined();
    expect(handler?.opts.schema).toBe('gatepass');
  });

  it('shows a red unread badge when the INSERT payload arrives', () => {
    renderGuardApp();
    const handler = insertHandler();
    expect(handler).toBeDefined();
    act(() => {
      handler!.cb({
        new: {
          id: 'pp-1',
          pass_number: 'NRGP-OUT-20260811-0007',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      });
    });
    const bell = screen.getByRole('button', { name: /notifications/i });
    expect(bell.getAttribute('aria-label')).toContain('1 unread');
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('lists the new pass as waiting at the gate', () => {
    renderGuardApp();
    const handler = insertHandler();
    act(() => {
      handler!.cb({
        new: {
          id: 'pp-1',
          pass_number: 'NRGP-OUT-20260811-0007',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('New Pass Request')).toBeInTheDocument();
    expect(screen.getByText(/NRGP-OUT-20260811-0007 is waiting at the gate/)).toBeInTheDocument();
  });
});
