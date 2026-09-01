import { expect, type Browser, type Page } from '@playwright/test';
import { storageStateFor, type RoleKey } from '../fixtures/accounts';
import { settled } from './ui';

/**
 * The pass lifecycle, driven through the real UI.
 *
 * Every state transition in this app is RPC-only and a raised pass is PERMANENT
 * (migration 024) — there is no cancel and no delete. So these helpers create
 * real, permanent rows on the shared project. Keep the cast's department (E2E)
 * the only department they ever touch, and raise no more passes than a spec
 * actually asserts on.
 */

export interface RaiseOptions {
  type?: 'RGP' | 'NRGP';
  vendor?: string;
  address?: string;
  carrier?: string;
  mobile?: string;
  purpose?: string;
  vehicle?: string;
  items?: { name: string; qty?: string; unit?: string; makeModel?: string; value?: string; serial?: string; invoice?: string; returnDate?: string }[];
}

/** A tag no other pass in the project carries, so a spec can find its own row. */
export function uniqueTag(prefix = 'E2E'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/** Tomorrow as `yyyy-mm-dd`, for the RGP Expected Return Date (min = today). */
export function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill and submit /raise as the signed-in HOD, and return what the success
 * modal reports.
 *
 * There is NO navigation on success — `PassSubmittedModal` opens in place — so
 * the modal is what a caller must wait for, never a URL change.
 */
export async function raisePass(page: Page, opts: RaiseOptions = {}): Promise<{ passNumber: string; passId: string; vendor: string }> {
  const type = opts.type ?? 'RGP';
  const vendor = opts.vendor ?? `Vendor ${uniqueTag()}`;
  const items = opts.items ?? [{ name: `Item ${uniqueTag('IT')}`, qty: '2', makeModel: 'Model X' }];

  await page.goto('/raise');
  await settled(page);
  // Both the department list and getUser() resolve asynchronously; submitting
  // before they land raises "You are not assigned to any department."
  await expect(page.getByRole('button', { name: 'Submit Request' })).toBeEnabled();

  if (type === 'NRGP') {
    await page.getByRole('radio', { name: 'NRGP (Non-Returnable Gate Pass)' }).check();
  }

  await page.locator('#rp-vendor').fill(vendor);
  if (opts.address) await page.locator('#rp-address').fill(opts.address);
  await page.locator('#rp-carrier').fill(opts.carrier ?? 'Test Carrier');
  await page.locator('#rp-mobile').fill(opts.mobile ?? '9876543210');
  await page.locator('#rp-purpose').fill(opts.purpose ?? 'Automated end-to-end verification');
  if (opts.vehicle) await page.locator('#rp-vehicle').fill(opts.vehicle);

  // The grid starts with TWO empty rows and the last one cannot be removed, so
  // a one-item pass fills row 0 and deletes row 1.
  const rows = page.locator('.item-row');
  const have = await rows.count();
  for (let i = have; i < items.length; i++) {
    await page.getByRole('button', { name: 'Add Another Item' }).click();
  }
  for (let i = items.length; i < have; i++) {
    await page.getByRole('button', { name: `Remove item ${items.length + 1}` }).click();
  }

  for (const [i, item] of items.entries()) {
    const row = rows.nth(i);
    await row.getByLabel('Item Description').fill(item.name);
    await row.getByLabel('Quantity').fill(item.qty ?? '1');
    if (item.unit) await row.getByLabel('Unit').selectOption(item.unit);
    await row.getByLabel('Make / Model / Size').fill(item.makeModel ?? 'Model X');
    if (item.value) await row.getByLabel('Approx. Value (Rs)').fill(item.value);
    if (item.serial) await row.getByLabel('Serial / Asset Tag').fill(item.serial);
    if (item.invoice) await row.getByLabel('Order No.').fill(item.invoice);
    if (type === 'RGP') await row.getByLabel('Expected Return Date').fill(item.returnDate ?? tomorrow());
  }

  await page.getByRole('button', { name: 'Submit Request' }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 30_000 });
  await expect(modal.getByText('Pass Submitted')).toBeVisible();

  const href = await modal.getByRole('link', { name: 'View Pass' }).getAttribute('href');
  const passId = (href ?? '').replace('/pass/', '');
  const text = await modal.innerText();
  const passNumber = (text.match(/\b(?:RGP|NRGP)-[A-Z0-9-]+\b/) ?? [''])[0];

  expect(passId, 'the success modal links to the new pass').not.toBe('');
  expect(passNumber, 'the success modal shows the real pass number').not.toBe('');
  return { passNumber, passId, vendor };
}

/** Sign one office's approval on a pass, from that office's own queue. */
export async function approveAs(browser: Browser, role: RoleKey, passNumber: string): Promise<void> {
  const context = await browser.newContext({ storageState: storageStateFor(role) });
  const page = await context.newPage();
  try {
    await page.goto('/approvals');
    await settled(page);

    // NARROW THE QUEUE FIRST. "Pending for My Approval" pages at ten
    // (PendingApprovals.tsx PAGE_SIZE), and this suite raises real, permanent
    // passes — so by the tenth spec a freshly raised pass is on page two and a
    // plain card lookup reports "element(s) not found", which reads exactly like
    // the pass never reaching the office at all. Searching by pass number is
    // what a person would do, and it makes the helper independent of how much
    // the queue is already holding.
    const search = page.getByRole('textbox', { name: 'Search by Pass ID / Vendor / Purpose' });
    // The bar exists only once the board's first read resolves, and that read is
    // two sequential queries against a shared project — give it room.
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill(passNumber);
    await settled(page);

    const card = page.locator('[data-testid="pass-stack-card"]', { hasText: passNumber });
    await expect(card, `${role}'s queue holds ${passNumber}`).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(page.locator('[data-testid="pass-stack-card"]', { hasText: passNumber })).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await context.close();
  }
}

/**
 * Walk a freshly raised pass all the way to the gate.
 *
 * Three signatures, not four: 063 put the COO and the CEO on ONE level that
 * takes ONE signature, so the COO signing closes the CEO's row as
 * `not_required`.
 */
export async function approveThroughLadder(browser: Browser, passNumber: string): Promise<void> {
  await approveAs(browser, 'secHead', passNumber);
  await approveAs(browser, 'finHead', passNumber);
  await approveAs(browser, 'coo', passNumber);
}
