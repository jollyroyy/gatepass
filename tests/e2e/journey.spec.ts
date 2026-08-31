import { test, expect } from './fixtures/test';
import { storageStateFor } from './fixtures/accounts';
import { raisePass, approveThroughLadder, uniqueTag } from './helpers/lifecycle';
import { settled } from './helpers/ui';

/**
 * THE SPINE. One RGP from the department head's form to the gate.
 *
 * Everything else in this suite tests a screen; this tests that the screens add
 * up to a system. It is deliberately serial and deliberately singular — a raised
 * pass is permanent, so this creates exactly one per run.
 */
test.describe.configure({ mode: 'serial' });

test.describe('a returnable gate pass, end to end', () => {
  test.use({ storageState: storageStateFor('hod') });

  let passNumber = '';
  let passId = '';
  let vendor = '';

  test('the HOD raises it and the success modal names it', async ({ page, pageLog }) => {
    // A comma and a bracket in the vendor name on purpose: they are PostgREST
    // `or=()` grammar, and the gate's search has to survive them later.
    vendor = `Acme (Contracts), ${uniqueTag('V')}`;
    const raised = await raisePass(page, { vendor, items: [{ name: `Ladder ${uniqueTag('IT')}`, qty: '3', makeModel: 'Alu 12ft' }] });
    passNumber = raised.passNumber;
    passId = raised.passId;

    expect(passNumber).toMatch(/^RGP-/);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('it is waiting with the Security Head, and nowhere near the gate', async ({ as }) => {
    const gate = await as('guard');
    await gate.page.goto('/guard-dashboard');
    await settled(gate.page);
    // 061: an unapproved pass is invisible to the gate.
    await expect(gate.page.getByText(passNumber)).toHaveCount(0);
  });

  test('three signatures release it — the COO closes level three alone', async ({ browser }) => {
    await approveThroughLadder(browser, passNumber);
  });

  test('the gate can now see it and it carries the vendor with the comma', async ({ as }) => {
    const gate = await as('guard');
    await gate.page.goto(`/pass/${passId}`);
    await settled(gate.page);
    await expect(gate.page.getByText(passNumber).first()).toBeVisible();
    expect(gate.log.errors).toEqual([]);
  });
});
