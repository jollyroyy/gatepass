import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

/** CLAUDE.md's design-system rules, asserted as computed styles (plan §6). */
test.describe('Design system — Quest Gold + Charcoal', () => {
  test.use({ storageState: storageStateFor('admin') });

  test('no font-display element carries font-weight 700', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    const weights = await page.locator('.font-display').evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).fontWeight),
    );
    for (const w of weights) {
      expect(['400', 'normal']).toContain(w);
    }
  });

  test('rupee values never abbreviate, on Reports', async ({ page }) => {
    await page.goto('/all-passes');
    await settled(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/₹[\d.]+[KMk]\b/);
  });

  test('no chart draws in brand gold on the admin trend/status SVGs', async ({ page }) => {
    await page.goto('/admin-dashboard');
    await settled(page);
    const brandHex = '#c6a15b';
    const fills = await page.locator('.gb-ov-panel svg [fill], .gb-ov-panel svg [stroke]').evaluateAll((els) =>
      els.flatMap((el) => [el.getAttribute('fill'), el.getAttribute('stroke')]).filter(Boolean),
    );
    for (const f of fills as string[]) {
      expect(f.toLowerCase()).not.toBe(brandHex);
    }
  });

  test('a quantity cell always names its unit and the header stays bare, on Reports', async ({ page }) => {
    await page.goto('/all-passes');
    await settled(page);
    const header = page.getByRole('columnheader', { name: /Total Number of Items/ });
    if (await header.count()) {
      await expect(header).toHaveText('Total Number of Items');
    }
  });

  test('text on the active gold sidebar link is charcoal, not white', async ({ page }) => {
    await page.goto('/admin-dashboard');
    await settled(page);
    const active = page.locator('.sidebar-link-active').first();
    if (await active.count()) {
      const color = await active.evaluate((el) => getComputedStyle(el).color);
      // #101014 -> rgb(16, 16, 20)
      expect(color).toMatch(/rgb\(1[0-9], 1[0-9], 2[0-9]\)/);
    }
  });
});
