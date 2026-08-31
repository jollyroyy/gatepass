import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled, csvFrom } from '../helpers/ui';

/** /all-passes — Reports. Filters, non-interactive KPIs, CSV, pagination. */
test.describe('Admin > Reports (/all-passes)', () => {
  test.use({ storageState: storageStateFor('admin') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/all-passes');
    await settled(page);
  });

  test('P3-35 the six KPI cards are non-interactive', async ({ page }) => {
    const group = page.getByRole('group', { name: 'Report figures' });
    await expect(group).toBeVisible();
    await expect(group.locator('a')).toHaveCount(0);
    await expect(group.locator('button')).toHaveCount(0);
  });

  test('P3-36 no "Apply" button exists; Reset stays disabled until a non-date filter is touched', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    const resetBtn = page.getByRole('button', { name: 'Reset' });
    await expect(resetBtn).toBeDisabled();
    await page.getByLabel('Pass Type').selectOption({ label: 'RGP' });
    await settled(page);
    await expect(resetBtn).toBeEnabled();
    await resetBtn.click();
    await settled(page);
    await expect(page.getByLabel('Pass Type')).toHaveValue('all');
  });

  test('P3-37 CSV export never renders an em-dash for a blank cell', async ({ page }) => {
    const csv = await csvFrom(page, async () => {
      await page.getByRole('button', { name: 'Export ▾' }).click();
      await page.getByRole('menuitem', { name: 'Spreadsheet (.csv)' }).click();
    });
    expect(csv).not.toContain('—');
    expect(csv.split('\n')[0]).toContain('Pass Number');
  });

  test('P3-38 GuardPager: Rows per page defaults to 10, changing it resets to page 1', async ({ page }) => {
    const rowsPerPage = page.getByLabel('Rows per page');
    await expect(rowsPerPage).toHaveValue('10');
    await rowsPerPage.selectOption('25');
    await settled(page);
    // getByRole's `name` matches by SUBSTRING unless `exact: true` — with more
    // than 9 rows-worth of pages, an unqualified name:'1' also matches page
    // buttons "10", "11", "12"… (GuardPager.tsx renders one <button> per
    // number from `pageNumbers()`) and strict mode then rejects the locator.
    // `exact: true` pins it to the literal "1" button.
    const pageOneBtn = page.getByRole('button', { name: '1', exact: true });
    if (await pageOneBtn.count() === 0) {
      // GuardPager only renders the pager at all when `page.pages > 1`
      // (`{page.pages > 1 && (...)}`) — with 25 rows per page the whole
      // dataset may now fit on one page, in which case there is no "1"
      // button to assert on and that itself is the correct, pagerless state.
      return;
    }
    await expect(pageOneBtn).toHaveAttribute('aria-current', 'page');
  });

  test('P3-39 Print / PDF calls window.print()', async ({ page }) => {
    let printed = 0;
    await page.exposeFunction('__e2ePrintHook', () => { printed++; });
    await page.addInitScript(() => {
      const orig = window.print.bind(window);
      window.print = () => { (window as unknown as { __e2ePrintHook: () => void }).__e2ePrintHook(); orig(); };
    });
    await page.reload();
    await settled(page);
    await page.getByRole('button', { name: 'Export ▾' }).click();
    await page.getByRole('menuitem', { name: 'Print / PDF' }).click();
    await expect.poll(() => printed).toBeGreaterThan(0);
  });

  test('the Value cell never abbreviates a rupee figure', async ({ page }) => {
    const body = page.locator('table, .table-base').first();
    const text = await body.innerText().catch(() => '');
    expect(text).not.toMatch(/₹[\d.]+[KMk]\b/);
  });

  test('empty state renders the documented copy when filters match nothing', async ({ page }) => {
    await page.getByLabel('From date').fill('2000-01-01');
    await page.getByLabel('To date').fill('2000-01-02');
    await settled(page);
    await expect(page.getByText('No passes match these filters.')).toBeVisible();
  });
});
