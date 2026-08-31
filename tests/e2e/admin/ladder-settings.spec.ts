import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled, withNoNativeDialog } from '../helpers/ui';
import { uniqueTag } from '../helpers/lifecycle';

/**
 * Functional Roles, Approval Ladder (VIEW ONLY — never reseats an office),
 * App/Mail Settings (change-then-revert), Super Admins card, Blacklist and
 * Whitelist. All settings changes are read back and restored in the same test.
 */
test.describe('Admin > Functional Roles and Approval Ladder', () => {
  test.use({ storageState: storageStateFor('admin') });

  test('Functional Roles tab renders the role/office inventory', async ({ page, pageLog }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Functional Roles' }).click();
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Functional Roles' })).toBeVisible();
    await expect(page.getByTestId('functional-role-list')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Role Holder' })).toBeVisible();
    expect(pageLog.errors).toEqual([]);
  });

  test('Approval Ladder card renders every office and its controls, without reseating any', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Gate pass approval ladder' })).toBeVisible();
    for (const title of ['Security Head', 'Finance HOD', 'COO', 'CEO']) {
      await expect(page.getByText(new RegExp(`Level \\d · ${title}`))).toBeVisible();
      await expect(page.getByLabel(`${title} account`)).toBeVisible();
      // 068 withdrew the standing deputy — one office, one select.
      await expect(page.getByLabel(`${title} deputy`)).toHaveCount(0);
    }
  });

  test('Super Admins card renders the fallback holders', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Super administrators' })).toBeVisible();
    await expect(page.getByTestId('super-admins')).toBeVisible();
  });
});

test.describe('Admin > App and Mail settings — change then revert', () => {
  test.use({ storageState: storageStateFor('admin') });

  test('P3-25 session timeout round-trips through save and reload, then is restored', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);

    const field = page.locator('#app-session-timeout');
    const original = await field.inputValue();

    await field.fill('37');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);
    await expect(page.locator('#app-session-timeout')).toHaveValue('37');

    // restore
    await page.locator('#app-session-timeout').fill(original || '');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 });
  });

  test('the 2FA checkbox toggles and persists but the app does not claim it enforces anything', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);

    const checkbox = page.getByRole('checkbox', { name: 'Require two-factor authentication for approvers' });
    const before = await checkbox.isChecked();
    await checkbox.setChecked(!before);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);
    await expect(page.getByRole('checkbox', { name: 'Require two-factor authentication for approvers' })).toBeChecked({ checked: !before });

    // restore
    await page.getByRole('checkbox', { name: 'Require two-factor authentication for approvers' }).setChecked(before);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 });
  });

  test('Mail settings card renders and the SMTP password field never pre-fills', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settled(page);
    await expect(page.getByRole('heading', { name: 'Approval email' })).toBeVisible();
    await expect(page.locator('#mail-smtp-password')).toHaveValue('');
  });
});

test.describe('Admin > Blacklist and Whitelist', () => {
  test.use({ storageState: storageStateFor('admin') });

  test('P3-27 blank fields are validated, then add succeeds and no removal control exists', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Blacklist' }).click();
    await settled(page);

    await page.getByRole('button', { name: 'Add Entry' }).click();
    await page.getByRole('button', { name: 'Add to Blacklist' }).click();
    await expect(page.getByText('Vendor name is required.')).toBeVisible();
    await expect(page.getByText('Reason is required.')).toBeVisible();

    const vendor = `E2E Vendor ${uniqueTag()}`;
    await page.getByLabel('Vendor Name').fill(vendor);
    await page.getByLabel('Reason for blacklisting').fill('E2E test blacklist entry');
    await page.getByRole('button', { name: 'Add to Blacklist' }).click();
    await settled(page);
    const row = page.locator('tr', { hasText: vendor });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // no delete/remove control exists on the row (039 dropped removal)
    await expect(row.getByRole('button', { name: /remove|delete/i })).toHaveCount(0);

    return vendor;
  });

  test('P3-28 whitelist request validation, and a non-CEO sees no decision controls', async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
    await page.getByRole('button', { name: 'Blacklist' }).click();
    await settled(page);

    const vendor = `E2E Whitelist ${uniqueTag()}`;
    await page.getByRole('button', { name: 'Add Entry' }).click();
    await page.getByLabel('Vendor Name').fill(vendor);
    await page.getByLabel('Reason for blacklisting').fill('E2E test — will request whitelist');
    await page.getByRole('button', { name: 'Add to Blacklist' }).click();
    await settled(page);

    const row = page.locator('tr', { hasText: vendor });
    await row.getByRole('button', { name: 'Request Whitelist' }).click();
    await row.getByRole('button', { name: 'Send for CEO Approval' }).click();
    await expect(page.getByText('A justification is required — say why this vendor should be whitelisted.')).toBeVisible();
    await row.getByPlaceholder('Why should this vendor be whitelisted?').fill('short');
    await row.getByRole('button', { name: 'Send for CEO Approval' }).click();
    await expect(page.getByText('Please give at least 10 characters of justification.')).toBeVisible();
    await row.getByPlaceholder('Why should this vendor be whitelisted?').fill('A justification long enough to pass validation.');
    await withNoNativeDialog(page, async () => {
      await row.getByRole('button', { name: 'Send for CEO Approval' }).click();
      await expect(page.getByText('Awaiting CEO approval')).toBeVisible({ timeout: 15_000 });
    });

    // admin is not CEO: expand the Whitelist tab card, decision controls absent
    await page.getByRole('button', { name: 'Whitelist of Vendors' }).click();
    await settled(page);
    await expect(page.getByText('Only the designated CEO can approve or reject a whitelist request. You can still review them below.')).toBeVisible();
    const card = page.getByRole('button', { name: new RegExp(vendor) });
    await card.click();
    const body = page.getByTestId('whitelist-request-details');
    await expect(body).toBeVisible();
    await expect(body.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(body.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });
});

test.describe('Admin > Whitelist decision as CEO', () => {
  test.use({ storageState: storageStateFor('ceo') });

  test('the CEO can reject a whitelist request with a reason', async ({ browser }) => {
    // Seed the blacklist entry + request as admin first.
    const adminCtx = await browser.newContext({ storageState: storageStateFor('admin') });
    const adminPage = await adminCtx.newPage();
    const vendor = `E2E CEO-Reject ${uniqueTag()}`;
    await adminPage.goto('/admin');
    await settled(adminPage);
    await adminPage.getByRole('button', { name: 'Blacklist' }).click();
    await adminPage.getByRole('button', { name: 'Add Entry' }).click();
    await adminPage.getByLabel('Vendor Name').fill(vendor);
    await adminPage.getByLabel('Reason for blacklisting').fill('E2E test — CEO will reject');
    await adminPage.getByRole('button', { name: 'Add to Blacklist' }).click();
    await settled(adminPage);
    const row = adminPage.locator('tr', { hasText: vendor });
    await row.getByRole('button', { name: 'Request Whitelist' }).click();
    await row.getByPlaceholder('Why should this vendor be whitelisted?').fill('A justification long enough for the floor.');
    await row.getByRole('button', { name: 'Send for CEO Approval' }).click();
    await expect(adminPage.getByText('Awaiting CEO approval')).toBeVisible({ timeout: 15_000 });
    await adminCtx.close();

    const ctx = await browser.newContext({ storageState: storageStateFor('ceo') });
    const page = await ctx.newPage();
    await page.goto('/whitelist');
    await settled(page);
    const card = page.getByRole('button', { name: new RegExp(vendor) });
    await card.click();
    const body = page.getByTestId('whitelist-request-details');
    await body.getByRole('button', { name: 'Reject' }).click();
    await body.getByRole('button', { name: 'Submit Rejection' }).click();
    await expect(body.getByText('A reason is required.')).toBeVisible();
    await body.getByPlaceholder('Reason for rejecting').fill('E2E automated rejection');
    await withNoNativeDialog(page, async () => {
      await body.getByRole('button', { name: 'Submit Rejection' }).click();
    });
    await ctx.close();
  });
});
