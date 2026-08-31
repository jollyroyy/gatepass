import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled, withNoNativeDialog } from '../helpers/ui';
import { uniqueTag } from '../helpers/lifecycle';

/**
 * `uniqueTag()` (`tests/e2e/helpers/lifecycle.ts`) formats as
 * `PREFIX-<base36 timestamp>-<base36 random>` — the hyphens survive any
 * `.slice()` taken from the tail of the string. A department CODE is
 * `DEPT_CODE_ALLOWED = /^[A-Z0-9]+$/` (`src/lib/nameValidation.ts`), which a
 * hyphen violates, so slicing straight off `uniqueTag()` produced codes like
 * "E2-NA8NZ" that the Add Department form's own client-side validator
 * rejected — the modal never submitted and the dialog never closed. Strip
 * non-alphanumerics before slicing so the generated code can only ever match
 * the charset the form itself enforces.
 */
function deptCode(prefix: string): string {
  return `${prefix}${uniqueTag().replace(/[^A-Z0-9]/gi, '').slice(-6)}`.slice(0, 10).toUpperCase();
}

/**
 * A person's Full Name is judged by `personNameError` / the `profiles`
 * charset check — letters, spaces, `.`, `'`, `-` only, NO DIGITS
 * (`src/lib/nameValidation.ts`). `uniqueTag()` is base36 and always contains
 * digits, so using it directly in a display name trips that client-side
 * validator and the Add User dialog never closes — this is the confirmed app
 * bug reported separately (client validator and department-name validator
 * both disagree with the `profiles` charset). This maps digits to letters so
 * throwaway names stay unique without hitting it, letting the rest of the
 * test exercise the real behaviour under test.
 */
const DIGIT_LETTER: Record<string, string> = {
  '0': 'A', '1': 'B', '2': 'C', '3': 'D', '4': 'E', '5': 'F', '6': 'G', '7': 'H', '8': 'I', '9': 'J',
};
function personTag(): string {
  return uniqueTag().split('').map((c) => DIGIT_LETTER[c] ?? c).join('');
}

/**
 * Departments tab (W1-W4). Every department this file creates carries a
 * unique E2E- prefix and is deleted (or left as a pending-request, which is
 * itself the assertion) within the SAME test — never IT/FIN/MR/E2E/E2E2.
 */
test.describe('Admin > Departments tab', () => {
  test.use({ storageState: storageStateFor('admin') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    await settled(page);
  });

  test('the Awaiting an HOD KPI is not clickable', async ({ page }) => {
    const card = page.getByText('Awaiting an HOD').locator('..');
    // structural: not an <a> or <button>
    await expect(card.locator('a, button')).toHaveCount(0);
  });

  test('P3-16 create department happy path, then a duplicate code is rejected', async ({ page, pageLog }) => {
    const code = deptCode('E2');
    const name = `E2E- ${uniqueTag('DEPT')}`;

    await page.getByRole('button', { name: 'Add Department' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Department' })).toBeVisible();

    await withNoNativeDialog(page, async () => {
      await dialog.getByPlaceholder('e.g. Quality Assurance').fill(name);
      await dialog.getByPlaceholder('e.g. QA').fill(code);
      await dialog.getByRole('button', { name: 'Add Department' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    });

    // list must show the new row
    await page.getByRole('button', { name: 'Show All Departments' }).click();
    await settled(page);
    await expect(page.getByTestId('department-rows').getByText(name)).toBeVisible();

    // duplicate code
    await page.getByRole('button', { name: 'Add Department' }).click();
    const dialog2 = page.getByRole('dialog');
    await dialog2.getByPlaceholder('e.g. Quality Assurance').fill(`${name} 2`);
    await dialog2.getByPlaceholder('e.g. QA').fill(code);
    await dialog2.getByRole('button', { name: 'Add Department' }).click();
    await expect(page.getByText(`Department "${code}" already exists.`)).toBeVisible({ timeout: 15_000 });
    await dialog2.getByRole('button', { name: 'Cancel' }).click();

    // clean up: delete the department we just created (it has no HOD -> immediate delete)
    const row = page.getByTestId('department-rows').locator('div', { hasText: name }).first();
    await row.getByTitle('Delete department').click();
    const del = page.getByRole('dialog');
    await expect(del.getByRole('heading', { name: 'Delete Department?' })).toBeVisible();
    await del.getByPlaceholder('e.g. Department merged with Finance').fill('E2E cleanup');
    await withNoNativeDialog(page, async () => {
      await del.getByRole('button', { name: 'Delete Department' }).click();
      await expect(del).toBeHidden({ timeout: 15_000 });
    });
    await expect(page.getByTestId('department-rows').getByText(name)).toHaveCount(0);
    expect(pageLog.errors).toEqual([]);
  });

  test('P3-17 deleting a department with an HOD creates a pending request, not an immediate delete', async ({ page }) => {
    // Every cast HOD (e2e.hod, e2e.hod2, e2e.deputy) already heads a real
    // department (E2E/E2E2) and "one department per person" (migration 032)
    // means assigning any of them here would silently MOVE them off it and
    // break every other spec that depends on their department. So this test
    // creates its own disposable @e2e.local HOD, assigns THAT account, and
    // never touches a cast member's department at all.
    const code = deptCode('E3');
    const name = `E2E- ${uniqueTag('HODDEPT')}`;
    const throwawayEmail = `e2e.dept-hod.${uniqueTag().toLowerCase()}@e2e.local`;
    const throwawayName = `E2E Throwaway HOD ${personTag()}`;

    await page.getByRole('button', { name: 'Add Department' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('e.g. Quality Assurance').fill(name);
    await dialog.getByPlaceholder('e.g. QA').fill(code);
    await dialog.getByRole('button', { name: 'Add Department' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Create a throwaway HOD via Users tab so it exists to assign.
    await page.getByRole('button', { name: 'Users' }).click();
    await settled(page);
    await page.getByRole('button', { name: 'Add User' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('user@company.com').fill(throwawayEmail);
    await dialog.getByPlaceholder('Min 6 characters').fill(`Thr0waway-${uniqueTag()}!`);
    await dialog.getByPlaceholder('Jane Doe').fill(throwawayName);
    await dialog.getByRole('button', { name: 'Create User' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Departments' }).click();
    await settled(page);
    await page.getByRole('button', { name: 'Assign HOD' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Assign HOD' })).toBeVisible();
    const selects = dialog.locator('select');
    // selectOption's `label` is an EXACT string match, never a RegExp — the
    // typed overload has no regex form. Resolve the option by its own text and
    // pass the value it carries.
    await selects.nth(0).selectOption(
      await selects.nth(0).locator('option', { hasText: throwawayName }).first().getAttribute('value') ?? '',
    );
    await selects.nth(1).selectOption(
      await selects.nth(1).locator('option', { hasText: name }).first().getAttribute('value') ?? '',
    );
    await dialog.getByRole('button', { name: 'Assign HOD' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Show All Departments' }).click();
    await settled(page);
    const row = page.getByTestId('department-rows').locator('div', { hasText: name }).first();
    await row.getByTitle('Delete department').click();
    const del = page.getByRole('dialog');
    await expect(del.getByText(/is headed by/)).toBeVisible();
    await del.getByPlaceholder('e.g. Department merged with Finance').fill('E2E cleanup — will withdraw');
    await expect(del.getByRole('button', { name: 'Send Deletion Request' })).toBeVisible();
    await del.getByRole('button', { name: 'Send Deletion Request' }).click();
    await expect(del).toBeHidden({ timeout: 15_000 });

    await expect(page.getByText('Deletion waiting with the HOD')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('department-rows').getByText(name)).toBeVisible();

    // withdraw so nothing is left pending for the HOD account
    await page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(page.getByText('Deletion waiting with the HOD')).toHaveCount(0, { timeout: 15_000 });

    // No unassign control exists in DepartmentsTab's UI, so this department
    // and its throwaway HOD are left in place — both uniquely named and
    // disposable, neither a cast account nor a protected department.
  });

  test('KPI: Heads of Department toggles the HOD directory', async ({ page }) => {
    const kpi = page.getByRole('button', { name: /Heads of Department/ });
    await kpi.click();
    await expect(page.getByRole('heading', { name: 'Heads of Department' })).toBeVisible();
    await kpi.click();
    await expect(page.getByRole('heading', { name: 'Heads of Department' })).toHaveCount(0);
  });

  test('list-hidden and empty-toggle states render the documented copy', async ({ page }) => {
    await expect(page.getByText('Click "Show All Departments" to view the department directory.')).toBeVisible();
  });
});
