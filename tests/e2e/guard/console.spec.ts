import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

/**
 * P2 §2.11 `GateConsole.tsx` + `GateLookup.tsx`, and §2 camera cases (P2-100).
 * No pass fixture needed — this file only exercises the shell of the screen.
 */
test.describe('Search Pass (/console)', () => {
  test.use({ storageState: storageStateFor('guard') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/console');
    await settled(page);
  });

  test('renders the search-only shell with its exact title and subtitle', async ({ page, pageLog }) => {
    await expect(page.getByRole('heading', { name: 'Search Pass' })).toBeVisible();
    await expect(
      page.getByText(
        'Find a pass by its number, or by the mobile number, name, vendor, requester, order number or make and model on it.'
      )
    ).toBeVisible();
    await expect(page.getByTestId('gate-lookup')).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('Find is disabled until something is typed', async ({ page }) => {
    const find = page.getByRole('button', { name: 'Find' });
    await expect(find).toBeDisabled();
    await page
      .getByPlaceholder('Pass no., mobile, name, vendor, requester, order no., make / model…')
      .fill('anything');
    await expect(find).toBeEnabled();
  });

  test('Scan QR code opens the camera viewfinder (fake device, P2-100/101 smoke)', async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    // The button becomes the close control once scanning starts.
    await expect(page.getByRole('button', { name: 'Close QR scanner' })).toBeVisible();
    // The typed-entry field stays usable underneath the open scanner.
    await expect(
      page.getByPlaceholder('Pass no., mobile, name, vendor, requester, order no., make / model…')
    ).toBeEditable();
    await page.getByRole('button', { name: 'Close QR scanner' }).click();
    await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeVisible();
  });
});
