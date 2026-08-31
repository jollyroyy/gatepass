import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled } from '../helpers/ui';
import { uniqueTag } from '../helpers/lifecycle';

// P1-44..P1-53: /raise validation (src/pages/HOD/RaisePass.tsx,
// src/lib/raisePassForm.ts). Nothing here submits a valid pass — every case
// asserts an error and stops, so this file creates zero rows.
test.describe('Raise Gate Pass — field validation', () => {
  test.use({ storageState: storageStateFor('hod') });

  async function fillValidBase(page: import('@playwright/test').Page, tag: string) {
    await page.locator('#rp-vendor').fill(`Vendor ${tag}`);
    await page.locator('#rp-carrier').fill('Test Carrier');
    await page.locator('#rp-mobile').fill('9876543210');
    await page.locator('#rp-purpose').fill('Automated validation check');
    const rows = page.locator('.item-row');
    await rows.nth(0).getByLabel('Item Description').fill('Widget');
    await rows.nth(0).getByLabel('Quantity').fill('1');
    await rows.nth(0).getByLabel('Make / Model / Size').fill('Model X');
    await rows.nth(1).getByLabel('Item Description').fill('Widget 2');
    await rows.nth(1).getByLabel('Quantity').fill('1');
    await rows.nth(1).getByLabel('Make / Model / Size').fill('Model X');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await rows.nth(0).getByLabel('Expected Return Date').fill(tomorrow);
    await rows.nth(1).getByLabel('Expected Return Date').fill(tomorrow);
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/raise');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Submit Request' })).toBeEnabled();
  });

  test('P1-44a Vendor Name required', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('#rp-vendor').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Vendor name is required.')).toBeVisible();
    await page.locator('#rp-vendor').fill(`Vendor ${tag}`);
    // error is not re-validated live; it only clears on next submit attempt
  });

  test('P1-44b Person Who Will Carry required', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('#rp-carrier').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter the name of the person who will carry the material.')).toBeVisible();
  });

  test('P1-44c Mobile Number required', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('#rp-mobile').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Mobile number is required.')).toBeVisible();
  });

  test('P1-44d Purpose / Description required', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('#rp-purpose').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Purpose / description is required.')).toBeVisible();
  });

  test('P1-44e per-item Item Description / Quantity / Make-Model required', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const row = page.locator('.item-row').nth(1);
    await row.getByLabel('Item Description').fill('');
    await row.getByLabel('Quantity').fill('');
    await row.getByLabel('Make / Model / Size').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Item description is required.')).toBeVisible();
    await expect(page.getByText('Enter a quantity greater than 0.')).toBeVisible();
    await expect(page.getByText('Make / model / size is required.')).toBeVisible();
  });

  test('P1-44f Expected Return Date required for RGP', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('.item-row').nth(0).getByLabel('Expected Return Date').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Return date is required for a Returnable Gate Pass.')).toBeVisible();
  });

  test('P1-45 mobile number boundaries: 6/7/15/16 digits', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    // THE VENDOR IS LEFT EMPTY ON PURPOSE. Every other field here is valid, so
    // the two ACCEPTED lengths below would submit the form and raise a real,
    // permanent pass — and the success modal's overlay would then swallow the
    // next click. One unrelated invalid field keeps the form on screen while
    // still running the whole of `validateRaiseForm`, so the mobile rule can be
    // read four times without writing a row.
    await page.locator('#rp-vendor').fill('');
    const mobile = page.locator('#rp-mobile');
    const submit = page.getByRole('button', { name: 'Submit Request' });
    const badMobile = page.getByText('Enter a valid mobile number.');

    await mobile.fill('123456');
    await submit.click();
    await expect(badMobile).toBeVisible();

    await mobile.fill('1234567');
    await submit.click();
    await expect(badMobile).toHaveCount(0);

    await mobile.fill('123456789012345');
    await submit.click();
    await expect(badMobile).toHaveCount(0);

    await mobile.fill('1234567890123456');
    await submit.click();
    await expect(badMobile).toBeVisible();

    // The form never left the screen, so nothing was raised.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Vendor name is required.')).toBeVisible();
  });

  // The dial code is NOT part of the number. `joinMobile` stores one string,
  // and counting `+971` as three subscriber digits shrank a Gulf supplier's
  // allowance to thirteen. See tests/unit/raiseMobileLength.test.ts.
  test('P1-45b a longer dial code does not shrink the allowance', async ({ page }) => {
    await fillValidBase(page, uniqueTag('VAL'));
    await page.locator('#rp-vendor').fill('');
    await page.getByLabel('Country code').selectOption('+971');
    await page.locator('#rp-mobile').fill('123456789012345');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a valid mobile number.')).toHaveCount(0);
  });

  test('P1-46 quantity whole-unit split error', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const row = page.locator('.item-row').nth(0);
    await row.getByLabel('Unit').selectOption('nos');
    await row.getByLabel('Quantity').fill('2.5');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Numbers cannot be split — enter 2 or 3.')).toBeVisible();

    await row.getByLabel('Quantity').fill('0.5');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Numbers cannot be split — enter 1.')).toBeVisible();
  });

  test('P1-47 quantity fractional unit (Kg) allows small decimals', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const row = page.locator('.item-row').nth(0);
    await row.getByLabel('Unit').selectOption('kg');
    await row.getByLabel('Quantity').fill('0.01');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a quantity greater than 0.')).toHaveCount(0);
    await expect(page.getByText(/cannot be split/)).toHaveCount(0);
  });

  test('P1-48 quantity zero and negative are rejected', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const row = page.locator('.item-row').nth(0);
    await row.getByLabel('Quantity').fill('0');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a quantity greater than 0.')).toBeVisible();

    await row.getByLabel('Quantity').fill('-1');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a quantity greater than 0.')).toBeVisible();
  });

  test('P1-49 Approx. Value optional and boundary', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const row = page.locator('.item-row').nth(0);
    await row.getByLabel('Approx. Value (Rs)').fill('-1');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a value of 0 or more, or leave it blank.')).toBeVisible();

    await row.getByLabel('Approx. Value (Rs)').fill('0');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Enter a value of 0 or more, or leave it blank.')).toHaveCount(0);
  });

  test('P1-51 Expected Return Date cannot be in the past (bypassing native min)', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // `fill()`, not an `el.value =` assignment. React installs its own setter
    // on the input's value property, so a raw assignment updates the DOM and
    // leaves React state untouched — the form still holds tomorrow's date and
    // the rule under test never sees the past one. `fill()` goes through the
    // real input path, and a date input accepts a value below its `min`.
    const field = page.locator('.item-row').nth(0).getByLabel('Expected Return Date');
    await field.fill(yesterday);
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Return date cannot be in the past.')).toBeVisible();
  });

  test('P1-52 add/remove item rows renumber correctly', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Another Item' }).click();
    await page.getByRole('button', { name: 'Add Another Item' }).click();
    await page.getByRole('button', { name: 'Add Another Item' }).click();
    await expect(page.locator('.item-row')).toHaveCount(5);

    // Removing renumbers: five rows minus one leaves FOUR remove buttons,
    // numbered 1..4, and the fifth is gone. (The earlier expectation that
    // "Remove item 4" disappears was simply wrong — it is row four of four.)
    await page.getByRole('button', { name: 'Remove item 3' }).click();
    await expect(page.locator('.item-row')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Remove item 4' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remove item 5' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove item 4' }).click();
    await page.getByRole('button', { name: 'Remove item 3' }).click();
    await page.getByRole('button', { name: 'Remove item 2' }).click();
    // The LAST row cannot be removed — MaterialItemsCard draws no button for it.
    await expect(page.locator('.item-row')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remove item 1' })).toHaveCount(0);
  });

  test('P1-53 Add Another Item clears prior per-item errors', async ({ page }) => {
    const tag = uniqueTag('VAL');
    await fillValidBase(page, tag);
    await page.locator('.item-row').nth(1).getByLabel('Item Description').fill('');
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByText('Item description is required.')).toBeVisible();

    await page.getByRole('button', { name: 'Add Another Item' }).click();
    await expect(page.getByText('Item description is required.')).toHaveCount(0);
  });
});
