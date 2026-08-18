// Stacked cards, everywhere they appear: numbered, compact, and with a
// timeline that reads DOWN the card.
//
// Client, 2026-08-18: "in the stacked list there is no numbering so it is very
// hard to find how many exactly — put the numbering also"; "keep the length of
// the individual stacked cards a little compact so it doesn't take too much
// space, across all the views"; "instead of Raised 02:07 pm / Cleared Out
// 02:10 pm showing it in a horizontal way, show it in a vertical way so that
// it is in the format of a timeline … across whenever we are drilling down on
// the stacked cards across all the views".
//
// All three live in `PassRow` and the two components it composes, so every
// list gets them at once: DrillList (HOD + admin drills), GuardDrillCard (the
// guard board), MyPassCard, PhoneSearchResults and the review stacks.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DrillList from '../../src/components/DrillList';
import GuardDrillCard from '../../src/pages/Security/GuardDrillCard';
import type { GatePassView } from '../../src/types';
import type { DrillDef } from '../../src/lib/boardDrills';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Service', expected_return_date: '2026-08-25', actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null,
    created_at: '2026-08-18T04:00:00Z', updated_at: '2026-08-18T07:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 100,
    material_summary: 'Drill Machine',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DEF = {
  key: 'k', label: 'Some figure', heading: 'Some passes', empty: 'Nothing here',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as DrillDef<string>;

describe('a stacked list is numbered', () => {
  it('numbers every card in order, 1-based', () => {
    render(
      <MemoryRouter>
        <DrillList
          def={DEF}
          loading={false}
          rows={[pass(), pass({ id: 'p2', pass_number: 'RGP-20260818-0002' })]}
        />
      </MemoryRouter>,
    );
    const ordinals = screen.getAllByTestId('pass-ordinal');
    expect(ordinals.map((o) => o.textContent)).toEqual(['1', '2']);
  });

  it('numbers the guard\'s cards too — same component, same list', () => {
    render(
      <MemoryRouter>
        <GuardDrillCard pass={pass()} index={4} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pass-ordinal')).toHaveTextContent('4');
  });
});

describe('a drilled-down card reads down, not across', () => {
  it('stacks the timeline moments vertically', () => {
    render(
      <MemoryRouter>
        <GuardDrillCard pass={pass()} index={1} />
      </MemoryRouter>,
    );
    const strip = screen.getByTestId('pass-timeline');
    expect(strip.className).toContain('flex-col');
    // Both moments are still there — vertical is a layout change, not a trim.
    expect(within(strip).getByText('Raised')).toBeInTheDocument();
    expect(within(strip).getByText('Cleared Out')).toBeInTheDocument();
  });

  it('is compact on the guard board as well as the HOD board', () => {
    // `dense` is what makes a card compact; the guard's cards used to be the
    // roomy variant and crowded the screen (client, 2026-08-18).
    render(
      <MemoryRouter>
        <GuardDrillCard pass={pass()} index={1} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pass-card-header').className).not.toContain('pt-5');
  });
});
