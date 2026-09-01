import type { Browser } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled, expectPath } from '../helpers/ui';

// P1-30, P1-34, P1-36: /mismatch/:id (src/pages/HOD/MismatchReview.tsx), rewritten for
// migration 070 — a guard's rejection is now FINAL. `hod_review_flagged_pass` is dropped, so
// the two old decisions ("Reject Permanently" and the "Send Back to the Gate" override) are
// both gone; the screen offers exactly one action, "Raise It Again", over a pass that is
// already closed. The old P1-31 (settled-message empty state) and P1-32/P1-33 (Reject
// Permanently happy path / cancel) exercised that dropped RPC and the deleted override, so they
// are deleted rather than weakened — there is nothing left in the UI for them to assert on.
// P1-36 (the expired-review not-found mirror) is included too; the rest of §5 needs a pass
// genuinely past `expires_at`, which per the plan's own landmine cannot be produced through the
// UI or a faked browser clock — flagged as a DB-seed gap, not implemented here.
test.describe.configure({ mode: 'serial' });

/** Walk a pass to `flagged` the same way security would: raised, signed through
 *  the full ladder, then rejected at the gate with a reason. */
async function raiseAndReject(browser: Browser, page: import('@playwright/test').Page): Promise<{ passId: string; passNumber: string }> {
  const { passNumber, passId } = await raisePass(page, { vendor: `Vendor ${uniqueTag('MM')}` });
  await approveThroughLadder(browser, passNumber);

  const guard = await browser.newContext({ storageState: storageStateFor('guard') });
  const gp = await guard.newPage();
  await gp.goto(`/verify/${passId}`);
  await settled(gp);
  await gp.getByRole('button', { name: 'Reject Pass' }).click();
  await gp.getByLabel('Reason for rejecting *').fill('Only part of the declared material is present.');
  await gp.getByRole('button', { name: 'Reject and Cancel Pass' }).click();
  await expect(gp.getByRole('button', { name: 'Reject Pass' })).toHaveCount(0, { timeout: 15_000 });
  await guard.close();

  return { passId, passNumber };
}

test.describe('Mismatch Review — the pass is closed, not decidable', () => {
  test.use({ storageState: storageStateFor('hod') });

  let passId = '';
  let passNumber = '';

  test('setup: raise, sign through the ladder, and reject it at the gate', async ({ page, browser }) => {
    const rejected = await raiseAndReject(browser, page);
    passId = rejected.passId;
    passNumber = rejected.passNumber;
  });

  test('P1-30 not-found state for a random id', async ({ page, pageLog }) => {
    await page.goto('/mismatch/00000000-0000-0000-0000-000000000000');
    await settled(page);
    await expect(page.locator('.empty-state')).toHaveText(
      'That gate pass could not be found, or it is not one you may review.',
    );
    expect(pageLog.errors).toEqual([]);
  });

  test('shows why/who/when, and offers exactly one action — no decision, no override', async ({ page }) => {
    await page.goto(`/mismatch/${passId}`);
    await settled(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Rejected at Security Gate' })).toBeVisible();
    await expect(page.locator('.page-subtitle')).toContainText(passNumber);

    // WHY — the reason the guard wrote.
    await expect(page.getByRole('heading', { name: 'Stopped at the gate' })).toBeVisible();
    await expect(page.getByText('Only part of the declared material is present.')).toBeVisible();
    // WHO and WHEN.
    await expect(page.getByText('Flagged by')).toBeVisible();
    await expect(page.getByText('Flagged at')).toBeVisible();

    // The one thing left to do.
    await expect(page.getByRole('heading', { name: 'This pass is cancelled' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Raise It Again' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View the pass' })).toBeVisible();

    // No decision control survives migration 070: neither the RPC's own confirm
    // button nor the deleted override.
    await expect(page.getByRole('button', { name: 'Reject Permanently' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send Back to the Gate' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Confirm/ })).toHaveCount(0);
  });

  test('P1-34 Raise It Again pre-fills /raise without consuming the rejected pass', async ({ page }) => {
    await page.goto(`/mismatch/${passId}`);
    await settled(page);
    await page.getByRole('button', { name: 'Raise It Again' }).click();
    await expectPath(page, '/raise');
    await expect(page.getByRole('heading', { name: /Issue RGP \/ NRGP Gate Pass Again/ })).toBeVisible();
    await expect(page.getByText(new RegExp(`^Correcting ${passNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible();
    await expect.poll(async () => (await page.locator('#rp-vendor').inputValue()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('the rejected pass is still readable afterwards — the review screen never re-checks decidability', async ({ page }) => {
    // There is no settled/idle split any more (that belonged to the dropped
    // RPC's decision flow) — reloading the same page shows the same one action.
    await page.goto(`/mismatch/${passId}`);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'This pass is cancelled' })).toBeVisible();
    await page.getByRole('link', { name: 'View the pass' }).click();
    await expectPath(page, `/pass/${passId}`);
  });
});

test.describe('Expired Review — reachable cases only', () => {
  test.use({ storageState: storageStateFor('hod') });

  test('P1-36 not-found state for a random id', async ({ page, pageLog }) => {
    await page.goto('/expired/00000000-0000-0000-0000-000000000000');
    await settled(page);
    await expect(page.locator('.empty-state')).toHaveText(
      'That gate pass could not be found, or it is not one you may review.',
    );
    expect(pageLog.errors).toEqual([]);
  });

  test('the rest of §5 needs a pass genuinely past expires_at — DB-seed gap', () => {
    test.skip(true, 'requires a pass past expires_at; cannot be produced via UI or a faked browser clock per the plan');
  });
});
