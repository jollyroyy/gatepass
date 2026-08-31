import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled, expectPath } from '../helpers/ui';

/**
 * P2 §2.1, §6 "Dashboard invariant" — GuardDashboard.tsx.
 *
 * One RGP and one NRGP, raised and pushed through the approval ladder so both
 * sit in the guard's Pending OUT queue. Shared across every test in this file.
 */
test.describe.configure({ mode: 'serial' });

test.describe('the guard dashboard', () => {
  test.use({ storageState: storageStateFor('guard') });

  let rgpNumber = '';
  let nrgpNumber = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const rgp = await raisePass(hodPage, { type: 'RGP', vendor: `GuardDash RGP ${uniqueTag('V')}` });
    const nrgp = await raisePass(hodPage, { type: 'NRGP', vendor: `GuardDash NRGP ${uniqueTag('V')}` });
    await hod.close();
    rgpNumber = rgp.passNumber;
    nrgpNumber = nrgp.passNumber;
    await approveThroughLadder(browser, rgpNumber);
    await approveThroughLadder(browser, nrgpNumber);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/guard-dashboard');
    await settled(page);
  });

  test('greets the signed-in guard and states the two jobs', async ({ page, pageLog }) => {
    await expect(page.getByRole('heading', { name: /^Hello, / })).toBeVisible();
    await expect(
      page.getByText('Approve OUT for materials leaving and verify returns for RGP.')
    ).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('search input and Scan QR are present', async ({ page }) => {
    await expect(
      page.getByPlaceholder('Search by Pass No., Name, Vendor, Mobile No., Order No., Make / Model…')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan QR' })).toBeVisible();
  });

  test('summary cards and quick actions render with the two static headings', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pending OUT (Needs Approval)' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pending RGP Return (Needs Verification)' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Scan QR \/ Pass No\./ })).toHaveAttribute('href', '/console');
    await expect(page.getByRole('link', { name: /Overdue Returns/ })).toHaveAttribute('href', '/overdue');
  });

  test('the RGP figure is a link to its own drill and includes the raised pass', async ({ page }) => {
    const figure = page.getByTestId('guard-figure-RGP');
    await expect(figure).toBeVisible();
    await expect(figure).toHaveAttribute('href', '/guard-dashboard/RGP');
    await figure.click();
    await expectPath(page, '/guard-dashboard/RGP');
    await settled(page);
    await expect(page.getByRole('heading', { name: /Pending OUT · RGP/ })).toBeVisible();
    await expect(page.getByText(rgpNumber)).toBeVisible();
  });

  test('the NRGP figure opens the NRGP drill and includes the raised pass', async ({ page }) => {
    const figure = page.getByTestId('guard-figure-NRGP');
    await expect(figure).toHaveAttribute('href', '/guard-dashboard/NRGP');
    await figure.click();
    await expectPath(page, '/guard-dashboard/NRGP');
    await settled(page);
    await expect(page.getByRole('heading', { name: /Pending OUT · NRGP/ })).toBeVisible();
    await expect(page.getByText(nrgpNumber)).toBeVisible();
  });

  test('the Pending RGP Return figure links to /guard-dashboard/returns', async ({ page }) => {
    const figure = page.getByTestId('guard-figure-Due back');
    await expect(figure).toBeVisible();
    await expect(figure).toHaveAttribute('href', '/guard-dashboard/returns');
  });

  test('a single free-text match on the dashboard search bar NAVIGATES to /pass/:id', async ({ page }) => {
    // Distinct from /console, which renders the record in place (P2-30/31).
    await page.getByPlaceholder('Search by Pass No., Name, Vendor, Mobile No., Order No., Make / Model…').fill(rgpNumber);
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toMatch(/^\/pass\//);
  });
});
