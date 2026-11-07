import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'
import { INSIGHTS_API } from './support/insightsMocks'

// Step 5 of the mobile redesign: League Analytics and Standings Estimator on a phone.

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
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function open(page: Page, path: string) {
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '7'))
  await mockApi(page, INSIGHTS_API)
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}ff=mobile`)
}

test('desktop keeps today\'s League Analytics and Estimator with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await open(page, '/analytics')
  await expect(page.getByRole('heading', { name: 'Performance Heatmap' })).toBeVisible()
  await expect(page.locator('.mr-an')).toHaveCount(0)
  await page.goto('/estimator')
  await expect(page.getByRole('heading', { name: 'Season Projections' })).toBeVisible()
  await expect(page.locator('.mr-es')).toHaveCount(0)
})

test.describe('phone League Analytics', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('heatmap: date range, heat cells with ranks, sort and spotlight', async ({ page }) => {
    await open(page, '/analytics')
    await expect(page.getByRole('radio', { name: 'Heatmap' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByLabel('From')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
    const table = page.getByRole('table', { name: 'Performance Heatmap' })
    await expect(table.getByRole('rowheader')).toHaveCount(12)
    await expect(table.locator('tbody tr').first().locator('.mr-an-rank').first()).toHaveText(/^\(\d+\)$/)
    await expectNoHorizontalScroll(page)
    await shots(page, 'analytics-heatmap')

    await table.getByRole('button', { name: 'PTS' }).click()
    await expect(table.getByRole('columnheader', { name: /PTS/ })).toHaveAttribute('aria-sort', 'descending')
    await table.getByRole('button', { name: 'DORELIT' }).click()
    await expect(table.locator('tr.mr-an-spot')).toHaveCount(1)

    await page.getByRole('button', { name: 'Set date range to last 7 days through today' }).click()
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('heading', { name: /Performance Heatmap – \w+ \d+ - \w+ \d+/ })).toBeVisible()
  })

  test('Rankings Over Time: phone controls, chart, team chips; tab in the URL', async ({ page }) => {
    await open(page, '/analytics')
    await page.getByRole('radio', { name: 'Rankings Over Time' }).click()
    await expect(page).toHaveURL(/tab=race/)
    for (const g of ['Basis', 'Show']) await expect(page.getByRole('radiogroup', { name: g })).toBeVisible()
    await expect(page.locator('.recharts-surface').first()).toBeVisible()
    await page.getByRole('button', { name: /^Category: Total/ }).click()
    await expect(page.getByRole('dialog', { name: 'Category' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog', { name: 'Category' })).toHaveCount(0)
    const chips = page.getByRole('group', { name: 'Spotlight teams' })
    await chips.getByRole('button', { name: 'Trust the process' }).click()
    await expect(chips.getByRole('button', { name: '✕ Clear' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'analytics-race')
  })

  test('Shooting Stats: pinned team table with links', async ({ page }) => {
    await open(page, '/analytics?tab=shots')
    const table = page.getByRole('table', { name: 'League Shooting Statistics' })
    await expect(table.getByRole('link')).toHaveCount(12)
    await expect(table.getByRole('columnheader', { name: /FG%/ })).toHaveAttribute('aria-sort', 'descending')
    await expectNoHorizontalScroll(page)
    await shots(page, 'analytics-shots')
  })
})

test.describe('phone Standings Estimator', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('three tabs in the URL; heat, rankings and projections tables', async ({ page }) => {
    await open(page, '/estimator')
    await expect(page.getByRole('heading', { name: 'Rank Probability Heatmap' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Rank Probability Heatmap' }).getByRole('rowheader')).toHaveCount(12)
    await expect(page.getByRole('button', { name: /Share/i }).first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'estimator-prob')

    await page.getByRole('radio', { name: 'Projected Rankings' }).click()
    await expect(page).toHaveURL(/tab=rank/)
    const rk = page.getByRole('table', { name: 'Projected Rankings' })
    await expect(rk.getByRole('columnheader', { name: /Rank and team/ })).toHaveAttribute('aria-sort', 'ascending')
    await expectNoHorizontalScroll(page)
    await shots(page, 'estimator-rank')

    await page.getByRole('radio', { name: 'Season Projections' }).click()
    await expect(page).toHaveURL(/tab=proj/)
    await expect(page.getByRole('table', { name: 'Season Projections' }).getByText(/^\+\/-/).first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'estimator-proj')
  })
})
