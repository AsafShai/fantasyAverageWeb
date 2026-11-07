import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { fixture, mockApi } from './support/mockApi'
import { draftMocks } from './support/draftMocks'

// Step 5 of the mobile redesign: League menu pages (Activity, Draft Report, FA Report) on a phone.
// Draft Report and FA Report sit behind VITE_FF_DRAFT_REPORT, which the e2e build turns off;
// run them with MR_DRAFT_PAGES=1 against a build that has it on.

/** MR_SHOTS=<dir>: save phone-screen captures down the page for the PR (not run in CI). */
async function shots(page: Page, name: string) {
  const dir = process.env.MR_SHOTS
  if (!dir) return
  await page.evaluate(() => document.fonts.ready)
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let i = 0, y = 0; y < height; i += 1, y += 640) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${dir}/${name}-${i}.png` })
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '1'))
})

test('desktop: Activity keeps the old layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/activity?ff=mobile')
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'League activity views' })).toHaveCount(0)
})

test.describe('phone League pages', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('Activity: chip tabs, sheet filters, moves by day', async ({ page }) => {
    await page.goto('/activity?ff=mobile')
    await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible()
    const tabs = page.getByRole('group', { name: 'League activity views' })
    await expect(tabs.getByRole('button')).toHaveText(['Activity', 'Trades', /^Pending trades/, 'Trade tree', 'Released players'])
    await expect(page.getByText(/^\d+ moves · \d+ adds · \d+ drops · \d+ waiver claims · \d+ trades$/)).toBeVisible()
    await expect(page.locator('li[data-mine]').first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'activity-light')

    await page.getByRole('button', { name: 'Type: All moves' }).click()
    const sheet = page.getByRole('dialog', { name: 'Type' })
    await expect(sheet).toBeVisible()
    if (process.env.MR_SHOTS) await page.screenshot({ path: `${process.env.MR_SHOTS}/activity-type-sheet.png` })
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await page.getByRole('button', { name: 'Type: All moves' }).click()
    await sheet.getByRole('option', { name: 'Trades' }).click()
    await expect(page.getByRole('list', { name: 'Moves' }).getByText('Added')).toHaveCount(0)
  })

  test('Activity: trade views still work from the chip tabs', async ({ page }) => {
    await page.goto('/activity?ff=mobile')
    await page.getByRole('group', { name: 'League activity views' }).getByRole('button', { name: 'Trades', exact: true }).click()
    await expect(page).toHaveURL(/tab=trades/)
    await expect(page.getByRole('heading', { name: /⇄/ }).first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'activity-trades')
    for (const name of ['Trade tree', 'Released players']) {
      await page.getByRole('group', { name: 'League activity views' }).getByRole('button', { name, exact: true }).click()
      await expectNoHorizontalScroll(page)
    }
    // Same URL as desktop: switching views replaces ?tab= (no history entry per tab).
    await expect(page).toHaveURL(/tab=released/)
  })

  test('Activity dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await page.goto('/activity?ff=mobile')
    await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible()
    await shots(page, 'activity-dark')
  })

  test.describe('draft pages', () => {
    test.skip(!process.env.MR_DRAFT_PAGES, 'needs VITE_FF_DRAFT_REPORT=true')

    test('Draft Report', async ({ page }) => {
      // Early season: the board has no value heat yet (as in the design).
      await mockApi(page, { ...draftMocks(), '/league/summary': { ...fixture<object>('league-summary'), season_start: '2026-10-21' } })
      await page.goto('/draft-report?ff=mobile')
      await expect(page.getByRole('heading', { level: 1, name: '📝 Draft Report Card' })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Draft board' })).toBeVisible()
      // All Picks follows my team like desktop: 13 picks + the header row.
      await expect(page.getByRole('button', { name: /^Team: Oriel's Otherworldly Team/ })).toBeVisible()
      await expect(page.getByRole('table', { name: 'All picks' }).getByRole('row')).toHaveCount(14)
      await expectNoHorizontalScroll(page)
      await shots(page, 'draft-light')
    })

    test('Draft Report dark, with value heat', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
      await mockApi(page, draftMocks())
      await page.goto('/draft-report?ff=mobile')
      await expect(page.getByRole('table', { name: 'Draft board' })).toBeVisible()
      await shots(page, 'draft-dark')
    })

    test('FA Report', async ({ page }) => {
      await mockApi(page, draftMocks())
      await page.goto('/fa-report?ff=mobile')
      await expect(page.getByRole('heading', { level: 1, name: '🆓 FA Report' })).toBeVisible()
      await expect(page.getByText(/^\d+ players$/)).toBeVisible()
      await expectNoHorizontalScroll(page)
      await shots(page, 'fa-light')
      await page.getByRole('searchbox').fill('DEN')
      await expect(page.getByRole('table', { name: 'Undrafted free agents' }).getByRole('cell', { name: 'DEN' }).first()).toBeVisible()
    })
  })
})
