import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ allowed: false, allowedNow: false }));
const printSpy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'pass-1' }) };
});
vi.mock('../../src/lib/usePrintSlipData', () => ({
  usePrintSlipData: () => ({
    pass: { id: 'pass-1' }, items: [], events: [], roles: [], approvals: [],
    escalationHours: 0, signatures: {}, error: null,
  }),
}));
vi.mock('../../src/lib/useCanPrintPass', () => ({
  useCanPrintPass: () => state.allowed,
  canPrintPassNow: () => Promise.resolve(state.allowedNow),
}));
vi.mock('../../src/components/print/PassSlip', () => ({
  default: () => <div data-testid="pass-slip">Printable slip</div>,
}));

import PassPrint from '../../src/pages/Shared/PassPrint';

beforeEach(() => {
  state.allowed = false;
  state.allowedNow = false;
  printSpy.mockClear();
  vi.stubGlobal('print', printSpy);
});

describe('gate pass printing approval', () => {
  it('does not render a printable slip while required approvals are missing', () => {
    render(<MemoryRouter><PassPrint /></MemoryRouter>);
    expect(screen.getByText(/cannot be printed until all required authorities/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pass-slip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('rechecks approval when Print is pressed and hides a revoked slip', async () => {
    state.allowed = true;
    render(<MemoryRouter><PassPrint /></MemoryRouter>);
    expect(screen.getByTestId('pass-slip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(screen.queryByTestId('pass-slip')).not.toBeInTheDocument());
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('prints after the fresh approval check succeeds', async () => {
    state.allowed = true;
    state.allowedNow = true;
    render(<MemoryRouter><PassPrint /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(printSpy).toHaveBeenCalledOnce());
  });
});
