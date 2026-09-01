// EVERYBODY WHO MAY RAISE A PASS IS OFFERED IT ON THE SCREEN THEY LAND ON.
//
// Client, 2026-09-01: "in the dashboard also make sure to put Create Gate Pass
// in the dashboard of all whoever can create gate passes."
//
// THE GAP THIS CLOSES. Since 069 exactly three actors may raise: an HOD, the
// sitting COO and the sitting CEO. The HOD has had a "Raise Gate Pass" tile on
// their board since 2026-08-19 (`HodQuickActions`). The other two never did —
// `officeReplacesRole` sends an office holder to `/approvals`, and that page
// drew a Quick Actions block for the CEO alone, holding one link, to the
// whitelist. So the COO and the CEO were granted `/raise` by `roleRoutes` and
// then given no way to reach it but to type the URL, and `/my-passes` — the
// only register that lists a pass they raised (069's `raised_by = auth.uid()`
// arm) — was reachable only from the sidebar.
//
// THE RULE THIS FILE PINS, and it is the one worth keeping: the set of offices
// offered the tile is `RAISING_OFFICES` itself, never a hand-written list. A
// third office gaining `/raise` must not be able to gain it without the button
// appearing, which is exactly how the COO and the CEO ended up in this state.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ApproverQuickActions from '../../src/components/approver/ApproverQuickActions';
import { RAISING_OFFICES, officeRaises } from '../../src/lib/roleRoutes';
import type { ApprovalRoleKey } from '../../src/lib/approvalLadder';

const ALL_OFFICES: ApprovalRoleKey[] = ['security_head', 'finance_head', 'coo', 'ceo'];

function draw(office: ApprovalRoleKey) {
  return render(
    <MemoryRouter>
      <ApproverQuickActions office={office} />
    </MemoryRouter>,
  );
}

describe('the approver board offers the actions that office really has', () => {
  it.each(RAISING_OFFICES)('offers %s a Raise Gate Pass tile that opens /raise', (office) => {
    draw(office);
    const tile = screen.getByRole('link', { name: /raise gate pass/i });
    expect(tile).toHaveAttribute('href', '/raise');
  });

  it.each(RAISING_OFFICES)('offers %s their own register at /my-passes', (office) => {
    draw(office);
    expect(screen.getByRole('link', { name: /my raised passes/i })).toHaveAttribute(
      'href', '/my-passes',
    );
  });

  // The Security Head clears material at the barrier and the Finance HOD signs
  // level 2 — letting either originate the material they vet is the collision
  // `officeReplacesRole` exists to prevent, so the tile must not merely be
  // route-guarded, it must not be drawn.
  it.each(ALL_OFFICES.filter((o) => !officeRaises(o)))(
    'offers %s no way to raise a pass at all', (office) => {
      draw(office);
      expect(screen.queryByRole('link', { name: /raise gate pass/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /my raised passes/i })).toBeNull();
    },
  );

  // The CEO's second queue (053) was the only tile this block used to hold.
  // It stays that office's alone: `list_whitelist_requests` shows every other
  // office an empty page.
  it('keeps the whitelist tile on the CEO alone', () => {
    const ceo = draw('ceo');
    expect(screen.getByRole('link', { name: /whitelist of vendors/i }))
      .toHaveAttribute('href', '/whitelist');
    ceo.unmount();

    // UNMOUNTED BETWEEN OFFICES, not merely re-rendered: `screen` queries the
    // whole document, so a second draw leaves the first office's tiles standing
    // beside the second's and every `queryBy` finds the wrong card's link.
    for (const office of ALL_OFFICES.filter((o) => o !== 'ceo')) {
      const view = draw(office);
      expect(screen.queryByRole('link', { name: /whitelist of vendors/i })).toBeNull();
      view.unmount();
    }
  });

  // An office with nothing to offer must render NOTHING — an empty "Quick
  // Actions" card is a heading over a blank, which reads as a failed load.
  it('draws no card at all for an office with no quick action', () => {
    const { container } = draw('security_head');
    expect(container.querySelector('.gb-quick')).toBeNull();
  });
});
