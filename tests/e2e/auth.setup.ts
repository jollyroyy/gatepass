import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import { ACCOUNTS, PASSWORD, storageStateFor, type RoleKey } from './fixtures/accounts';

/**
 * One real sign-in per role, through the real login form, cached to disk.
 *
 * Deliberately NOT a programmatic session injection: signing in through the form
 * is the only thing that proves the form works, and every later spec then starts
 * from a session the app itself issued.
 */
fs.mkdirSync('tests/e2e/.state', { recursive: true });

for (const key of Object.keys(ACCOUNTS) as RoleKey[]) {
  const account = ACCOUNTS[key];

  setup(`sign in as ${key}`, async ({ page }) => {
    await page.goto('/login');
    // getByRole('textbox'), not getByLabel: the eye toggle beside the password
    // field carries aria-label="Show password", so getByLabel('Password')
    // resolves to two elements and Playwright's strict mode refuses it.
    await page.getByRole('textbox', { name: 'Email' }).fill(account.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // The landing route IS the assertion: roleRoutes.homeFor() decides it, and a
    // wrong landing means the role or the office did not resolve.
    //
    // `staff` is the exception: App.tsx renders <NoAccess> in place instead of
    // navigating, so waiting for a path would time out on a screen that is
    // already correct. Wait for the screen itself.
    if (key === 'staff') {
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page).toHaveURL(new RegExp(`${account.home.replace('/', '\/')}`), { timeout: 30_000 });
    }
    await page.context().storageState({ path: storageStateFor(key) });
  });
}
