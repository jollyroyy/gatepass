import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled } from '../helpers/ui';

/**
 * P2 §2.12, §4, §6 "Verify flow" — the Reject half. One RGP, rejected once: a
 * rejection is FINAL since migration 070 (`hod_review_flagged_pass` is dropped,
 * so nothing moves the pass afterwards) and not reversible through the UI, so
 * the happy path (P2-54) is the last test in the file and everything before it
 * reuses the same pass while it is still `pending`.
 *
 * Wording updated for the client's 2026-08-31 instruction: the guard's second
 * button reads "Reject Pass" (was "Flag to Requester"), the modal is headed
 * "Reject Gate Pass", its field is "Reason for rejecting *", and its confirm
 * button is "Reject and Cancel Pass" (was "Send to Requester").
 */
test.describe.configure({ mode: 'serial' });

test.describe('Verify — Reject Pass', () => {
  test.use({ storageState: storageStateFor('guard') });

  let passNumber = '';
  let passId = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const raised = await raisePass(hodPage, { type: 'RGP', vendor: `Flag Test ${uniqueTag('V')}` });
    await hod.close();
    passNumber = raised.passNumber;
    passId = raised.passId;
    await approveThroughLadder(browser, passNumber);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`/verify/${passId}`);
    await settled(page);
    await page.getByRole('button', { name: 'Reject Pass' }).click();
    await expect(page.getByRole('heading', { name: 'Reject Gate Pass' })).toBeVisible();
  });

  test('an empty or whitespace-only reason keeps the confirm button disabled (P2-53)', async ({ page }) => {
    const confirm = page.getByRole('button', { name: 'Reject and Cancel Pass' });
    await expect(confirm).toBeDisabled();
    await page.locator('#gate-flag-reason').fill('   ');
    await expect(confirm).toBeDisabled();
    await page.locator('#gate-flag-reason').fill('Only 1 of 2 drills present.');
    await expect(confirm).toBeEnabled();
  });

  test('the reason textarea caps at 500 characters (P2-55)', async ({ page }) => {
    await page.locator('#gate-flag-reason').fill('x'.repeat(550));
    await expect(page.locator('#gate-flag-reason')).toHaveValue('x'.repeat(500));
    await expect(page.getByText('500/500')).toBeVisible();
  });

  test('Cancel closes the modal without rejecting the pass', async ({ page }) => {
    await page.locator('#gate-flag-reason').fill('Only 1 of 2 drills present.');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Reject Gate Pass' })).toBeHidden();
    // Still decidable — Reject Pass survived the cancelled confirm.
    await expect(page.getByRole('button', { name: 'Reject Pass' })).toBeVisible();
  });

  test('Reject happy path redirects to /console with the exact flash text, and the rejection is final (P2-54)', async ({ page, pageLog }) => {
    await page.locator('#gate-flag-reason').fill('Only 1 of 2 drills present.');
    await page.getByRole('button', { name: 'Reject and Cancel Pass' }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/console');
    await expect(page.locator('.alert-success')).toHaveText(
      `${passNumber} rejected and cancelled — the raising department has been notified.`
    );
    expect(pageLog.errors).toEqual([]);

    // FINAL: revisiting the same pass at the gate offers no route back to a
    // decision — no Approve, no Reject Pass, just the "already rejected" read.
    await page.goto(`/verify/${passId}`);
    await settled(page);
    await expect(page.getByText('This pass was already')).toBeVisible();
    await expect(page.getByText('rejected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject Pass' })).toHaveCount(0);
  });
});
