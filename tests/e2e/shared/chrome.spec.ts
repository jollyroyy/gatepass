import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

/** Sidebar, notification bell, theme toggle, offline banner, collapse. */
test.describe('Layout chrome', () => {
  test.use({ storageState: storageStateFor('hod') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await settled(page);
  });

  test('P3-48 theme toggle flips <html>.dark, the button label, and persists', async ({ page }) => {
    const html = page.locator('html');
    const before = await html.evaluate((el) => el.classList.contains('dark'));
    const toggle = page.getByRole('button', { name: 'Toggle theme' });
    await toggle.click();
    await expect.poll(() => html.evaluate((el) => el.classList.contains('dark'))).toBe(!before);
    const expectedLabel = !before ? 'Light Mode' : 'Dark Mode';
    await expect(page.getByText(expectedLabel)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('gatepass-theme'));
    expect(stored).toBe(!before ? 'dark' : 'light');
    await page.reload();
    await settled(page);
    await expect(html).toHaveClass(!before ? /dark/ : /^(?!.*dark).*$/);
    // restore
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  });

  test('P3-48b default theme with no stored value is dark, not OS preference', async ({ page, context }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => localStorage.removeItem('gatepass-theme'));
    await page.reload();
    await settled(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('P3-49 the sidebar background is identical in both themes', async ({ page }) => {
    const sidebar = page.locator('.shell-sidebar').first();
    const before = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await settled(page);
    const after = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(after).toBe(before);
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  });

  test('P3-52 sidebar collapse toggles aria-expanded and persists across reload', async ({ page }) => {
    const handle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ });
    const before = await handle.getAttribute('aria-label');
    await handle.click();
    await expect(page.getByRole('button', { name: before === 'Collapse sidebar' ? 'Expand sidebar' : 'Collapse sidebar' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('gatepass-sidebar-collapsed'));
    expect(['0', '1']).toContain(stored);
    await page.reload();
    await settled(page);
    await expect(page.getByRole('button', { name: before === 'Collapse sidebar' ? 'Expand sidebar' : 'Collapse sidebar' })).toBeVisible();
    // restore
    await page.getByRole('button', { name: before === 'Collapse sidebar' ? 'Expand sidebar' : 'Collapse sidebar' }).click();
  });

  test('P3-47a notification bell renders and its empty/dismiss-all states are consistent', async ({ page }) => {
    const bell = page.getByRole('button', { name: /Notifications/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByText('No notifications').or(page.getByRole('button', { name: 'Dismiss all' }))).toBeVisible();
  });

  test('P3-51 the offline banner appears on the offline event and clears on online', async ({ page }) => {
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    const banner = page.getByRole('status');
    await expect(banner).toBeVisible();
    await expect(banner.getByText('You are offline')).toBeVisible();
    await expect(banner).toContainText('do not act on them until this clears');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});
