// ApprovePanel / RejectPanel (src/pages/Security/VerifyPanels.tsx) are the
// confirm popups a guard sees at the gate. Closing them must always mean
// Cancel — never silently confirm an approval or a rejection.
//
// They were MatchPanel / FlagPanel until 2026-08-20, when the client asked for
// the guard's decision to read Approve / Reject; the RPCs behind them
// (match_pass / flag_pass) are unchanged.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovePanel, RejectPanel } from '../../src/pages/Security/VerifyPanels';
import type { GatePassItemView, GatePassView } from '../../src/types';

const PASS = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260810-0001',
  vehicle_number: 'WB01AB1234',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as GatePassView;

const ITEMS: GatePassItemView[] = [
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { id: 'i1', description: 'Drill', quantity: 2 } as any,
];

describe('ApprovePanel close behaviour', () => {
  it('has a Close button that calls onCancel, never onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ApprovePanel pass={PASS} items={ITEMS} submitting={false} error={null} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape without confirming', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ApprovePanel pass={PASS} items={ITEMS} submitting={false} error={null} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not close when clicking inside the panel', () => {
    const onCancel = vi.fn();
    render(
      <ApprovePanel pass={PASS} items={ITEMS} submitting={false} error={null} onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Confirm Approval'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('RejectPanel close behaviour', () => {
  it('has a Close button that calls onCancel, never onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<RejectPanel submitting={false} error={null} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape without confirming', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<RejectPanel submitting={false} error={null} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
