// THE WRITTEN DETAIL OF A TIMELINE ENTRY IS SET IN FROM THE RAIL (client,
// 2026-08-20: "whatever individual written items you show are … a little to the
// right side of the main timeline straight line, just to show them
// distinguished from the normal flow under Approval and activity timeline").
//
// Every rung of the merged rail used to print its heading and every line under
// it flush against the same left edge, so the name, the department, the moment
// and the remark read as one block of prose and the eye had nothing to tell the
// heading from what the heading is about.
//
// The HEADING stays on the rail — it is the step, and it must line up with its
// own dot. Everything WRITTEN under it is indented one step further right, in
// a single block, so a reader scanning the rail sees the chain of steps down
// the left and the detail hanging off it.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PassTimeline from '../../src/components/passview/PassTimeline';
import type { ApprovalStep } from '../../src/lib/approvalLadder';
import type { ActivityEntry } from '../../src/components/passview/PassTimeline';

const steps: ApprovalStep[] = [
  {
    key: 'raised', label: 'Raised By', who: 'Ramesh Yadav',
    detail: 'Engineering (MEP)', at: '2026-08-18T05:00:00Z', state: 'done',
    note: 'Approved on raising',
  },
  {
    key: 'level-1', label: 'Security Head', who: 'Demi', detail: null,
    at: null, state: 'pending',
  },
  {
    key: 'return', label: 'To Be Returned', who: null, detail: '24 Aug 2026',
    at: null, state: 'pending',
  },
];

const activity: ActivityEntry[] = [
  {
    id: 'v1', gate_pass_id: 'p1', action: 'matched', remarks: 'All items checked',
    created_at: '2026-08-18T06:15:00Z', security_name: 'Guard Soham',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
];

describe('the timeline sets its written detail in from the rail', () => {
  it('gives every entry — ladder, activity and the closing return — one indented detail block', () => {
    render(<PassTimeline steps={steps} activity={activity} />);
    const blocks = screen.getAllByTestId('timeline-detail');
    // three ladder/closing rungs plus the one gate event
    expect(blocks).toHaveLength(4);
    for (const b of blocks) expect(b.className).toMatch(/\bpl-4\b/);
  });

  it('keeps the step heading on the rail, outside the indented block', () => {
    render(<PassTimeline steps={steps} activity={activity} />);
    for (const label of ['Raised By', 'Security Head', 'To Be Returned', 'Cleared out at the gate']) {
      const heading = screen.getByText(label);
      expect(heading.closest('[data-testid="timeline-detail"]')).toBeNull();
    }
  });

  it('puts the name, the department, the moment, the note and a remark inside it', () => {
    render(<PassTimeline steps={steps} activity={activity} />);
    for (const text of ['Ramesh Yadav', 'Engineering (MEP)', 'Approved on raising', 'Demi', 'All items checked']) {
      expect(screen.getByText(text).closest('[data-testid="timeline-detail"]')).not.toBeNull();
    }
  });
});
