import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled } from '../helpers/ui';

/**
 * P2 §2.12, §4, §6 "Verify flow" — the Approve half. One RGP carries all
 * three cases in sequence (serial mode): the disabled-button check only
 * opens the panel and Cancels, so the same pass is still `pending` for the
 * happy path, which then leaves it `matched` for the already-actioned check.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Verify — Approve', () => {
  test.use({ storageState: storageStateFor('guard') });

  let passA = '', passAId = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const a = await raisePass(hodPage, { type: 'RGP', vendor: `Verify A ${uniqueTag('V')}` });
    await hod.close();
    passA = a.passNumber; passAId = a.passId;
    await approveThroughLadder(browser, passA);
  });

  test('Confirm Approval is disabled when a Counted quantity is <= 0 (P2-51)', async ({ page }) => {
    await page.goto(`/verify/${passAId}`);
    await settled(page);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const counted = page.locator('table').getByRole('spinbutton').first();
    await counted.fill('0');
    await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeDisabled();
    await counted.fill('2');
    await expect(page.getByRole('button', { name: 'Confirm Approval' })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Approve happy path redirects to /console with the exact flash text (P2-50)', async ({ page, pageLog }) => {
    await page.goto(`/verify/${passAId}`);
    await settled(page);
    await expect(page.getByRole('heading', { name: passA })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approve Gate Pass' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Approval' }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/console');
    await expect(page.locator('.alert-success')).toHaveText(`${passA} approved — cleared to proceed.`);
    expect(pageLog.errors).toEqual([]);
  });

  test('an already-actioned pass shows the read-only banner and no decision buttons (P2-56)', async ({ page }) => {
    await page.goto(`/verify/${passAId}`);
    await settled(page);
    await expect(page.getByText(/already.*approved.*by/s)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Flag to Requester' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View full details' })).toHaveAttribute('href', `/pass/${passAId}`);
  });
});
