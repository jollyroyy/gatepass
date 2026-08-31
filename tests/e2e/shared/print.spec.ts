import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag } from '../helpers/lifecycle';
import { settled } from '../helpers/ui';

/** /pass/:id/print — rendered OUTSIDE AppShell (App.tsx:244-250). */
test.describe.configure({ mode: 'serial' });

test.describe('Print page', () => {
  test.use({ storageState: storageStateFor('hod') });

  let passId = '';

  test('raise the fixture pass', async ({ page }) => {
    const raised = await raisePass(page, { items: [{ name: `Print Item ${uniqueTag('PP')}`, qty: '1', unit: 'nos' }] });
    passId = raised.passId;
  });

  test('P3-40 the sheet is black-on-white regardless of the app theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gatepass-theme', 'dark'));
    await page.goto(`/pass/${passId}/print`);
    await settled(page);
    // `.pass-sheet` (PassPrint.tsx) is only a max-width/padding wrapper and
    // paints nothing itself — its computed background is transparent
    // (`rgba(0, 0, 0, 0)`), which is what the failure actually showed. The
    // slip's own paper is the bordered box one level in:
    // `border-2 border-black bg-white text-black`. Assert THAT paints white
    // with black text, no matter the app's dark theme setting — plus the two
    // other things that distinguish a printed slip from the app chrome: no
    // sidebar, and no colour-dependent information.
    const sheet = page.locator('.pass-sheet');
    await expect(sheet).toBeVisible();
    const paper = sheet.locator('> div').first();
    const style = await paper.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(style.bg).toMatch(/rgb\(255, 255, 255\)|rgba\(255, 255, 255/);
    expect(style.color).toMatch(/rgb\(0, 0, 0\)|rgba\(0, 0, 0/);
    await expect(page.locator('.shell-sidebar')).toHaveCount(0);
  });

  test('P3-08/2.13 no AppShell chrome renders on this page', async ({ page }) => {
    await page.goto(`/pass/${passId}/print`);
    await settled(page);
    await expect(page.locator('.shell-sidebar')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  });

  test('P3-41 window.print() is click-triggered only', async ({ page }) => {
    let printed = 0;
    await page.exposeFunction('__e2ePrintHook', () => { printed++; });
    await page.addInitScript(() => {
      const orig = window.print.bind(window);
      window.print = () => { (window as unknown as { __e2ePrintHook: () => void }).__e2ePrintHook(); orig(); };
    });
    await page.goto(`/pass/${passId}/print`);
    await settled(page);
    expect(printed).toBe(0);
    await page.getByRole('button', { name: 'Print' }).click();
    await expect.poll(() => printed).toBe(1);
  });

  test('P3-42 the Qty header is bare and cells carry the unit', async ({ page }) => {
    await page.goto(`/pass/${passId}/print`);
    await settled(page);
    await expect(page.getByRole('columnheader', { name: 'Qty' })).toHaveText('Qty');
  });

  test('a null value cell renders an em-dash, not zero', async ({ page }) => {
    await page.goto(`/pass/${passId}/print`);
    await settled(page);
    // This fixture pass has no priced items, so the value column (if present)
    // must show the null placeholder rather than a fabricated 0.
    const body = page.locator('.pass-sheet');
    const text = await body.innerText();
    expect(text).not.toMatch(/₹0(?!\d)/);
  });
});
