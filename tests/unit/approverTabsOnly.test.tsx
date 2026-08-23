// AN APPROVAL OFFICE IS THE WHOLE OF WHAT ITS HOLDER DOES HERE.
//
// Client, 2026-08-22: "all those approvers (COO, CEO, security, and the other
// financial one) should not have any option to raise a gate pass or to see the
// status. They can only see their own approval, pending approval … and
// delegation … I do see that the security head is able to do all the returns.
// This is a flag flag completely so please remove all the tabs. Only keep my
// approvals and the delegation. Pending for my approval. Put it like that."
//
// Two surfaces have to agree, and they are in different files:
//   1. the SIDEBAR must offer nothing but those two tabs, because a tab the
//      route guard would bounce reads as a dead button;
//   2. the PASS RECORD must draw no gate control, because it stays reachable
//      from the approver's own queue whatever the sidebar says. That second one
//      is the client's flag: migration 043 lets the Security Head be a `guard`
//      account, so this record was handing them Approve OUT and the
//      line-by-line return entry on the very passes they sign.
//
// `roleRoutes.test.ts` holds the third — that `isForbidden` refuses the paths.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../src/types';
import Sidebar, { APPROVER_LINK, DELEGATION_LINK } from '../../src/components/layout/Sidebar';
import { canRecordReturns } from '../../src/lib/approvalLadder';

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut: () => Promise.resolve({ error: null }) } },
}));
vi.mock('../../src/lib/profiles', () => ({
  fetchDisplayName: () => Promise.resolve('A Person'),
  fetchMyProfile: () => Promise.resolve({ full_name: 'A Person', avatar_url: null }),
}));

function tabs(role: UserRole, isApprover: boolean): string[] {
  const { container, unmount } = render(
    <MemoryRouter>
      <Sidebar
        session={{ user: { id: 'u1', email: 'a@b.c' } } as unknown as Session}
        role={role}
        isApprover={isApprover}
      />
    </MemoryRouter>,
  );
  const rail = container.querySelector('aside') as HTMLElement;
  // `.sidebar-link` is the nav list alone — the brand lockup at the top and the
  // profile block at the foot are anchors too, and neither is a tab.
  const out = [...rail.querySelectorAll('a.sidebar-link')].map((a) => a.textContent?.trim() ?? '');
  unmount();
  return out;
}

describe('an office holder`s sidebar is two tabs and nothing else', () => {
  it('the tab is called "Pending for My Approval"', () => {
    expect(APPROVER_LINK.label).toBe('Pending for My Approval');
    expect(DELEGATION_LINK.label).toBe('Delegation');
  });

  it.each(['staff', 'guard', 'hod'] as const)(
    'a %s who holds an office sees only those two',
    (role) => {
      expect(tabs(role, true)).toEqual(['Pending for My Approval', 'Delegation']);
    },
  );

  it('a guard who holds an office keeps NO gate tab — not the returns, not the queue', () => {
    const shown = tabs('guard', true);
    for (const gone of ['Dashboard']) {
      expect(shown, gone).not.toContain(gone);
    }
  });

  it('an HOD who holds an office is offered no way to raise or read a pass', () => {
    const shown = tabs('hod', true);
    for (const gone of ['Dashboard', 'My Passes', 'Reports']) {
      expect(shown, gone).not.toContain(gone);
    }
  });

  it('a guard who holds NO office is untouched', () => {
    const shown = tabs('guard', false);
    // The two queues are not tabs any more (client, 2026-08-22) — they open on
    // the dashboard when their figure is pressed — so the gate tab a guard
    // still has is the one that survived.
    expect(shown).toContain('Dashboard');
    // Overdue Items stopped being a tab for every role on 2026-08-23 — the
    // board's own quick action opens `/overdue`.
    expect(shown).not.toContain('Overdue Items');
    expect(shown).not.toContain('Pending for My Approval');
  });

  it('an admin who holds an office keeps their own tabs and gains the two', () => {
    // A designation must never lock an admin out of the one screen that can
    // undo it — see `officeReplacesRole` in roleRoutes.ts.
    const shown = tabs('admin', true);
    expect(shown).toContain('Settings');
    expect(shown).toContain('Pending for My Approval');
    expect(shown).toContain('Delegation');
  });
});

describe('the pass record offers an office holder no gate control', () => {
  it('canRecordReturns is false once the reader is read as an office holder', () => {
    // PassRecordView computes `readerRole = office ? null : role` and passes
    // THAT to every action rule, which is what this restates: the guard skin of
    // the record survives only for somebody who is a guard and nothing else.
    const pass = { return_status: 'awaiting_return' } as never;
    expect(canRecordReturns(pass, 'guard')).toBe(true);
    expect(canRecordReturns(pass, null)).toBe(false);
  });

  it('PassRecordView reads its action rules through `readerRole`, never `role`', () => {
    const src = readFileSync(resolve(__dirname, '../../src/components/passview/PassRecordView.tsx'), 'utf8');
    expect(src).toContain('const readerRole = office ? null : role;');
    expect(src).toContain('canRecordReturns(pass, readerRole)');
    expect(src).toContain("readerRole === 'guard' && canVerifyAtGate(pass)");
    // The raising side's WhatsApp forward is the same question from the other
    // end: an approver does not forward a pass they did not raise.
    expect(src).toContain("readerRole === 'hod'");
  });
});

describe('the queue page names itself the way the client asked', () => {
  it('renders "Pending for My Approval" as its title', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/Approver/PendingApprovals.tsx'), 'utf8');
    expect(src).toContain('title="Pending for My Approval"');
    expect(src).not.toContain('title="Pending Approvals"');
  });
});
