import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag, tomorrow, approveThroughLadder } from '../helpers/lifecycle';
import { settled, expectPath } from '../helpers/ui';

// P1-42, P1-43, P1-54..P1-58, P1-61: /raise happy paths, the success modal, and
// non-validation behaviour. Each test raises at most one pass.
test.describe('Raise Gate Pass — happy paths and success modal', () => {
  test.use({ storageState: storageStateFor('hod') });

  test('P1-42 happy path RGP: real pass number and View Pass navigation', async ({ page, pageLog }) => {
    const { passNumber, passId } = await raisePass(page, { vendor: `Vendor ${uniqueTag('HP')}` });
    expect(passNumber).toMatch(/^RGP-E2E-\d{4,}$/);

    const modal = page.getByRole('dialog');
    await modal.getByRole('link', { name: 'View Pass' }).click();
    await expectPath(page, `/pass/${passId}`);
    await expect(page.getByText(passNumber).first()).toBeVisible();
    expect(pageLog.errors).toEqual([]);
  });

  test('P1-43 happy path NRGP: no Expected Return Date column, correct number format', async ({ page }) => {
    await page.goto('/raise');
    await settled(page);
    await page.getByRole('radio', { name: 'NRGP (Non-Returnable Gate Pass)' }).check();
    await expect(page.getByLabel('Expected Return Date')).toHaveCount(0);

    const { passNumber } = await raisePass(page, { type: 'NRGP', vendor: `Vendor ${uniqueTag('HP')}` });
    expect(passNumber).toMatch(/^NRGP-E2E-\d{4,}$/);
  });

  test('P1-54 special characters in Vendor Name are accepted', async ({ page }) => {
    const vendor = `Acme, Traders (Pvt.) Ltd. ${uniqueTag('SC')}`;
    const { passNumber } = await raisePass(page, { vendor });
    expect(passNumber).toMatch(/^RGP-/);
  });

  test('P1-55 Cancel navigates away immediately with no confirmation dialog', async ({ page, pageLog }) => {
    await page.goto('/raise');
    await settled(page);
    await page.locator('#rp-vendor').fill('Abandoned Vendor');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expectPath(page, '/dashboard');
    expect(pageLog.dialogs).toEqual([]);
  });

  test('P1-56 success modal: Send to Vendor links to wa.me', async ({ page }) => {
    await raisePass(page, { vendor: `Vendor ${uniqueTag('HP')}`, mobile: '9876543210' });
    const modal = page.getByRole('dialog');
    const link = modal.getByRole('link', { name: 'Send to Vendor' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\//);
  });

  test('P1-57 success modal Escape closes without navigating or resetting the form', async ({ page }) => {
    const { vendor } = await raisePass(page, { vendor: `Vendor ${uniqueTag('HP')}` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expectPath(page, '/raise');
    await expect(page.locator('#rp-vendor')).toHaveValue(vendor);
  });

  test('P1-58 Pass Type radiogroup responds to arrow keys', async ({ page }) => {
    await page.goto('/raise');
    await settled(page);
    const rgpRadio = page.getByRole('radio', { name: 'RGP (Returnable Gate Pass)' });
    const nrgpRadio = page.getByRole('radio', { name: 'NRGP (Non-Returnable Gate Pass)' });
    await expect(rgpRadio).toBeChecked();
    await rgpRadio.focus();
    await page.keyboard.press('ArrowDown');
    await expect(nrgpRadio).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(rgpRadio).toBeChecked();
  });

  test('P1-61 no departments assigned shows the whole-form error', async ({ as }) => {
    // The e2e cast's `hod`/`hod2`/`deputy` accounts are all department-assigned
    // by seed design, so this precondition (zero hod_departments rows) cannot be
    // produced without editing the cast itself, which is out of bounds for a
    // generator spec. Documented as a data gap; left unimplemented rather than
    // mutate a shared account's department assignment.
    test.skip(true, 'requires an HOD account with zero hod_departments rows; no such e2e account exists');
    void as;
  });

  test('P1-59 Raise It Again prefills from a rejected pass, and submitting it leaves the original untouched', async ({ page, browser }) => {
    // hod/review.spec.ts's rejected-pass fixture is shared by its own re-raise
    // (prefill only, never submitted) test — submitting a re-raise there would
    // race that spec's serial suite. This test owns its own rejected pass
    // instead, so it is free to carry the re-raise all the way to submission.
    //
    // P1-60 (supersede) no longer applies: migration 070 made a guard's
    // rejection final and dropped `hod_review_flagged_pass`, and
    // `voidSupersededPass` (src/pages/HOD/useReraisePass.ts) now voids ONLY an
    // expired source pass — a rejected one is already closed, so re-raising it
    // calls no RPC against it at all. This test instead proves that: the
    // original's /mismatch page reads exactly the same after the replacement
    // is submitted as before.
    const { passNumber, passId } = await raisePass(page, { vendor: `Vendor ${uniqueTag('SUP')}` });
    await approveThroughLadder(browser, passNumber);

    const guardCtx = await browser.newContext({ storageState: storageStateFor('guard') });
    const gp = await guardCtx.newPage();
    await gp.goto(`/verify/${passId}`);
    await settled(gp);
    await gp.getByRole('button', { name: 'Reject Pass' }).click();
    await gp.getByLabel('Reason for rejecting *').fill('Only part of the declared material is present.');
    await gp.getByRole('button', { name: 'Reject and Cancel Pass' }).click();
    await expect(gp.getByRole('button', { name: 'Reject Pass' })).toHaveCount(0, { timeout: 15_000 });
    await guardCtx.close();

    await page.goto(`/mismatch/${passId}`);
    await settled(page);
    await page.getByRole('button', { name: 'Raise It Again' }).click();
    await expectPath(page, '/raise');
    await expect(page.getByRole('heading', { name: /Raise Gate Pass Again/ })).toBeVisible();
    // Prefilled from the rejected pass.
    await expect.poll(async () => (await page.locator('#rp-vendor').inputValue()).length, { timeout: 15_000 }).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Close' }).click();

    // The original pass is unaffected — still the same closed, single-action
    // screen, not a "no longer awaiting" fallback (there is no such state
    // any more; MismatchReview has no decidability check left to fail).
    await page.goto(`/mismatch/${passId}`);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'This pass is cancelled' })).toBeVisible();
  });

  test('valid pass with Kg fractional quantity and an approx. value of 0 submits cleanly', async ({ page }) => {
    const { passNumber } = await raisePass(page, {
      vendor: `Vendor ${uniqueTag('HP')}`,
      items: [{ name: `Item ${uniqueTag('IT')}`, qty: '0.01', unit: 'kg', makeModel: 'Model X', value: '0', returnDate: tomorrow() }],
    });
    expect(passNumber).toMatch(/^RGP-/);
  });
});
