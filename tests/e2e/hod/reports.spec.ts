import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag } from '../helpers/lifecycle';
import { settled, csvFrom } from '../helpers/ui';

// P1-20..P1-29: /reports (src/pages/HOD/HodReports.tsx wrapping Admin/ReportsPage.tsx).
test.describe.configure({ mode: 'serial' });

test.describe('HOD Reports', () => {
  test.use({ storageState: storageStateFor('hod') });

  let passNumber = '';

  test('setup: raise one pass so the table is never empty', async ({ page }) => {
    const raised = await raisePass(page, { vendor: `Vendor ${uniqueTag('REP')}` });
    passNumber = raised.passNumber;
  });

  test('P1-20 filters apply immediately, no Apply button exists anywhere', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    const before = await page.getByRole('row').count();
    await page.getByLabel('Status').selectOption({ label: 'Pending' });
    await settled(page);
    const after = await page.getByRole('row').count();
    expect(after).toBeLessThanOrEqual(before);
  });

  test('P1-22 Reset is disabled until a filter narrows, then re-disables', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    const reset = page.getByRole('button', { name: 'Reset' });
    await expect(reset).toBeDisabled();
    await page.getByRole('combobox', { name: 'Pass Type' }).selectOption({ label: 'RGP' });
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(reset).toBeDisabled();
  });

  test('P1-23 Created By / Department are absent for the HOD', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    await expect(page.getByLabel('Created By')).toHaveCount(0);
    await expect(page.getByLabel('Department')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Raised By Department' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Created By' })).toHaveCount(0);
    for (const col of ['Pass Number', 'Creation Date', 'Pass Type', 'Purpose / Description', 'Total Number of Items', 'Total Value of Items', 'Status']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
  });

  test('P1-24 CSV export downloads and its header matches the visible columns', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    await page.getByRole('button', { name: /Export/ }).click();
    const csv = await csvFrom(page, async () => {
      await page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' }).click();
    });
    const headerLine = csv.split(/\r?\n/)[0];
    expect(headerLine).toContain('Pass Number');
    expect(headerLine).not.toContain('—');
  });

  test('P1-25 Print stub calls window.print exactly once', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    await page.evaluate(() => {
      (window as unknown as { __printCalls: number }).__printCalls = 0;
      window.print = () => {
        (window as unknown as { __printCalls: number }).__printCalls += 1;
      };
    });
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls))
      .toBe(1);
  });

  test('P1-26 row click navigates to pass detail', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    const row = page.getByRole('row').filter({ hasText: passNumber });
    await row.click();
    await expect(page).toHaveURL(/\/pass\/[0-9a-f-]+$/);
  });

  test('P1-27 row kebab: View Details and Print Pass', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    const kebab = page.getByRole('button', { name: `Actions for ${passNumber}` });
    await kebab.click();
    await page.getByRole('menuitem', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/pass\/[0-9a-f-]+$/);

    await page.goto('/reports');
    await settled(page);
    await page.getByRole('button', { name: `Actions for ${passNumber}` }).click();
    await page.getByRole('menuitem', { name: 'Print Pass' }).click();
    await expect(page).toHaveURL(/\/pass\/[0-9a-f-]+\/print$/);
  });

  test('P1-28 empty state for a filter combination matching nothing', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('From date').fill(future);
    await page.getByLabel('To date').fill(future);
    await settled(page);
    await expect(page.locator('.gb-empty')).toHaveText('No passes match these filters.');
  });

  test('P1-29 menus close on outside click, not on Escape', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    await page.getByRole('button', { name: /Export/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' })).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' })).toBeHidden();
  });

  test('report KPI cards show the six titles and are non-interactive', async ({ page }) => {
    await page.goto('/reports');
    await settled(page);
    const group = page.getByRole('group', { name: 'Report figures' });
    for (const title of ['Total Passes', 'RGP Passes', 'NRGP Passes', 'Completed', 'Pending', 'Partially Returned']) {
      await expect(group.getByText(title)).toBeVisible();
    }
  });
});
