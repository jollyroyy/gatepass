import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

// P1-98..P1-106: /whitelist (src/pages/Approver/WhitelistApprovals.tsx →
// WhitelistRequestsTab). A pending/approved/rejected request is created by an
// Admin flagging a blocked vendor (§15 of the plan: "Admin scope, out of P1").
// This generator covers HOD/Approver only, so the decision-flow cases
// (P1-100..P1-103) that need a live pending request are left unimplemented and
// reported as a data-precondition gap rather than guessed at.
test.describe('Whitelist of Vendors', () => {
  test.use({ storageState: storageStateFor('ceo') });

  test('P1-106 duplicate-heading disambiguation by level', async ({ page, pageLog }) => {
    await page.goto('/whitelist');
    await settled(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Whitelist of Vendors' })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: 'Whitelist of Vendors' })).toHaveCount(1);
    expect(pageLog.errors).toEqual([]);
  });

  test('P1-99 CEO KPI dashboard invariant', async ({ page }) => {
    await page.goto('/whitelist');
    await settled(page);
    const kpis = page.getByTestId('whitelist-kpis');
    for (const title of ['Awaiting CEO Decision', 'Whitelisting Granted', 'Whitelisting Rejected']) {
      await expect(kpis.getByText(title)).toBeVisible();
    }
  });

  test('P1-105a fully-empty state, when no whitelist request has ever been created', async ({ page }) => {
    await page.goto('/whitelist');
    await settled(page);
    const empty = page.locator('.table-wrap.empty-state');
    if (await empty.count()) {
      await expect(empty).toHaveText('No whitelist requests.');
    } else {
      test.info().annotations.push({ type: 'skip-reason', description: 'whitelist requests already exist from a prior run or other spec' });
    }
  });
});

test.describe('Whitelist of Vendors — non-CEO office holders', () => {
  for (const role of ['secHead', 'finHead', 'coo'] as const) {
    test(`P1-98 ${role}: route reachable, decision controls hidden`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: storageStateFor(role) });
      const page = await ctx.newPage();
      await page.goto('/whitelist');
      await settled(page);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText(
        'Only the designated CEO can approve or reject a whitelist request. You can still review them below.',
      )).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit Rejection' })).toHaveCount(0);
      await ctx.close();
    });
  }
});

test.describe('Whitelist decision flow — needs an Admin-created request', () => {
  test.use({ storageState: storageStateFor('ceo') });

  test('P1-100..P1-104 approve/reject/collapse flows', () => {
    test.skip(
      true,
      'requires a pending whitelist request, created by an Admin blocking then ' +
        're-requesting a vendor — out of this P1 (HOD/Approver) generator\'s scope ' +
        'per the plan\'s own data-preconditions table',
    );
  });
});
