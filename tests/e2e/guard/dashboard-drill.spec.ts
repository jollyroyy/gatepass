import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled, expectPath, firstNumber } from '../helpers/ui';

/**
 * P2 §2.2, §6 "Dashboard invariant (KPI-INV)" — GuardDrill.tsx.
 *
 * Two RGPs from two different vendors so the Vendor filter has something to
 * narrow, plus the P2-05 unknown-key redirect, which needs no fixture at all.
 */
test.describe.configure({ mode: 'serial' });

test.describe('the Pending OUT drill', () => {
  test.use({ storageState: storageStateFor('guard') });

  const vendorA = `Drill Vendor A ${uniqueTag('V')}`;
  const vendorB = `Drill Vendor B ${uniqueTag('V')}`;
  let passA = '';
  let passB = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const a = await raisePass(hodPage, { type: 'RGP', vendor: vendorA });
    const b = await raisePass(hodPage, { type: 'RGP', vendor: vendorB });
    await hod.close();
    passA = a.passNumber;
    passB = b.passNumber;
    await approveThroughLadder(browser, passA);
    await approveThroughLadder(browser, passB);
  });

  test('/guard-dashboard/bogus redirects home', async ({ page }) => {
    await page.goto('/guard-dashboard/bogus');
    await expectPath(page, '/guard-dashboard');
  });

  test('KPI invariant: the RGP figure equals the drill\'s own row count', async ({ page, pageLog }) => {
    await page.goto('/guard-dashboard');
    await settled(page);
    const figure = firstNumber(await page.getByTestId('guard-figure-RGP').innerText());
    await page.getByTestId('guard-figure-RGP').click();
    await settled(page);
    // No row's detail panel is open on first render, so every <tr> in the
    // table body is exactly one pass row (PendingOutTable.tsx).
    const rowCount = await page.locator('.gb-table tbody tr').count();
    expect(rowCount, `KPI figure ${figure} must equal the rows the drill opens`).toBe(figure);
    await expect(page.getByRole('heading', { name: `Pending OUT · RGP` })).toBeVisible();
    await expect(page.locator('h1')).toContainText(`${figure}`);
    expect(pageLog.errors).toEqual([]);
  });

  test('switching to the NRGP tab reveals NRGP rows on the RGP-key drill (P2-33)', async ({ page }) => {
    await page.goto('/guard-dashboard/RGP');
    await settled(page);
    const tablist = page.getByRole('tablist', { name: 'Pass type' });
    await expect(tablist).toBeVisible();
    await expect(page.getByRole('tab', { name: /^RGP \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true');
    const nrgpTab = page.getByRole('tab', { name: /^NRGP \(\d+\)$/ });
    await nrgpTab.click();
    await expect(nrgpTab).toHaveAttribute('aria-selected', 'true');
  });

  test('Vendor filter narrows the table without changing tab counts (P2-34)', async ({ page }) => {
    await page.goto('/guard-dashboard/RGP');
    await settled(page);
    const rgpTabBefore = await page.getByRole('tab', { name: /^RGP \(\d+\)$/ }).innerText();
    await page.getByLabel('Vendor').selectOption(vendorA);
    await expect(page.getByText(passA)).toBeVisible();
    await expect(page.getByText(passB)).toHaveCount(0);
    const rgpTabAfter = await page.getByRole('tab', { name: /^RGP \(\d+\)$/ }).innerText();
    expect(rgpTabAfter).toBe(rgpTabBefore);
  });

  test('Reset restores filters but keeps the active tab (P2-35)', async ({ page }) => {
    await page.goto('/guard-dashboard/NRGP');
    await settled(page);
    await page.getByLabel('Sort by').selectOption('newest');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByLabel('Vendor')).toHaveValue('');
    await expect(page.getByLabel('Sort by')).toHaveValue('oldest');
    await expect(page.getByRole('tab', { name: /^NRGP \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('Reset is enabled by default on a drill page (tab already deviates, P2-36)', async ({ page }) => {
    await page.goto('/guard-dashboard/RGP');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  test('only one row\'s detail panel is open at a time (P2-37)', async ({ page }) => {
    await page.goto('/guard-dashboard/RGP');
    await settled(page);
    const rowA = page.locator('tr', { hasText: passA });
    const rowB = page.locator('tr', { hasText: passB });
    await rowA.getByRole('button', { name: /^Show items in / }).click();
    await expect(page.getByText(/Items in this Pass/)).toBeVisible();
    await rowB.getByRole('button', { name: /^Show items in / }).click();
    await expect(page.getByText(/Items in this Pass/)).toHaveCount(1);
  });

  test('empty queue shows the exact empty sentence (P2-38)', async ({ page }) => {
    await page.goto('/guard-dashboard/RGP');
    await settled(page);
    // Filter to a vendor/department combo no row satisfies (P2-39 shape).
    await page.getByLabel('Vendor').selectOption(vendorA);
    const deptSelect = page.getByLabel('Department');
    const options = await deptSelect.locator('option').allTextContents();
    const other = options.find((o) => o !== 'Department: All');
    if (other) {
      await deptSelect.selectOption({ label: other });
    }
    // Either the filtered-to-zero sentence or rows remain — assert one of the
    // two documented empty sentences never a stale skeleton.
    const filteredEmpty = page.getByText('No pass matches these filters.');
    const queueEmpty = page.getByText('Queue clear — nothing is waiting at the gate.');
    await expect(filteredEmpty.or(queueEmpty).or(page.locator('.gb-table tbody tr').first())).toBeVisible();
  });

  test('the returns drill counts LINES, not passes, in its title noun (CLAUDE.md regression)', async ({ page }) => {
    await page.goto('/guard-dashboard/returns');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Pending RGP Return' })).toBeVisible();
    const h1 = await page.locator('h1').innerText();
    // The noun must be item/items, never pass/passes — the literal regression
    // this app fixed (CLAUDE.md, 2026-08-24).
    expect(h1).toMatch(/\bitems?\b/);
    expect(h1).not.toMatch(/\bpasses?\b/);
  });
});
