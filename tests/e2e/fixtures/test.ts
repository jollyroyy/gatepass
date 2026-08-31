import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { ACCOUNTS, storageStateFor, type RoleKey } from './accounts';

export { expect };
// Re-exported so a spec never has to import from '@playwright/test' directly —
// the harness fixture is the single entry point (see CONVENTIONS.md).
export type { Page, BrowserContext, Locator } from '@playwright/test';

/** Console messages and page errors a spec may assert on. */
export interface PageLog {
  errors: string[];
  /** Native dialogs are BANNED in this app (CLAUDE.md: never window.alert /
   *  confirm / prompt). Any that fires is recorded here and auto-dismissed so
   *  the run does not hang. */
  dialogs: string[];
  /** Non-2xx/3xx responses to the app's own origin and to Supabase. */
  badResponses: string[];
}

/** Noise no spec should fail on: it comes from the environment, not the app. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /favicon/i,
  /ResizeObserver loop/i,
];

function watch(page: Page): PageLog {
  const log: PageLog = { errors: [], dialogs: [], badResponses: [] };

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
    log.errors.push(text);
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => {
    log.dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() < 400) return;
    if (!/localhost:5174|supabase\.co/.test(url)) return;
    // 401 on /auth/v1/token is the sign-in-failure path a negative test WANTS.
    log.badResponses.push(`${r.status()} ${r.request().method()} ${url}`);
  });

  return log;
}

interface Fixtures {
  /** Sign in as any role inside a test, for cross-role specs. */
  as: (role: RoleKey) => Promise<{ page: Page; context: BrowserContext; log: PageLog }>;
  /** Console errors, banned native dialogs and failed requests seen by `page`. */
  pageLog: PageLog;
}

export const test = base.extend<Fixtures>({
  pageLog: async ({ page }, use) => {
    await use(watch(page));
  },

  as: async ({ browser }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (role: RoleKey) => {
      const context = await browser.newContext({ storageState: storageStateFor(role) });
      opened.push(context);
      const page = await context.newPage();
      return { page, context, log: watch(page) };
    });
    for (const c of opened) await c.close();
  },
});

/** Declare the role a whole describe-block runs as. */
export function useRole(role: RoleKey): void {
  test.use({ storageState: storageStateFor(role) });
}

export { ACCOUNTS, storageStateFor };
export type { RoleKey };
