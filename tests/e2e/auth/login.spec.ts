import { test, expect } from '../fixtures/test';
import { ACCOUNTS, PASSWORD } from '../fixtures/accounts';
import { settled, expectPath } from '../helpers/ui';

/**
 * The ONLY spec allowed to fill the login form (CONVENTIONS.md).
 *
 * Default (no test.use storageState) browser context starts unauthenticated,
 * so every test here begins fresh at /login.
 */

test.describe('login — happy path and form behaviour', () => {
  test('P3-10 signing in as the HOD lands on the HOD home', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expectPath(page, ACCOUNTS.hod.home);
  });

  test('P3-11 invalid credentials shows the exact GoTrue message', async ({ page, pageLog }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible({ timeout: 15_000 });
    // form remains editable, no navigation
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeEditable();
    await expectPath(page, '/login');
    // The 400 on /auth/v1/token IS the failure path this test wants — the
    // browser logs a console "Failed to load resource" entry for that response
    // (and the fixture's own `badResponses` records it by design, see
    // fixtures/test.ts's comment on this exact case), so asserting an empty
    // `pageLog.errors`/`badResponses` here would fail a passing negative test.
    // What must stay empty is native dialogs — this app never shows the
    // failure as a blocking alert/confirm/prompt.
    expect(pageLog.dialogs).toEqual([]);
  });

  test('P3-11b a bogus email produces the same message, never account enumeration', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill('no-such-account@e2e.local');
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible({ timeout: 15_000 });
  });

  test('P3-12 show/hide password toggle flips input type and aria-label', async ({ page }) => {
    await page.goto('/login');
    const pwd = page.getByRole('textbox', { name: 'Password' }).or(page.locator('#password'));
    const input = page.locator('#password');
    await input.fill('whatever');
    await expect(input).toHaveAttribute('type', 'password');
    const toggle = page.getByRole('button', { name: 'Show password' });
    await toggle.click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(input).toHaveAttribute('type', 'password');
    void pwd;
  });

  test('P3-13 busy state disables the submit button while signing in', async ({ page }) => {
    await page.goto('/login');
    // Slow the token endpoint so the busy state is observable.
    await page.route('**/auth/v1/token**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    const busyButton = page.getByRole('button', { name: 'Signing in…' });
    await expect(busyButton).toBeVisible();
    await expect(busyButton).toBeDisabled();
  });

  test('P3-14 forgot-password is a mailto sentence, no self-service button', async ({ page }) => {
    await page.goto('/login');
    const link = page.getByRole('link', { name: 'admin@demo.quest' });
    await expect(link).toHaveAttribute('href', 'mailto:admin@demo.quest');
    await expect(page.getByRole('button', { name: /forgot password/i })).toHaveCount(0);
  });

  test('P3-15a network failure shows the exact network-error sentence', async ({ page }) => {
    await page.goto('/login');
    await page.route('**/auth/v1/token**', (route) => route.abort('failed'));
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Network error. Check your connection and try again.')).toBeVisible({ timeout: 15_000 });
  });

  test('P3-15b unconfirmed-email GoTrue error shows the exact sentence', async ({ page }) => {
    await page.goto('/login');
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' }),
      }),
    );
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(
      page.getByText("This account’s email address has not been confirmed yet. Ask your administrator to confirm it."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('P3-15c rate limit GoTrue error shows the exact sentence', async ({ page }) => {
    await page.goto('/login');
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'over_request_rate_limit', error_code: 'over_request_rate_limit', msg: 'rate limited' }),
      }),
    );
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Too many attempts. Please wait a few minutes and try again.')).toBeVisible({ timeout: 15_000 });
  });

  test('P3-53 keyboard tab order: Email -> Password -> Sign In', async ({ page }) => {
    // The eye toggle carries `tabIndex={-1}` (Login.tsx) — deliberately OUT of
    // the tab order, so it is never a stop between Password and Sign In.
    await page.goto('/login');
    await page.locator('#email').focus();
    await expect(page.locator('#email')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeFocused();
  });

  test('P3-53b Enter on the password field submits the form', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(ACCOUNTS.hod.email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#password').press('Enter');
    await expectPath(page, ACCOUNTS.hod.home);
  });
});

test.describe('login — heading and layout', () => {
  test('heading and tagline render on a fresh visit', async ({ page }) => {
    await page.goto('/login');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('Gate Pass Control')).toBeVisible();
    await expect(page.getByText('Accounts are provisioned by an administrator.')).toBeVisible();
  });
});
