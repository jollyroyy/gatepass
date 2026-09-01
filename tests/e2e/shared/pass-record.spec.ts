import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { raisePass, uniqueTag } from '../helpers/lifecycle';
import { settled } from '../helpers/ui';

/**
 * Pass record view (`src/components/passview/**`) at `/pass/:id`. One RGP is
 * raised once and reused across this file's tests (a raised pass is
 * permanent — CONVENTIONS.md — so create the minimum).
 */
test.describe.configure({ mode: 'serial' });

test.describe('Pass record — as the raising HOD, before any approval', () => {
  test.use({ storageState: storageStateFor('hod') });

  let passId = '';
  let passNumber = '';
  const itemName = `Item ${uniqueTag('PR')}`;

  test('raise the fixture pass', async ({ page }) => {
    const raised = await raisePass(page, { items: [{ name: itemName, qty: '4', unit: 'nos', makeModel: 'PR Model' }] });
    passId = raised.passId;
    passNumber = raised.passNumber;
    expect(passNumber).toMatch(/^RGP-/);
  });

  test('the record root renders with the pass number, and no console errors', async ({ page, pageLog }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    const record = page.getByTestId('pass-record');
    await expect(record).toBeVisible();
    await expect(record.getByText(passNumber)).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('Send to Vendor is offered to the raising HOD (readerRole=hod)', async ({ page }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    // It is a BUTTON now, not a link (2026-09-01): what it sends is the
    // printed slip photographed off `PassSlip`, handed to the device's share
    // sheet — a plain `wa.me` href cannot carry an attachment. Pressing it is
    // deliberately NOT exercised here: it opens the OS share sheet or starts a
    // download, neither of which Playwright should be made to answer.
    const share = page.getByTestId('share-whatsapp');
    await expect(share).toBeVisible();
    await expect(share).toBeEnabled();
    await expect(share).toHaveText(/Send to Vendor/);
  });

  test('Copy pass number toggles its accessible name', async ({ page }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    const copyBtn = page.getByRole('button', { name: 'Copy pass number' });
    await copyBtn.click();
    await expect(page.getByRole('button', { name: 'Pass number copied' })).toBeVisible();
  });

  test('a quantity cell always names its unit, and the header stays bare', async ({ page }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    const header = page.getByRole('columnheader', { name: 'Quantity' });
    await expect(header).toHaveText('Quantity');
    // Not `.filter({ hasText: /\d/ }).first()` — `itemName` is built from
    // `uniqueTag()`, which is base36 and always contains digits, so the Item
    // cell (PassRecordItems.tsx: #, Item, Description, Make/Model, Serial/ID,
    // Quantity, …) itself has a digit and was winning that filter before the
    // real Quantity cell ever got checked. Address the column by its fixed
    // position instead.
    const cells = page.getByRole('row', { name: new RegExp(itemName) }).getByRole('cell');
    const cell = cells.nth(5); // 0:#, 1:Item, 2:Description, 3:Make/Model, 4:Serial/ID, 5:Quantity
    await expect(cell).toContainText(/\d+\s*\S*nos|\d+\s+\S+/i);
  });

  test('ApprovalDecisionBar and EmergencyReleaseBar are absent for the raising HOD', async ({ page }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    await expect(page.getByTestId('record-approval-actions')).toHaveCount(0);
    await expect(page.getByTestId('emergency-release')).toHaveCount(0);
  });

  test('the timeline shows nothing recorded at the gate yet, for a pending pass', async ({ page }) => {
    await page.goto(`/pass/${passId}`);
    await settled(page);
    await expect(page.getByTestId('pass-timeline')).toBeVisible();
    await expect(page.getByText('Nothing recorded at the gate yet.')).toBeVisible();
  });

  test('the Security Head sees the pending approval sentence, not the raising HOD\'s actions', async ({ as }) => {
    const sec = await as('secHead');
    await sec.page.goto(`/pass/${passId}`);
    await settled(sec.page);
    await expect(sec.page.getByTestId('record-approval-actions')).toBeVisible();
    const bar = sec.page.getByTestId('record-approval-actions');
    await expect(bar.getByRole('button', { name: 'Approve' })).toBeVisible();
  });

  test('a non-routed approver (Finance HOD) sees no Approve/Reject before their turn', async ({ as }) => {
    const fin = await as('finHead');
    await fin.page.goto(`/pass/${passId}`);
    await settled(fin.page);
    const bar = fin.page.getByTestId('record-approval-actions');
    // Either absent, or present without action buttons (sentence-only variant).
    if (await bar.count()) {
      await expect(bar.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    }
  });
});
