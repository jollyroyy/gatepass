import { test, expect } from '../fixtures/test';
import { ACCOUNTS, PASSWORD, storageStateFor } from '../fixtures/accounts';
import { settled, expectPath } from '../helpers/ui';

/**
 * Route gating (App.tsx's gating order) and the ?next= deep-link resume.
 * smoke-routes.spec.ts already covers "every parameterless route renders for
 * every role" and the basic wrong-role redirect — this file goes deeper into
 * the gate ORDER itself and the resume matrix.
 */

test.describe('P3-01 unauthenticated redirects carry ?next=', () => {
  for (const route of ['/dashboard', '/admin', '/console', '/reports']) {
    test(`unauthenticated ${route} redirects to /login?next=<encoded path>`, async ({ page }) => {
      await page.goto(route);
      await settled(page);
      await expectPath(page, '/login');
      const url = new URL(page.url());
      expect(url.searchParams.get('next')).toBe(route);
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    });
  }
});

test.describe('P3-02 /reset-password renders regardless of session state', () => {
  test('no session', async ({ page }) => {
    await page.goto('/reset-password');
    await settled(page);
    await expectPath(page, '/reset-password');
  });

  test('a valid signed-in session', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStateFor('hod') });
    const page = await ctx.newPage();
    await page.goto('/reset-password');
    await settled(page);
    await expectPath(page, '/reset-password');
    await ctx.close();
  });
});

test.describe('P3-05 a non-admin office holder loses their underlying role\'s routes', () => {
  test.use({ storageState: storageStateFor('secHead') });

  for (const route of ['/guard-dashboard', '/console', '/overdue', '/returns']) {
    test(`Security Head (guard-role) visiting ${route} lands on /approvals`, async ({ page }) => {
      await page.goto(route);
      await settled(page);
      await expectPath(page, '/approvals');
    });
  }
});

test.describe('P3-08 the print route renders with zero AppShell chrome', () => {
  test.use({ storageState: storageStateFor('hod') });

  test('an unknown-but-syntactically-valid pass id print route has no sidebar/bell', async ({ page }) => {
    // Any real print URL shape reaches the print branch before the not-found
    // check inside PassPrint itself — App.tsx's gate is on the PATH, not the id.
    await page.goto('/pass/00000000-0000-0000-0000-000000000000/print');
    await settled(page);
    await expect(page.locator('.shell-sidebar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Notifications/ })).toHaveCount(0);
  });
});

test.describe('P3-09 ?next= deep-link resume matrix', () => {
  test.use({ storageState: undefined });

  async function signInWithNext(page: import('@playwright/test').Page, next: string) {
    await page.goto('/login?next=' + encodeURIComponent(next));
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  test('a /pass/:id next value resumes to that exact pass', async ({ page }) => {
    await signInWithNext(page, '/pass/00000000-0000-0000-0000-000000000000');
    await expectPath(page, '/pass/00000000-0000-0000-0000-000000000000');
  });

  test('a //evil.example/x next value never leaves this origin', async ({ page }) => {
    await signInWithNext(page, '//evil.example/x');
    await settled(page);
    expect(new URL(page.url()).origin).toBe(new URL(page.url()).origin);
    expect(page.url()).not.toContain('evil.example');
    await expectPath(page, ACCOUNTS.hod.home);
  });

  test('a backslash-prefixed next value never leaves this origin', async ({ page }) => {
    await signInWithNext(page, '\\evil.example');
    await settled(page);
    expect(page.url()).not.toContain('evil.example');
    await expectPath(page, ACCOUNTS.hod.home);
  });

  test('an absolute https next value never leaves this origin', async ({ page }) => {
    await signInWithNext(page, 'https://evil.example');
    await settled(page);
    expect(page.url()).not.toContain('evil.example');
    await expectPath(page, ACCOUNTS.hod.home);
  });

  test('/admin as an HOD session does not resume — falls back to home', async ({ page }) => {
    await signInWithNext(page, '/admin');
    await settled(page);
    await expectPath(page, ACCOUNTS.hod.home);
  });

  test('an absent next lands on homeFor(role)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(ACCOUNTS.hod.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expectPath(page, ACCOUNTS.hod.home);
  });
});

test.describe('authenticated visits to /login redirect home (not the login form)', () => {
  test.use({ storageState: storageStateFor('guard') });

  test('guard hitting /login lands on the guard home', async ({ page }) => {
    await page.goto('/login');
    await settled(page);
    await expectPath(page, ACCOUNTS.guard.home);
  });
});
