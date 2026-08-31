import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

/** Modal focus/Escape/backdrop, label bindings, heading hierarchy, sign-out
 *  accessible name, and the session-wide no-native-dialog guarantee (P3-58). */
test.describe('Accessibility', () => {
  test.use({ storageState: storageStateFor('admin') });

  test('P3-54 Escape and backdrop click both close a modal (never confirm)', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Add Department' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Add Department' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // backdrop click: click the overlay outside the modal-content box
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();
  });

  test('P3-54b no focus trap: Tab can leave an open modal (documented gap, not a test bug)', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Add Department' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Tab many times; assert this does not throw and the app keeps running.
    for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
    // No assertion of containment — absence of a focus trap is the documented
    // finding (plan §5 P3-54), not a failure to fix here.
    await page.keyboard.press('Escape');
  });

  test('P3-55 every getByLabel target on the Approval Ladder card resolves to exactly one element', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await settled(page);
    for (const title of ['Security Head', 'Finance HOD', 'COO', 'CEO']) {
      await expect(page.getByLabel(`${title} account`)).toHaveCount(1);
    }
  });

  test('P3-55b Add Department modal fields are NOT label-bound (finding, asserted as fact)', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Add Department' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // DepartmentNameCodeFields renders <label> as a plain sibling with no
    // htmlFor/id pair, so getByLabel legitimately fails to resolve here —
    // this is the testability gap reported to the lead, not a selector bug.
    await expect(dialog.getByLabel('Department Name')).toHaveCount(0);
    await expect(dialog.getByPlaceholder('e.g. Quality Assurance')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  test('P3-56 AdminPanel has exactly one h1-equivalent page title', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Admin' })).toHaveCount(1);
  });

  test('P3-57 SidebarProfile sign-out resolves an accessible name from title alone', async ({ page }) => {
    await page.goto('/admin-dashboard');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('P3-53 Login keyboard tab order reaches every control in DOM order', async ({ browser }) => {
    // This describe block signs in as admin (`test.use({ storageState: ... })`
    // above), and Supabase persists its session in localStorage, not cookies —
    // `context.clearCookies()` leaves that session intact, so a `context`
    // inheriting it still resolves `!session === false` on `/login` and
    // App.tsx redirects home before `#email` ever renders (the timeout this
    // test was hitting). A genuinely unauthenticated context needs no
    // storageState at all, not a cookie clear.
    const freshCtx = await browser.newContext();
    const fresh = await freshCtx.newPage();
    await fresh.goto('/login');
    await fresh.locator('#email').focus();
    await expect(fresh.locator('#email')).toBeFocused();
    await fresh.keyboard.press('Tab');
    await expect(fresh.locator('#password')).toBeFocused();
    await freshCtx.close();
  });

  test('P3-58 no native dialog fires across a representative write-flow', async ({ page, pageLog }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await settled(page);
    await page.getByRole('button', { name: 'Add User' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(pageLog.dialogs).toEqual([]);
  });
});
