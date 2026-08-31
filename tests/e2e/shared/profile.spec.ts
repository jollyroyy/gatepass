import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';

/** /profile — reachable by every role. Read-only fields, editable name. */
test.describe('Profile page', () => {
  test.use({ storageState: storageStateFor('hod') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/profile');
    await settled(page);
  });

  test('renders the heading, read-only fields, and the editable name', async ({ page, pageLog }) => {
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    await expect(page.getByText('Email')).toBeVisible();
    await expect(page.getByText('Role')).toBeVisible();
    await expect(page.getByText('Department')).toBeVisible();
    await expect(page.getByText('Member since')).toBeVisible();
    await expect(page.getByLabel('Display name')).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('Save is disabled until the name is actually changed, then round-trips', async ({ page }) => {
    const input = page.getByLabel('Display name');
    const original = await input.inputValue();
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeDisabled();

    await input.fill(`${original} `); // trailing space — trims equal, still not dirty per component logic? verify empirically
    await input.fill(`${original}X`);
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByText('Name saved.')).toBeVisible({ timeout: 15_000 });

    // restore
    await input.fill(original);
    await saveBtn.click();
    await expect(page.getByText('Name saved.')).toBeVisible({ timeout: 15_000 });
  });

  test('the photo constraint text and upload control render', async ({ page }) => {
    await expect(page.getByText('JPG, PNG or WebP · up to 2 MB')).toBeVisible();
    await expect(page.getByRole('button', { name: /Upload photo|Change photo/ })).toBeVisible();
  });
});
