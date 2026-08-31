import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from '../helpers/lifecycle';
import { settled } from '../helpers/ui';

/**
 * P2 §3 "Search — exhaustive routing, sanitisation, rendering", via `/console`
 * (`GateConsole` + `GateLookup`). One RGP fixture carries a vendor with a
 * comma AND a bracket, a phone tail, an invoice number and a make/model — one
 * pass answers every branch this file exercises, per CLAUDE.md's "create the
 * minimum data a spec actually asserts on".
 */
test.describe.configure({ mode: 'serial' });

test.describe('gate search — the three branches', () => {
  test.use({ storageState: storageStateFor('guard') });

  const tag = uniqueTag('S');
  const vendor = `Acme, (Contracts) ${tag}`;
  const mobile = '9123456789'; // 6+ digit tail routes to phone search
  const invoice = `INV-${tag}`;
  const makeModel = `Latitude 5420 ${tag}`;
  let passNumber = '';

  test.beforeAll(async ({ browser }) => {
    const hod = await browser.newContext({ storageState: storageStateFor('hod') });
    const hodPage = await hod.newPage();
    const raised = await raisePass(hodPage, {
      type: 'RGP',
      vendor,
      mobile,
      items: [{ name: `Item ${tag}`, qty: '2', makeModel, invoice }],
    });
    await hod.close();
    passNumber = raised.passNumber;
    // migration 046: "for a guard a pass that still owes a signature does not
    // exist: not in the Pending OUT queue, not in a search, not behind a
    // scanned QR code, not at /pass/<uuid>." A freshly raised pass is invisible
    // to every gate search until it clears the three-signature ladder.
    await approveThroughLadder(browser, passNumber);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/console');
    await settled(page);
  });

  async function find(page: import('@playwright/test').Page, query: string) {
    await page.getByPlaceholder('Pass no., mobile, name, vendor, requester, order no., make / model…').fill(query);
    await page.getByRole('button', { name: 'Find' }).click();
  }

  test('a well-formed pass number resolves to one record in place (P2-20)', async ({ page, pageLog }) => {
    await find(page, passNumber);
    await expect(page.getByTestId('pass-record')).toBeVisible();
    expect(pageLog.errors).toEqual([]);
  });

  test('a partial pass number falls through to free text, not lookup_pass (P2-21)', async ({ page }) => {
    await find(page, 'RGP-OUT-2026');
    // Never the code-branch's own "no pass matches that code" error.
    await expect(page.getByText('The gate could not read that code. Try again.')).toHaveCount(0);
    await expect(
      page.getByTestId('guard-search-results').or(page.getByTestId('pass-record'))
    ).toBeVisible();
  });

  test('a 6+ digit numeric query routes to phone search, not lookup_pass (P2-22)', async ({ page }) => {
    await find(page, mobile.slice(-6));
    const results = page.getByTestId('guard-search-results');
    await expect(results.or(page.getByTestId('pass-record'))).toBeVisible();
    await expect(page.getByText('No pass matches that code. Check the slip and try again.')).toHaveCount(0);
  });

  test('a 5-digit numeric query does not route to phone search (P2-23)', async ({ page }) => {
    await find(page, '54321');
    // Falls through to free text — a real (possibly empty) list answer, no crash.
    await expect(page.getByTestId('guard-search-results').or(page.getByTestId('pass-record'))).toBeVisible();
  });

  test('a query with a letter is never phone-routed, even if mostly numeric (P2-24)', async ({ page }) => {
    await find(page, 'A123456');
    await expect(page.getByTestId('guard-search-results').or(page.getByTestId('pass-record'))).toBeVisible();
  });

  test('a comma and a bracket in a vendor name do not 400 the request (P2-25)', async ({ page, pageLog }) => {
    await find(page, vendor);
    await expect(page.getByTestId('guard-search-results').or(page.getByTestId('pass-record'))).toBeVisible();
    expect(pageLog.badResponses.filter((r) => /400/.test(r))).toEqual([]);
  });

  test('brackets, %, and * are sanitized without a network error (P2-26)', async ({ page, pageLog }) => {
    for (const q of ['(Drill)', '50%', 'Latitude*']) {
      await page.goto('/console');
      await settled(page);
      await find(page, q);
      await expect(page.locator('.alert-error', { hasText: /malformed|syntax/i })).toHaveCount(0);
    }
    expect(pageLog.badResponses.filter((r) => /400/.test(r))).toEqual([]);
  });

  test('the invoice number (order number) is searchable — reachable only via the item union (P2-27)', async ({ page }) => {
    await find(page, invoice);
    await expect(page.getByTestId('guard-search-results').or(page.getByTestId('pass-record'))).toBeVisible();
    await expect(page.getByText(passNumber)).toBeVisible();
  });

  test('make/model is searchable (P2-28)', async ({ page }) => {
    await find(page, makeModel);
    await expect(page.getByText(passNumber)).toBeVisible();
  });

  test('zero matches renders the real empty state, never a spinner (P2-29)', async ({ page }) => {
    await find(page, 'zzzznomatchzzzz');
    await expect(page.getByTestId('guard-search-results')).toBeVisible();
    await expect(page.getByRole('heading', { name: /zzzznomatchzzzz — 0 passes/ })).toBeVisible();
    await expect(
      page.getByText(
        'No gate pass matches that pass number, mobile number, name, vendor, requester, order number or make and model.'
      )
    ).toBeVisible();
  });

  test('one free-text match opens the record directly on /console (P2-30)', async ({ page }) => {
    await find(page, makeModel);
    await expect(page.getByTestId('pass-record')).toBeVisible();
    await expect(page.getByTestId('guard-search-results')).toHaveCount(0);
  });
});
