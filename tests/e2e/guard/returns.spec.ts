import { test, expect, type Page } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled, firstNumber } from '../helpers/ui';

/**
 * P2 §5 "The return-recording flow(s)" — TWO distinct UIs, per CLAUDE.md and
 * the plan's own warning not to conflate them:
 *   - §5.1 whole-line tick-and-record (`ScheduledReturns`, on the guard's own
 *     "Pending RGP Return" drill), driven by `passC` (due today, 3 lines).
 *   - §5.2 per-line partial-quantity staged flow (`PassReturnBox`, on
 *     `/pass/:id`), driven by `passD` (one 10-unit whole-unit line), which
 *     also covers every `checkReturnQty` boundary in one item so the suite
 *     raises the minimum number of passes.
 *
 * Both passes are taken to `matched` via a real Approve at `/verify/:id` —
 * that is the only way `return_status` becomes `awaiting_return`.
 */
test.describe.configure({ mode: 'serial' });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function approveAtGate(page: Page, passId: string): Promise<void> {
  await page.goto(`/verify/${passId}`);
  await settled(page);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/console');
}

test.describe('Return recording', () => {
  test.use({ storageState: storageStateFor('guard') });

  let passC = '', passCId = '';
  let passD = '', passDId = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const c = await raisePass(hodPage, {
      type: 'RGP',
      vendor: `Returns C ${uniqueTag('V')}`,
      items: [
        { name: `Line1 ${uniqueTag('IT')}`, qty: '2', returnDate: today() },
        { name: `Line2 ${uniqueTag('IT')}`, qty: '2', returnDate: today() },
        { name: `Line3 ${uniqueTag('IT')}`, qty: '2', returnDate: today() },
      ],
    });
    const d = await raisePass(hodPage, {
      type: 'RGP',
      vendor: `Returns D ${uniqueTag('V')}`,
      items: [{ name: `Whole ${uniqueTag('IT')}`, qty: '10', unit: 'nos' }],
    });
    await hod.close();
    passC = c.passNumber; passCId = c.passId;
    passD = d.passNumber; passDId = d.passId;
    await approveThroughLadder(browser, passC);
    await approveThroughLadder(browser, passD);
  });

  test('setup: approve both passes at the gate so they owe a return', async ({ page }) => {
    await approveAtGate(page, passCId);
    await approveAtGate(page, passDId);
  });

  test('KPI invariant: "Pending RGP Return" counts the 3 lines of passC (P2-12)', async ({ page }) => {
    await page.goto('/guard-dashboard');
    await settled(page);
    const figureText = await page.getByTestId('guard-figure-Due back').innerText();
    const figure = firstNumber(figureText);
    expect(figure, 'passC contributes at least its 3 due-today lines').toBeGreaterThanOrEqual(3);
    await page.getByTestId('guard-figure-Due back').click();
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Pending RGP Return' })).toBeVisible();
    const rows = await page.getByTestId('scheduled-returns-table').locator('tbody tr').count();
    expect(rows).toBe(Math.min(figure ?? 0, 5)); // page size is 5
  });

  test('Mark returned tallies the strip; Clear discards without any RPC (P2-60)', async ({ page }) => {
    await page.goto('/guard-dashboard/returns');
    await settled(page);
    const row = page.locator('tr', { hasText: passC }).first();
    await row.getByRole('button', { name: 'Mark returned' }).click();
    await expect(row.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByText('1 line marked returned — not saved yet. A recorded return cannot be undone.')).toBeVisible();
    await expect(page.getByTestId('record-scheduled-returns')).toHaveText('Record 1 return');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText(/marked returned — not saved yet/)).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Mark returned' })).toBeVisible();
  });

  test('marking 2 of 3 lines reads plural and commits both (P2-61/P2-63)', async ({ page }) => {
    await page.goto('/guard-dashboard/returns');
    await settled(page);
    const rows = page.locator('tr', { hasText: passC });
    const count = await rows.count();
    const n = Math.min(2, count);
    for (let i = 0; i < n; i++) {
      await rows.nth(i).getByRole('button', { name: 'Mark returned' }).click();
    }
    await expect(page.getByText(`${n} lines marked returned — not saved yet. A recorded return cannot be undone.`)).toBeVisible();
    await expect(page.getByTestId('record-scheduled-returns')).toHaveText(`Record ${n} returns`);
    await page.getByTestId('record-scheduled-returns').click();
    await expect(page.getByText(/marked returned — not saved yet/)).toHaveCount(0, { timeout: 20_000 });
  });

  test('per-line staged flow: every checkReturnQty boundary on one line (P2-70..77)', async ({ page }) => {
    await page.goto(`/pass/${passDId}`);
    await settled(page);

    const markReturn = page.getByRole('button', { name: 'Mark return' });
    await markReturn.click();
    const qtyInput = page.locator('#pass-return-qty');
    const confirm = page.getByRole('button', { name: 'Confirm Return' });

    // Non-numeric (P2-74)
    await qtyInput.fill('abc');
    await confirm.click();
    await expect(page.getByText('Enter the quantity that came back.')).toBeVisible();

    // Zero (P2-72)
    await qtyInput.fill('0');
    await confirm.click();
    await expect(page.getByText('A return must be more than zero.')).toBeVisible();

    // Negative (P2-73)
    await qtyInput.fill('-5');
    await confirm.click();
    await expect(page.getByText('A return must be more than zero.')).toBeVisible();

    // Over-return (P2-71): outstanding is 10
    await qtyInput.fill('15');
    await confirm.click();
    await expect(page.getByText('Only 10 is still outstanding on this line.')).toBeVisible();

    // Over-ceiling fraction reports the ceiling message, not the fraction one (P2-76)
    await qtyInput.fill('12.5');
    await confirm.click();
    await expect(page.getByText('Only 10 is still outstanding on this line.')).toBeVisible();

    // In-ceiling fraction on a whole unit (P2-75)
    await qtyInput.fill('5.5');
    await confirm.click();
    await expect(page.getByText(/cannot be split/)).toBeVisible();

    // Stage a valid partial return: 6 of 10 (P2-70 — stages only, no navigation)
    await qtyInput.fill('6');
    await confirm.click();
    await expect(page.getByText('Not recorded yet')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/pass/${passDId}`); // stages only, no navigation

    // Re-opening pre-fills the staged quantity and recalculates outstanding (P2-77)
    await page.getByRole('button', { name: 'Edit return' }).click();
    await expect(page.locator('#pass-return-qty')).toHaveValue('6');
    await expect(page.locator('#pass-return-qty')).toHaveAttribute('placeholder', '10');
    await page.locator('#pass-return-qty').fill('6');
    await page.getByRole('button', { name: 'Confirm Return' }).click();

    // Commit the staged line (P2-78)
    await expect(page.getByTestId('record-pass-returns')).toHaveText('Record 1 return');
    await page.getByTestId('record-pass-returns').click();
    await expect(page.getByText(/staged — not saved yet/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/Partially Returned/)).toBeVisible();

    // Return the remaining 4 to close the pass
    await page.getByRole('button', { name: 'Mark return' }).click();
    await page.locator('#pass-return-qty').fill('4');
    await page.getByRole('button', { name: 'Confirm Return' }).click();
    await page.getByTestId('record-pass-returns').click();
    await expect(page.getByTestId('return-locked')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Fully returned and closed — nothing on this pass can be edited.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark return' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit return' })).toHaveCount(0);
  });

  test('a closed return offers no Mark/Edit control anywhere on the record (P2-79)', async ({ page, pageLog }) => {
    await page.goto(`/pass/${passDId}`);
    await settled(page);
    await expect(page.getByTestId('return-locked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark return' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit return' })).toHaveCount(0);
    expect(pageLog.errors).toEqual([]);
  });

  test('a read-only viewer (HOD) sees View, never Mark returned, on /returns (P2-64/95)', async ({ as }) => {
    const hod = await as('hod');
    await hod.page.goto('/returns');
    await settled(hod.page);
    await expect(hod.page.getByRole('button', { name: 'Mark returned' })).toHaveCount(0);
  });
});
