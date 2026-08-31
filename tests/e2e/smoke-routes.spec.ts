import { test, expect } from './fixtures/test';
import { ACCOUNTS, storageStateFor, type RoleKey } from './fixtures/accounts';
import { settled, expectPath } from './helpers/ui';

/**
 * Every parameterless route, for every role that may reach it: does it render,
 * and does it render WITHOUT a console error or a failed request?
 *
 * This is the suite's canary. A React render crash inside a route shows up here
 * as a page error long before any behavioural spec reaches the screen, and the
 * failure names the exact route and role.
 */
const ROUTES: Record<RoleKey, string[]> = {
  hod: ['/dashboard', '/raise', '/overdue', '/reports', '/returns', '/profile'],
  hod2: ['/dashboard', '/raise', '/overdue', '/reports', '/returns', '/profile'],
  deputy: ['/dashboard', '/raise', '/overdue', '/reports', '/returns', '/profile'],
  guard: ['/guard-dashboard', '/overdue', '/console', '/returns', '/profile'],
  admin: ['/admin-dashboard', '/overdue', '/admin', '/all-passes', '/activity', '/returns', '/profile'],
  // An office REPLACES the role's routes (roleRoutes.ts): four screens, no more.
  secHead: ['/approvals', '/delegation', '/whitelist', '/profile'],
  finHead: ['/approvals', '/delegation', '/whitelist', '/profile'],
  coo: ['/approvals', '/delegation', '/whitelist', '/profile'],
  ceo: ['/approvals', '/delegation', '/whitelist', '/profile'],
  staff: [],
};

for (const key of Object.keys(ROUTES) as RoleKey[]) {
  const routes = ROUTES[key];
  if (routes.length === 0) continue;

  test.describe(`${key} — every allowed route renders`, () => {
    test.use({ storageState: storageStateFor(key) });

    for (const route of routes) {
      test(`${key} opens ${route} cleanly`, async ({ page, pageLog }) => {
        await page.goto(route);
        await settled(page);

        // It stayed: a forbidden route would have been redirected home.
        await expectPath(page, route);
        // Something rendered inside the shell, and it is not React's blank body.
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('main')).not.toBeEmpty();

        expect(pageLog.errors, `console errors on ${route}`).toEqual([]);
        expect(pageLog.dialogs, `native dialogs on ${route}`).toEqual([]);
        expect(pageLog.badResponses, `failed requests on ${route}`).toEqual([]);
      });
    }
  });
}

test.describe('staff — the app opens nothing', () => {
  test.use({ storageState: storageStateFor('staff') });

  test('a staff account reaches no screen in this app', async ({ page }) => {
    for (const route of ['/dashboard', '/guard-dashboard', '/admin', '/approvals', '/raise']) {
      await page.goto(route);
      await settled(page);
      await expect(page.locator('main')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
      // The reason has to be the RIGHT reason: this account was never
      // suspended, so "Account Deactivated" would be a false sentence.
      await expect(page.getByRole('heading', { name: 'No Gate Pass Access' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Account Deactivated' })).toHaveCount(0);
    }
  });
});

test.describe('the route guard sends a wrong role home', () => {
  const FORBIDDEN: [RoleKey, string][] = [
    ['hod', '/admin'],
    ['hod', '/guard-dashboard'],
    ['hod', '/approvals'],
    ['guard', '/admin'],
    ['guard', '/raise'],
    ['guard', '/dashboard'],
    ['admin', '/raise'],
    ['admin', '/guard-dashboard'],
    // An office REPLACES the role's routes: an approver may NOT raise a pass
    // and may NOT work the gate, whatever their VMS role says.
    ['secHead', '/raise'],
    ['coo', '/dashboard'],
    ['ceo', '/guard-dashboard'],
  ];

  for (const [key, route] of FORBIDDEN) {
    test(`${key} is redirected away from ${route}`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: storageStateFor(key) });
      const page = await context.newPage();
      await page.goto(route);
      await settled(page);
      await expectPath(page, ACCOUNTS[key].home);
      await context.close();
    });
  }
});
