// FLAG TO REQUESTER — the gate's second answer, and the only one that is not
// final (client, 2026-08-23: "replace the reject with flag to requestor
// button"; "if he clicks on the flag to the requester, he has to mention why he
// is flagging it … it will pass to the requester HOD immediately … if he
// approves it will again come back to the guard. It will not go to the approver
// for all the other three approvals").
//
// It is the SAME transition the guard's Reject already made — `flag_pass`,
// status `flagged`, straight back to the raising HOD, who may send it back to
// the gate with `hod_review_flagged_pass('approve')` without re-entering the
// approval ladder. What changed on 2026-08-23 is what the gate reads, that the
// HOD must now write a note either way, and that the guard's Approve action
// lands ON the decision rather than a record two clicks above it.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FlagPanel } from '../../src/pages/Security/VerifyPanels';
import ApproveOutAction from '../../src/components/guard/ApproveOutAction';
import { ACTION_TITLE } from '../../src/components/passview/PassTimelineParts';

describe('the gate flags a pass to its requester', () => {
  it('names the requester on the button, and the old Reject wording is gone', () => {
    render(<FlagPanel submitting={false} error={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Flag to Requester' })).toBeTruthy();
    expect(screen.queryByText('Reject Gate Pass')).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm Rejection/ })).toBeNull();
  });

  it('will not send without a reason — a box of spaces is not one', () => {
    const onConfirm = vi.fn();
    render(<FlagPanel submitting={false} error={null} onCancel={vi.fn()} onConfirm={onConfirm} />);
    const send = screen.getByRole('button', { name: 'Send to Requester' });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Reason for flagging/), { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Reason for flagging/), { target: { value: 'Only 1 of 2 drills present.' } });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    expect(onConfirm).toHaveBeenCalledWith('Only 1 of 2 drills present.');
  });
});

describe("the guard's Approve action", () => {
  it('lands on the decision itself, not on the record two clicks above it', () => {
    render(<MemoryRouter><ApproveOutAction id="q1" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Approve OUT' })).toHaveAttribute('href', '/verify/q1');
  });
});

describe('the timeline says a flag is a flag', () => {
  it('names the gate event as a flag to the requester, not a rejection', () => {
    expect(ACTION_TITLE.flagged).toMatch(/flag/i);
    expect(ACTION_TITLE.flagged).not.toMatch(/reject/i);
    // And the answer that sends it back to the gate says so.
    expect(ACTION_TITLE.hod_reviewed).toMatch(/gate/i);
  });
});

describe('the requester answers the flag in writing', () => {
  it('will not clear a flag without a note, and sends the note with the approval', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.doMock('../../src/supabaseClient', () => ({ gp: () => ({ rpc }) }));
    const FlaggedReviewActions = (await import('../../src/pages/Shared/FlaggedReviewActions')).default;

    render(<FlaggedReviewActions passId="p1" onDone={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send Back to the Gate' }));

    const send = screen.getByRole('button', { name: 'Send Back to the Gate' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why you are clearing this flag/), {
      target: { value: 'Checked with stores — the second drill is on the next trip.' },
    });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    expect(rpc).toHaveBeenCalledWith('hod_review_flagged_pass', {
      p_pass_id: 'p1',
      p_action: 'approve',
      p_reason: 'Checked with stores — the second drill is on the next trip.',
    });
    vi.doUnmock('../../src/supabaseClient');
  });
});
