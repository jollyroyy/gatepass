import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag } from '../helpers/lifecycle';
import { settled, expectPath, assertKpiOpensItsOwnRows, firstNumber } from '../helpers/ui';

// P1-01..P1-11, P1-13: /dashboard (src/pages/HOD/Dashboard.tsx). One RGP and one
// NRGP are raised once, up front, and every read-only assertion below shares them
// — a raised pass is permanent, so this file creates exactly two.
test.describe.configure({ mode: 'serial' });

test.describe('the HOD dashboard', () => {
  test.use({ storageState: storageStateFor('hod') });

  let rgpNumber = '';
  let nrgpNumber = '';
  const tag = uniqueTag('DASH');

  test('setup: raise one RGP and one NRGP today', async ({ page }) => {
    const rgp = await raisePass(page, { vendor: `Vendor ${tag}` });
    rgpNumber = rgp.passNumber;
    const nrgp = await raisePass(page, { type: 'NRGP', vendor: `Vendor ${tag}` });
    nrgpNumber = nrgp.passNumber;
    expect(rgpNumber).toMatch(/^RGP-/);
    expect(nrgpNumber).toMatch(/^NRGP-/);
  });

  test('P1-01 greeting and date chip render', async ({ page, pageLog }) => {
    await page.goto('/dashboard');
    await settled(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), .+/);
    await expect(page.locator('.gb-stamp')).toBeVisible();
    await expect(page.getByText('Here’s what’s happening with your passes today.')).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('P1-02 KPI figures resolve to non-negative integers', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    for (const name of [/NRGP Issued/, /RGP Issued/, /Pending Return/, 'Overdue']) {
      const card = page.getByRole('link', { name });
      const n = firstNumber(await card.innerText());
      expect(n, `${name} renders a number`).not.toBeNull();
      expect(n as number).toBeGreaterThanOrEqual(0);
    }
  });

  test('P1-03 dashboard invariant: NRGP Issued', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    const card = page.getByRole('link', { name: /NRGP Issued/ });
    await assertKpiOpensItsOwnRows(page, card, async (p) => {
      await expectPath(p, '/dashboard/nrgpIssued');
      return p.locator('[data-testid="pass-stack-card"]').count();
    });
    await expect(page.getByRole('heading', { level: 1, name: 'NRGP raised today' })).toBeVisible();
  });

  test('P1-04 dashboard invariant: RGP Issued', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    const card = page.getByRole('link', { name: /RGP Issued/ });
    await assertKpiOpensItsOwnRows(page, card, async (p) => {
      await expectPath(p, '/dashboard/rgpIssued');
      return p.locator('[data-testid="pass-stack-card"]').count();
    });
    await expect(page.getByRole('heading', { level: 1, name: 'RGP raised today' })).toBeVisible();
  });

  test('P1-05 dashboard invariant: Pending Return', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    const card = page.getByRole('link', { name: /Pending Return/ });
    await assertKpiOpensItsOwnRows(page, card, async (p) => {
      await expectPath(p, '/dashboard/pendingReturn');
      return p.locator('[data-testid="pass-stack-card"]').count();
    });
  });

  test('P1-06 Overdue card navigates to /overdue, not a drill page', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    await page.getByRole('link', { name: 'Overdue' }).click();
    await expectPath(page, '/overdue');
  });

  test('P1-07 "Pending gate approval" desk lines resolve to different routes per type', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    const nrgpCard = page.locator('.gb-kpi').filter({ hasText: 'NRGP Issued' });
    await nrgpCard.getByRole('link', { name: /Pending gate approval/ }).click();
    await expectPath(page, '/dashboard/nrgpPendingGate');

    await page.goto('/dashboard');
    await settled(page);
    const rgpCard = page.locator('.gb-kpi').filter({ hasText: 'RGP Issued' });
    await rgpCard.getByRole('link', { name: /Pending gate approval/ }).click();
    await expectPath(page, '/dashboard/rgpPendingGate');
  });

  test('P1-08 "Pending approval" exact-match desk lines resolve per type', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    const nrgpCard = page.locator('.gb-kpi').filter({ hasText: 'NRGP Issued' });
    await nrgpCard.getByRole('link', { name: 'Pending approval', exact: true }).click();
    await expectPath(page, '/dashboard/nrgpPendingApproval');

    await page.goto('/dashboard');
    await settled(page);
    const rgpCard = page.locator('.gb-kpi').filter({ hasText: 'RGP Issued' });
    await rgpCard.getByRole('link', { name: 'Pending approval', exact: true }).click();
    await expectPath(page, '/dashboard/rgpPendingApproval');
  });

  test('P1-09 Quick Actions: Raise Gate Pass tile navigates to /raise', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    await page.getByRole('link', { name: /Raise Gate Pass/ }).click();
    await expectPath(page, '/raise');
  });

  test('P1-10 Approval Pending strip renders all four slots', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Approval Pending' })).toBeVisible();
    for (const label of ['HOD Approval', 'Security Approval', 'Finance Approval', 'Other Approvers']) {
      const slot = page.locator('.gb-approval').filter({ hasText: label });
      await expect(slot).toBeVisible();
      await expect(slot.getByText('Waiting')).toBeVisible();
    }
  });

  test('P1-11 Department Deletion Request card is absent by default', async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
    await expect(page.getByTestId('dept-delete-requests')).toHaveCount(0);
  });

  test('P1-13 realtime silent refresh: NRGP figure increments with no skeleton flash', async ({ page, as }) => {
    await page.goto('/dashboard');
    await settled(page);
    const card = page.getByRole('link', { name: /NRGP Issued/ });
    const before = firstNumber(await card.innerText()) as number;

    let sawSkeleton = false;
    const watcher = page.locator('.skeleton').first();
    const check = setInterval(async () => {
      if (await watcher.isVisible().catch(() => false)) sawSkeleton = true;
    }, 200);

    const second = await as('hod');
    await raisePass(second.page, { type: 'NRGP', vendor: `Vendor ${tag}` });

    await expect.poll(async () => firstNumber(await card.innerText()), { timeout: 20_000 }).toBe(before + 1);
    clearInterval(check);
    expect(sawSkeleton, 'realtime refresh must not flash a skeleton').toBe(false);
  });
});
