import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Wait until a board has finished its first read.
 *
 * Every list in this app renders one of three things explicitly — `.skeleton`
 * while loading, `.empty-state` when there is nothing, or rows (CLAUDE.md). So
 * "loaded" is "no skeleton left", and asserting on content before that is the
 * single most common source of flake in this suite.
 */
export async function settled(page: Page): Promise<void> {
  // BOTH skeleton classes. `.skeleton` is the older one; the guard/approver
  // boards draw `.gb-skeleton`, and waiting only for the first meant `settled()`
  // returned while an approval queue was still loading — the filter bar it
  // renders after loading then "did not exist" for fifteen seconds.
  await expect(page.locator('.skeleton, .gb-skeleton').first())
    .toBeHidden({ timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** The first integer in a string, or null. KPI figures are rendered as plain text. */
export function firstNumber(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * THE DASHBOARD INVARIANT, as a browser assertion.
 *
 * CLAUDE.md: "a KPI's number is `rows.length` of the array its click opens".
 * So: read the figure, press the card, count the rows on the page it opens.
 * `countRows` is passed in because each board draws its drill list differently.
 */
export async function assertKpiOpensItsOwnRows(
  page: Page,
  card: Locator,
  countRows: (page: Page) => Promise<number>,
): Promise<{ figure: number; rows: number }> {
  const figure = firstNumber(await card.innerText());
  expect(figure, 'KPI card renders a number').not.toBeNull();
  await card.click();
  await settled(page);
  const rows = await countRows(page);
  expect(rows, `KPI figure ${figure} must equal the rows it opens`).toBe(figure);
  return { figure: figure as number, rows };
}

/**
 * Assert no native dialog can fire from an action.
 *
 * `window.alert` / `confirm` / `prompt` are banned in this app — they block the
 * page and break automation. Playwright auto-dismisses dialogs, so a violation
 * is otherwise INVISIBLE; this makes it fail.
 */
export async function withNoNativeDialog(page: Page, action: () => Promise<void>): Promise<void> {
  const seen: string[] = [];
  const onDialog = (d: import('@playwright/test').Dialog) => {
    seen.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  };
  page.on('dialog', onDialog);
  try {
    await action();
  } finally {
    page.off('dialog', onDialog);
  }
  expect(seen, 'no window.alert/confirm/prompt may fire').toEqual([]);
}

/** Read a CSV the page downloads when `action` runs. */
export async function csvFrom(page: Page, action: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Every NAV TAB in the sidebar, as label and href.
 *
 * Scoped to `a.sidebar-link`, not to every anchor in `.shell-sidebar`: the shell
 * also holds the brand wordmark (a `Link to="/"`) and the profile block (a
 * `Link to="/profile"`), and neither is a tab. A spec asserting "the guard has
 * exactly one tab" against the broader selector can never pass, because it is
 * counting three anchors.
 */
export async function sidebarLinks(page: Page): Promise<{ label: string; href: string }[]> {
  const links = page.locator('.shell-sidebar a.sidebar-link[href]');
  const n = await links.count();
  const out: { label: string; href: string }[] = [];
  for (let i = 0; i < n; i++) {
    const l = links.nth(i);
    out.push({ label: (await l.innerText()).trim(), href: (await l.getAttribute('href')) ?? '' });
  }
  return out;
}

/**
 * The current pathname.
 *
 * Prefer this over `toHaveURL(new RegExp(...))` for route assertions: building a
 * regex out of a path means escaping `/` and `?` by hand, and a mis-escaped one
 * throws `Invalid regular expression` — a TEST crash that looks nothing like the
 * routing failure it was meant to catch.
 */
export function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** Wait for the SPA to settle on a path (navigation is client-side). */
export async function expectPath(page: Page, path: string): Promise<void> {
  await expect.poll(() => pathOf(page), { timeout: 15_000 }).toBe(path);
}
