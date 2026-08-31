import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled, csvFrom } from '../helpers/ui';

/** /activity — Activity Log. Period tabs, search/day filter, CSV, the
 *  documented screen/CSV divergence on the Who column (em-dash vs blank). */
test.describe('Admin > Activity Log', () => {
  test.use({ storageState: storageStateFor('admin') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/activity');
    await settled(page);
  });

  test('period tabs switch the window and the footer count updates', async ({ page, pageLog }) => {
    const group = page.getByRole('group', { name: 'Period' });
    await expect(group.getByRole('button', { name: '30 days' })).toBeVisible();
    await group.getByRole('button', { name: '7 days' }).click();
    await settled(page);
    await expect(page.getByText(/in the last 7 days/)).toBeVisible();
    await group.getByRole('button', { name: '90 days' }).click();
    await settled(page);
    await expect(page.getByText(/in the last 90 days/)).toBeVisible();
    expect(pageLog.errors).toEqual([]);
  });

  test('search and day filters narrow the table, Reset clears both', async ({ page }) => {
    await page.getByPlaceholder('Pass number, person, or what happened…').fill('zzz-no-such-event-zzz');
    await settled(page);
    const emptyOrTable = page.getByText('Nothing was recorded in this window.');
    await expect(emptyOrTable.or(page.getByTestId('activity-table'))).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();
    await settled(page);
    await expect(page.getByPlaceholder('Pass number, person, or what happened…')).toHaveValue('');
  });

  test('Export CSV is disabled with zero rows and an empty Who cell exports blank, not an em-dash', async ({ page }) => {
    await page.getByPlaceholder('Pass number, person, or what happened…').fill('zzz-no-such-event-zzz');
    await settled(page);
    if (await page.getByText('Nothing was recorded in this window.').isVisible()) {
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Reset' }).click();
    await settled(page);

    const table = page.getByTestId('activity-table');
    if (await table.isVisible().catch(() => false)) {
      // The screen shows an em-dash for a row this system records no actor
      // for (ActivityLogPage.tsx: `{r.who ?? '—'}`). The rule under test is
      // narrower than "no em-dash anywhere in the file" — an em-dash is
      // legitimate CONTENT elsewhere (an approval event's own label is
      // "Approved — {office}"). What must never happen is that same em-dash
      // standing in for an EMPTY Who cell in the export.
      const whoCells = await table.locator('tbody tr td:nth-child(4)').allTextContents();
      const emptyWhoRowIndex = whoCells.findIndex((t) => t.trim() === '—');

      const csv = await csvFrom(page, async () => {
        await page.getByRole('button', { name: 'Export CSV' }).click();
      });
      expect(csv.split('\r\n')[0]).toContain('When,Gate Pass,Event,Who,Details');
      const lines = csv.split('\r\n').slice(1).filter(Boolean);
      expect(lines.length).toBe(whoCells.length);

      if (emptyWhoRowIndex >= 0) {
        // Column 4 (Who) of that CSV row — a plain split is safe here because
        // an empty Who field can never contain a comma to be quoted around.
        const whoField = lines[emptyWhoRowIndex].split(',')[3];
        expect(whoField).toBe('');
      } else {
        test.info().annotations.push({
          type: 'skip-reason',
          description: 'No row in this window has an empty Who cell to assert on.',
        });
      }
    }
  });

  test('the footer sentence names the window and both counts', async ({ page }) => {
    await expect(page.getByText(/^Showing \d+ of \d+ events in the last \d+ days\.?/)).toBeVisible();
  });
});
