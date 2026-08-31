import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag } from '../helpers/lifecycle';
import { settled, expectPath, firstNumber } from '../helpers/ui';

// P1-62..P1-76: /approvals (src/pages/Approver/PendingApprovals.tsx). Every
// fresh pass raised here lands first at the Security Head rung, so `secHead`
// is the primary actor; `coo`/`ceo` are used only for the fallback-office KPI
// case (P1-65) and the CEO-only Quick Actions link (P1-75).
test.describe.configure({ mode: 'serial' });

test.describe('Pending for My Approval', () => {
  test.use({ storageState: storageStateFor('hod') });

  let approveNumber = '';
  let rejectNumber = '';
  let filterVendorTag = '';

  test('setup: raise passes for approve, reject and filter tests', async ({ page }) => {
    filterVendorTag = uniqueTag('APQ');
    approveNumber = (await raisePass(page, { vendor: `Vendor ${filterVendorTag} A` })).passNumber;
    rejectNumber = (await raisePass(page, { vendor: `Vendor ${filterVendorTag} B` })).passNumber;
  });

  test.describe('as Security Head', () => {
    test.use({ storageState: storageStateFor('secHead') });

    test('P1-63 dashboard invariant: Awaiting Your Approval', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      const card = page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ });
      // "pending" is the page's default open card (PendingApprovals.tsx:102), so it is
      // ALREADY expanded on load — clicking it here would toggle it closed instead
      // (`pickCard` closes the card that is already active). Assert the default state
      // directly rather than clicking into it.
      const n = firstNumber(await card.innerText()) as number;
      await expect(card).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#approval-stack [data-testid="pass-stack-card"]')).toHaveCount(n);
    });

    test('P1-66 approve happy path removes the card and grows Approved by You', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ }).click();
      const card = page.locator('[data-testid="pass-stack-card"]', { hasText: approveNumber });
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Approve' }).click();
      await expect(page.locator('[data-testid="pass-stack-card"]', { hasText: approveNumber })).toHaveCount(0, { timeout: 15_000 });

      await page.goto('/approvals');
      await settled(page);
      const approvedCard = page.getByTestId('approval-kpis').getByRole('button', { name: /Approved by You/ });
      await approvedCard.click();
      await expect(page.locator('[data-testid="pass-stack-card"]', { hasText: approveNumber })).toBeVisible();
    });

    test('P1-68 reject happy path opens the modal and moves the card to Rejected by You', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ }).click();
      const card = page.locator('[data-testid="pass-stack-card"]', { hasText: rejectNumber });
      await card.getByRole('button', { name: 'Reject' }).click();
      const modal = page.getByRole('dialog');
      await expect(modal.getByText(`Pass ID: ${rejectNumber}`)).toBeVisible();
      await modal.getByLabel('Reason for Rejection *').fill('Duplicate request, closing this one.');
      await modal.getByRole('button', { name: 'Submit Rejection' }).click();
      await expect(modal).toBeHidden();
      await expect(page.locator('[data-testid="pass-stack-card"]', { hasText: rejectNumber })).toHaveCount(0, { timeout: 15_000 });

      await page.goto('/approvals');
      await settled(page);
      await page.getByTestId('approval-kpis').getByRole('button', { name: /Rejected by You/ }).click();
      await expect(page.locator('[data-testid="pass-stack-card"]', { hasText: rejectNumber })).toBeVisible();
    });

    test('P1-64 KPI invariant: Approved by You / Rejected by You row counts match their figures', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      for (const name of [/Approved by You/, /Rejected by You/]) {
        const card = page.getByTestId('approval-kpis').getByRole('button', { name });
        const n = firstNumber(await card.innerText()) as number;
        await card.click();
        await expect(page.locator('#approval-stack [data-testid="pass-stack-card"]')).toHaveCount(n);
      }
    });

    test('P1-69 Reject is disabled, not errored, on a blank reason', async ({ page, as }) => {
      const hod = await as('hod');
      const { passNumber } = await raisePass(hod.page, { vendor: `Vendor ${uniqueTag('APQ')} C` });
      await page.goto('/approvals');
      await settled(page);
      await page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ }).click();
      const card = page.locator('[data-testid="pass-stack-card"]', { hasText: passNumber });
      await card.getByRole('button', { name: 'Reject' }).click();
      const modal = page.getByRole('dialog');
      const submit = modal.getByRole('button', { name: 'Submit Rejection' });
      await expect(submit).toBeDisabled();
      await modal.getByLabel('Reason for Rejection *').fill('   ');
      await expect(submit).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    });

    test('P1-71 search narrows all visible KPI counts', async ({ page }) => {
      // A and B (from the shared setup) are both decided by now — raise a fresh
      // pending pair here instead: one that matches the search tag and one that
      // doesn't, so "narrows" is provable (the figure must strictly drop), not
      // just "stays visible".
      const narrowTag = uniqueTag('APQN');
      await raisePass(page, { vendor: `Vendor ${narrowTag} Match` });
      await raisePass(page, { vendor: `Vendor ${uniqueTag('APQX')} NoMatch` });
      await page.goto('/approvals');
      await settled(page);
      const pendingCard = page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ });
      const before = firstNumber(await pendingCard.innerText()) as number;
      await page.getByLabel('Search by Pass ID / Vendor / Purpose').fill(narrowTag);
      await settled(page);
      const after = firstNumber(await pendingCard.innerText()) as number;
      expect(after).toBe(1);
      expect(after).toBeLessThan(before);
    });

    test('P1-72 Pass Type filter narrows to RGP only', async ({ page }) => {
      // An NRGP fixture to prove exclusion against: without one, every card left
      // after filtering to "RGP" trivially contains the substring "RGP" even if
      // it's actually an NRGP card (its own pass number reads "NRGP-...").
      const tag = uniqueTag('APQT');
      const { passNumber: rgpNumber } = await raisePass(page, { vendor: `Vendor ${tag}` });
      const { passNumber: nrgpNumber } = await raisePass(page, { type: 'NRGP', vendor: `Vendor ${tag}` });
      await page.goto('/approvals');
      await settled(page);
      // "pending" is the page's default open card (PendingApprovals.tsx:102) —
      // it starts expanded, so no click is needed (and clicking it here would
      // toggle it closed instead of opening it).
      const stack = page.locator('#approval-stack');
      await page.getByLabel('Search by Pass ID / Vendor / Purpose').fill(tag);
      await settled(page);
      await expect(stack.locator('[data-testid="pass-stack-card"]', { hasText: rgpNumber })).toBeVisible();
      await expect(stack.locator('[data-testid="pass-stack-card"]', { hasText: nrgpNumber })).toBeVisible();

      await page.getByLabel('Pass Type').selectOption({ label: 'RGP' });
      await settled(page);
      await expect(stack.locator('[data-testid="pass-stack-card"]', { hasText: rgpNumber })).toBeVisible();
      await expect(stack.locator('[data-testid="pass-stack-card"]', { hasText: nrgpNumber })).toHaveCount(0);
    });

    test('P1-73 filtered-to-nothing shows the filtered-empty text', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await page.getByLabel('Search by Pass ID / Vendor / Purpose').fill('no-such-vendor-xyz-999');
      await settled(page);
      await expect(page.locator('.gb-empty')).toHaveText('No request matches these filters.');
    });

    test('P1-65 "Nobody Has Approved" is absent for a non-fallback office', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await expect(page.getByTestId('approval-kpis').getByRole('button', { name: /Nobody Has Approved/ })).toHaveCount(0);
    });

    test('P1-76 realtime silent refresh on the queue', async ({ page, as }) => {
      await page.goto('/approvals');
      await settled(page);
      const card = page.getByTestId('approval-kpis').getByRole('button', { name: /Awaiting Your Approval/ });
      const before = firstNumber(await card.innerText()) as number;

      let sawSkeleton = false;
      const watcher = page.locator('.skeleton').first();
      const timer = setInterval(async () => {
        if (await watcher.isVisible().catch(() => false)) sawSkeleton = true;
      }, 200);

      const second = await as('hod');
      await raisePass(second.page, { vendor: `Vendor ${uniqueTag('APQ')} RT` });

      await expect.poll(async () => firstNumber(await card.innerText()), { timeout: 20_000 }).toBe(before + 1);
      clearInterval(timer);
      expect(sawSkeleton).toBe(false);
    });
  });

  test.describe('as COO — fallback office KPI', () => {
    test.use({ storageState: storageStateFor('coo') });

    test('P1-65 "Nobody Has Approved" renders for the COO, disabled when zero', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      const card = page.getByTestId('approval-kpis').getByRole('button', { name: /Nobody Has Approved/ });
      await expect(card).toBeVisible();
    });

    test('P1-75 Quick Actions Whitelist link is absent for the COO', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await expect(page.getByRole('link', { name: 'Whitelist of Vendors' })).toHaveCount(0);
    });
  });

  test.describe('as CEO — Quick Actions', () => {
    test.use({ storageState: storageStateFor('ceo') });

    test('P1-75 Whitelist of Vendors link is present and navigates', async ({ page }) => {
      await page.goto('/approvals');
      await settled(page);
      await page.getByRole('link', { name: 'Whitelist of Vendors' }).click();
      await expectPath(page, '/whitelist');
    });
  });
});
