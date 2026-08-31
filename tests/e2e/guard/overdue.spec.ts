import { test, expect } from '../fixtures/test';
import { storageStateFor } from '../fixtures/accounts';
import { settled, expectPath } from '../helpers/ui';

/**
 * P2 §1 "Routes and who may reach them" (route guard, no fixture needed) and
 * §2.9 / §6 "Overdue" (`OverduePassBoard`, `OverdueCardMenu`, `RemarkBox`).
 *
 * An overdue RGP cannot be manufactured through the UI/RPC surface — the raise
 * form will not accept a past Expected Return Date, and the plan (§7) directs
 * this exact case to `test.fixme()` rather than a direct SQL write. The
 * data-dependent cases below run adaptively against whatever overdue rows
 * already exist for the E2E cast (a raised pass is permanent, so past runs
 * may have left real ones) and are skipped, not failed, when there are none —
 * the structural/route-guard assertions never depend on that data.
 */
test.describe('Guard route guard', () => {
  test.use({ storageState: storageStateFor('guard') });

  test('cannot reach /admin (P2-01)', async ({ page }) => {
    await page.goto('/admin');
    await expectPath(page, '/guard-dashboard');
  });

  test('cannot reach /raise (P2-02)', async ({ page }) => {
    await page.goto('/raise');
    await expectPath(page, '/guard-dashboard');
  });

  test('cannot reach /dashboard, the HOD\'s home (P2-03)', async ({ page }) => {
    await page.goto('/dashboard');
    await expectPath(page, '/guard-dashboard');
  });

  test('the sidebar carries exactly one tab: Dashboard (P2-04)', async ({ page }) => {
    // ROLE_ROUTES.guard lists 7 paths, but sidebarLinks.tsx gives the guard
    // only ONE nav entry — every other route (Overdue, Search Pass, Returns)
    // is reached by drilling a KPI figure, never a sidebar tab (client,
    // 2026-08-19..23; see the comments above the guard's ALL_LINKS entry in
    // src/components/layout/sidebarLinks.tsx). Confirmed against the source
    // directly, not assumed from ROLE_ROUTES.
    //
    // NOT using helpers/ui.ts's sidebarLinks() here: it selects every
    // `.shell-sidebar a[href]`, which also catches the brand wordmark Link
    // (href="/", Sidebar.tsx navContent) and the profile-block Link
    // (href="/profile", SidebarProfile.tsx) — neither is a nav tab. The real
    // nav tabs are the only anchors carrying Sidebar.tsx's own `sidebar-link`
    // class (`className="sidebar-link ..."` on the Link inside the nav-links
    // map, Sidebar.tsx); the brand and profile links do not carry that class.
    await page.goto('/guard-dashboard');
    await settled(page);
    const navLinks = page.locator('.shell-sidebar a.sidebar-link[href]');
    await expect(navLinks).toHaveCount(1);
    await expect(navLinks.first()).toHaveAttribute('href', '/guard-dashboard');
  });
});

test.describe('/overdue', () => {
  test.use({ storageState: storageStateFor('guard') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/overdue');
    await settled(page);
  });

  test('renders the exact page header, subtitle and no console errors', async ({ page, pageLog }) => {
    await expect(page.getByRole('heading', { name: 'Overdue RGP Gate Passes' })).toBeVisible();
    await expect(page.getByText('RGP gate passes that are past their return deadline.')).toBeVisible();
    expect(pageLog.errors).toEqual([]);
    expect(pageLog.dialogs).toEqual([]);
  });

  test('toggle state matches whether there is anything overdue (P2-85/86)', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /Overdue Passes/ });
    await expect(toggle).toBeVisible();
    const figureText = await toggle.innerText();
    const hasAny = !/^\D*0\D/.test(figureText.replace(/\n/g, ' '));

    if (!hasAny) {
      await expect(toggle).toBeDisabled();
      await expect(
        page.getByText('Nothing is overdue. Every RGP still out is within its return date.')
      ).toBeVisible();
      test.skip(true, 'no overdue rows exist for the E2E cast right now — cannot exercise the open card stack');
      return;
    }

    // Open by default.
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#overdue-stack')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('a guard\'s card menu offers Process RGP Return; an HOD\'s does not (P2-87)', async ({ page, as }) => {
    const total = await page.locator('#overdue-stack .gpo-menu-wrap').count();
    test.skip(total === 0, 'no overdue rows exist for the E2E cast right now');
    const dots = page.locator('#overdue-stack .gpo-menu-wrap').first().getByRole('button', { name: /^Actions for / });
    await dots.click();
    await expect(page.getByRole('menuitem', { name: /Process RGP Return/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Add Guard Remark/ })).toBeVisible();
    await page.keyboard.press('Escape');

    const hod = await as('hod');
    await hod.page.goto('/overdue');
    await settled(hod.page);
    const hodTotal = await hod.page.locator('#overdue-stack .gpo-menu-wrap').count();
    if (hodTotal > 0) {
      await hod.page.locator('#overdue-stack .gpo-menu-wrap').first().getByRole('button', { name: /^Actions for / }).click();
      await expect(hod.page.getByRole('menuitem', { name: /Process RGP Return/ })).toHaveCount(0);
      await expect(hod.page.getByRole('menuitem', { name: 'Add Remark' })).toBeVisible();
    }
  });

  test('Add Guard Remark validates non-empty and auto-closes after save (P2-90)', async ({ page }) => {
    const total = await page.locator('#overdue-stack .gpo-menu-wrap').count();
    test.skip(total === 0, 'no overdue rows exist for the E2E cast right now');
    await page.locator('#overdue-stack .gpo-menu-wrap').first().getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: /Add Guard Remark/ }).click();
    const box = page.getByRole('dialog', { name: /^Add a guard remark on / });
    await expect(box).toBeVisible();
    const save = page.getByRole('button', { name: 'Save Remark' });
    await expect(save).toBeDisabled();
    await box.getByLabel('What happened').fill(`E2E remark ${Date.now()}`);
    await save.click();
    await expect(page.getByText('Remark saved.')).toBeVisible();
    // 900ms auto-close timer (RemarkBox.tsx) — wait for detachment, not a fixed sleep.
    await expect(box).toBeHidden({ timeout: 3000 });
  });

  test('Export Pass PDF opens a new tab to the print route (P2-91)', async ({ page, context }) => {
    const total = await page.locator('#overdue-stack .gpo-menu-wrap').count();
    test.skip(total === 0, 'no overdue rows exist for the E2E cast right now');
    await page.locator('#overdue-stack .gpo-menu-wrap').first().getByRole('button', { name: /^Actions for / }).click();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: /Export Pass PDF/ }).click(),
    ]);
    await expect.poll(() => new URL(popup.url()).pathname, { timeout: 15_000 }).toMatch(/\/pass\/.+\/print$/);
    await popup.close();
  });
});
