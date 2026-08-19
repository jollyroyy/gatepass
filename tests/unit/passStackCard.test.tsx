// ONE STACKED CARD, EVERY ROLE (client, 2026-08-19: "all the cards across all
// the admin, whether admin or HOD level, should mimic the exact same stacked
// card style of the guard's view. Also upon clicking on those cards it should
// show up the exact details as guard, but the only difference will be that HOD
// and admin cannot perform any action — they can just see the return status").
//
// This supersedes four test files, deleted with what they pinned:
//   * hodDrillCard      — the shadcn drill card (header/body/footer) is gone
//   * myPassCard        — the glass register card is gone
//   * stackedCards      — its numbering rule is re-pinned below; its vertical
//                         timeline and `dense` cases died with the drill card
//   * stackedCardItemLines — the opened card's material table is gone with the
//                         disclosure; each line's value and the total are on
//                         the record the card now opens (passRecordItemsTable).
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import DrillList from '../../src/components/DrillList';
import MyPassesTable from '../../src/pages/HOD/MyPassesTable';
import { drillDefOf } from '../../src/lib/boardDrills';
import { STAGE_TONES, stageTone } from '../../src/lib/passStackCard';
import { STATUS_STYLES, EXPIRED_STYLE } from '../../src/lib/statusStyles';
import { RGP_STAGE_STYLES } from '../../src/lib/rgpLifecycle';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'P M Sharma',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Servicing', expected_return_date: '2026-08-25', actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null,
    created_at: '2026-08-18T04:00:00Z', updated_at: '2026-08-18T07:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 2, total_quantity: 3, returned_quantity: 0, total_value: 4500,
    material_summary: 'Drill Machine, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DEF = drillDefOf({
  key: 'kpi-outside', heading: 'Still out', empty: 'Nothing is still out.', rows: [],
});

function renderDrill(rows: GatePassView[], showRaisedBy = true) {
  return render(
    <MemoryRouter>
      <DrillList def={DEF} rows={rows} loading={false} showRaisedBy={showRaisedBy} />
    </MemoryRouter>,
  );
}

describe('every stacked list draws the guard’s card', () => {
  it('renders one .gpo-card per pass, on the guard’s own token island', () => {
    renderDrill([pass(), pass({ id: 'p2', pass_number: 'RGP-20260818-0002' })]);
    const cards = screen.getAllByTestId('pass-stack-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].className).toContain('gpo-card');
    // The `--gb-*` variables only exist inside one of the three islands.
    expect(screen.getByTestId('pass-stack').parentElement?.className).toContain('gb-stack');
  });

  it('is a link to the pass record — it expands nothing', () => {
    renderDrill([pass()]);
    const card = screen.getByTestId('pass-stack-card');
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/pass/p1');
    // No disclosure, no action: the card's only affordance is the record.
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('carries the facts, the item count and the money', () => {
    renderDrill([pass()]);
    const card = within(screen.getByTestId('pass-stack-card'));
    expect(card.getByText('Requested By')).toBeInTheDocument();
    expect(card.getByText('P M Sharma')).toBeInTheDocument();
    expect(card.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(card.getByText('Drill Machine, Ladder')).toBeInTheDocument();
    expect(card.getByText('Total Value')).toBeInTheDocument();
    expect(card.getByText('₹4,500')).toBeInTheDocument();
    expect(card.getByText('2')).toBeInTheDocument();
  });

  it('shows an unpriced pass a dash, never ₹0', () => {
    renderDrill([pass({ total_value: 0 })]);
    expect(screen.queryByText('₹0')).not.toBeInTheDocument();
  });

  it('drops Requested By when the list says so — the HOD raised these', () => {
    renderDrill([pass()], false);
    expect(screen.queryByText('Requested By')).not.toBeInTheDocument();
    expect(screen.queryByText('P M Sharma')).not.toBeInTheDocument();
  });

  it('numbers the stack 1-based, in order', () => {
    renderDrill([pass(), pass({ id: 'p2', pass_number: 'RGP-20260818-0002' })]);
    expect(screen.getAllByTestId('pass-ordinal').map((o) => o.textContent)).toEqual(['1', '2']);
  });

  it('states the return status as a pill, and nothing to press', () => {
    renderDrill([pass({ return_status: 'partially_returned' })]);
    const card = within(screen.getByTestId('pass-stack-card'));
    expect(card.getByText('Partly Returned')).toBeInTheDocument();
  });

  it('prints an overdue return date in the late ink', () => {
    renderDrill([pass({ is_overdue: true })]);
    const value = screen.getByText('25 Aug 2026');
    expect(value.className).toContain('gpo-fact-late');
  });

  it('an NRGP carries the moment it left, not a deadline it cannot miss', () => {
    renderDrill([pass({ type: 'NRGP', return_status: 'not_applicable' })]);
    const card = within(screen.getByTestId('pass-stack-card'));
    expect(card.getByText('Cleared')).toBeInTheDocument();
    expect(card.queryByText('Return Before')).not.toBeInTheDocument();
  });
});

describe('My Passes is the same stack', () => {
  it('draws the guard’s card and hides the HOD’s own name', () => {
    const rows = [pass()];
    render(
      <MemoryRouter>
        <MyPassesTable rows={rows} filtered={rows} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pass-stack-card')).toBeInTheDocument();
    expect(screen.queryByText('Requested By')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('pass-stack-card')).getByRole('link'))
      .toHaveAttribute('href', '/pass/p1');
  });
});

// A tone map keyed on a LABEL cannot be exhaustive at compile time the way a
// Record<Enum, T> is, so this is the test that catches a new stage arriving
// with no colour beside it.
describe('every stage the badge can name has a tone', () => {
  it('covers each label in the four style maps', () => {
    const labels = [
      ...Object.values(STATUS_STYLES).map((s) => s.label),
      ...Object.values(RGP_STAGE_STYLES).map((s) => s.label),
      EXPIRED_STYLE.label,
      'Overdue',
    ];
    for (const label of labels) expect(STAGE_TONES[label]).toBeDefined();
  });

  it('tones an overdue pass red and a closed one green', () => {
    expect(stageTone(pass({ is_overdue: true }))).toBe('red');
    expect(stageTone(pass({ return_status: 'returned' }))).toBe('green');
  });
});
