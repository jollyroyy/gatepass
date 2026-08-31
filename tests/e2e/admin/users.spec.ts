import { test, expect } from '../fixtures/test';
import { storageStateFor, PASSWORD } from '../fixtures/accounts';
import { settled, expectPath, withNoNativeDialog } from '../helpers/ui';
import { uniqueTag } from '../helpers/lifecycle';

/**
 * A person's Full Name is judged by `personNameError` / the `profiles`
 * charset check — letters, spaces, `.`, `'`, `-` only, NO DIGITS
 * (`src/lib/nameValidation.ts`). `uniqueTag()` is base36 and always contains
 * digits, so a name built directly from it trips that client-side validator
 * and the Add User dialog never closes. This maps digits to letters so
 * generated display names stay unique without hitting that — see the fuller
 * note in `departments.spec.ts`, which hits the same thing.
 */
const DIGIT_LETTER: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'D', '4': 'E', '5': 'F', '6': 'G', '7': 'H', '8': 'I', '9': 'J',
};
function personTag(): string {
  return uniqueTag().split('').map((c) => DIGIT_LETTER[c] ?? c).join('');
}

/**
 * Users tab (W5-W9) plus P3-06/P3-07 (mustChangePassword / deactivated gates).
 * Every account these tests create, deactivate, reactivate or reset carries
 * an @e2e.local email freshly minted in the SAME test — never a cast member
 * (e2e.hod, e2e.guard, ...).
 */
test.describe('Admin > Users tab', () => {
  test.use({ storageState: storageStateFor('admin') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await settled(page);
  });

  test('P3-19 create a guard user, then edit them, then deactivate/reactivate/reset (W5,W6,W7,W8,W9)', async ({ page, browser }) => {
    const email = `e2e.gen.${uniqueTag().toLowerCase()}@e2e.local`;
    const name = `E2E Gen ${personTag()}`;

    await page.getByRole('button', { name: 'Add User' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add User' })).toBeVisible();
    await dialog.getByPlaceholder('user@company.com').fill(email);
    await dialog.getByPlaceholder('Min 6 characters').fill(PASSWORD);
    await dialog.getByPlaceholder('Jane Doe').fill(name);
    // role select defaults to Guard already
    await withNoNativeDialog(page, async () => {
      await dialog.getByRole('button', { name: 'Create User' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    });

    await page.getByRole('button', { name: 'All' }).click();
    await settled(page);
    const row = page.locator('tr', { hasText: email });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // W6 — edit the user's name
    const newName = `${name} Edited`;
    await row.getByRole('button', { name: 'Edit' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit User' })).toBeVisible();
    const nameInput = dialog.locator('input').first();
    await nameInput.fill(newName);
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('tr', { hasText: email })).toContainText(newName);

    // W9 — reset password, then confirm mustChangePassword (P3-06) with a second session
    const newPassword = `Reset-${uniqueTag()}-1!`;
    await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Edit' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reset Password' }).click();
    await dialog.locator('#reset-password-input').fill(newPassword);
    await withNoNativeDialog(page, async () => {
      await dialog.getByRole('button', { name: 'Set New Password' }).click();
      await expect(dialog.getByRole('heading', { name: 'Password Reset' })).toBeVisible({ timeout: 15_000 });
    });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const freshCtx = await browser.newContext();
    const freshPage = await freshCtx.newPage();
    await freshPage.goto('/login');
    await freshPage.getByRole('textbox', { name: 'Email' }).fill(email);
    await freshPage.getByRole('textbox', { name: 'Password' }).fill(newPassword);
    await freshPage.getByRole('button', { name: 'Sign In' }).click();
    await expect(freshPage.getByRole('heading', { name: 'Set your password' })).toBeVisible({ timeout: 15_000 });
    // any URL typed still shows the force-change screen
    await freshPage.goto('/admin');
    await expect(freshPage.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    await freshCtx.close();

    // W7 — deactivate (P3-07 uses this same account)
    await page.reload();
    await settled(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await page.getByRole('button', { name: 'All' }).click();
    await settled(page);
    await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Deactivate' }).click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByRole('heading', { name: 'Deactivate User?' })).toBeVisible();
    await expect(confirmDialog.getByTestId('deactivate-vacates-office')).toHaveCount(0);
    await withNoNativeDialog(page, async () => {
      await confirmDialog.getByRole('button', { name: 'Deactivate' }).click();
      await expect(confirmDialog).toBeHidden({ timeout: 15_000 });
    });
    await page.getByRole('button', { name: 'Inactive' }).click();
    await settled(page);
    await expect(page.locator('tr', { hasText: email })).toBeVisible({ timeout: 15_000 });

    // P3-07 — deactivated gate: this user cannot sign in with UI access
    const deactCtx = await browser.newContext();
    const deactPage = await deactCtx.newPage();
    await deactPage.goto('/login');
    await deactPage.getByRole('textbox', { name: 'Email' }).fill(email);
    await deactPage.getByRole('textbox', { name: 'Password' }).fill(newPassword);
    await deactPage.getByRole('button', { name: 'Sign In' }).click();
    await settled(deactPage);
    await expect(deactPage.getByRole('heading', { name: 'Account Deactivated' })).toBeVisible({ timeout: 15_000 });
    await deactPage.goto('/admin-dashboard');
    await expect(deactPage.getByRole('heading', { name: 'Account Deactivated' })).toBeVisible();
    await deactCtx.close();

    // W8 — reactivate (guard/HOD row, one click, no modal)
    await page.getByRole('button', { name: 'Inactive' }).click();
    await settled(page);
    const inactiveRow = page.locator('tr', { hasText: email });
    await inactiveRow.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'All' }).click();
    await settled(page);
    await expect(page.locator('tr', { hasText: email })).toBeVisible({ timeout: 15_000 });
  });

  test('P3-16 W5 duplicate-email create surfaces a friendly error, not a blank failure', async ({ page }) => {
    const email = `e2e.dup.${uniqueTag().toLowerCase()}@e2e.local`;
    const name = `E2E Dup ${personTag()}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Add User' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('user@company.com').fill(email);
      await dialog.getByPlaceholder('Min 6 characters').fill(PASSWORD);
      await dialog.getByPlaceholder('Jane Doe').fill(name);
      await dialog.getByRole('button', { name: 'Create User' }).click();
      if (attempt === 0) {
        await expect(dialog).toBeHidden({ timeout: 15_000 });
      } else {
        await expect(dialog.getByText('That record already exists.')).toBeVisible({ timeout: 15_000 });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
    }
  });
});
