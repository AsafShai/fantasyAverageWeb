import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'

// Step 4 of the mobile redesign: Standings & Rankings on a phone.

const MOVES = {
  previous_period: 11,
  latest_period: 12,
  teams: [
    { team_id: 1, team_name: 'Fantasy One', rank_delta: 1, total_delta: 2, gp_delta: 3, categories: { 'FG%': 1 } },
    { team_id: 2, team_name: 'Second Team', rank_delta: -1, total_delta: -2, gp_delta: 4, categories: { 'FG%': -1 } },
  ],
}

test('desktop keeps today\'s Standings & Rankings with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/rankings?ff=mobile')
  await expect(page.locator('.mr-rk')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full table' })).toBeVisible()
})

test.describe('phone Standings & Rankings', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await mockApi(page, { '/league/rank-changes': MOVES })
    await page.goto('/rankings?ff=mobile')
    await expect(page.locator('.mr-rk')).toBeVisible()
  })

  test('controls, tiles and the pinned table; no sideways page scroll', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Team Rankings (Averages)' })).toBeVisible()
    for (const g of ['Layout', 'Show', 'Values']) await expect(page.getByRole('radiogroup', { name: g })).toBeVisible()
    await expect(page.getByText('⚡ NBA Avg Pace')).toBeVisible()
    await expect(page.getByRole('button', { name: /Hide movers/ })).toBeVisible()
    const first = page.getByRole('table').getByRole('rowheader').first()
    await expect(first).toContainText('Fantasy One')
    await expect(first).toContainText('▲1')
    await expectNoHorizontalScroll(page)
  })

  test('Standings view drops deltas and the movers toggle; state is in the URL', async ({ page }) => {
    await page.getByRole('radio', { name: 'Standings' }).click()
    await expect(page).toHaveURL(/view=standings/)
    await expect(page.getByRole('button', { name: /movers/ })).toHaveCount(0)
    await expect(page.getByRole('table').locator('tbody')).not.toContainText('▲')
  })

  test('date range opens inline; a quick range then Apply puts it in the URL', async ({ page }) => {
    await page.getByRole('button', { name: /Date range: Season/ }).click()
    await page.getByRole('button', { name: 'Set date range to last 7 days through today' }).click()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=/)
    await expect(page.getByRole('button', { name: /Date range: \w+ \d+ – \w+ \d+/ })).toBeVisible()
  })

  test('Cards layout and tapping a team opens its page', async ({ page }) => {
    await page.getByRole('radio', { name: 'Cards' }).click()
    await expect(page.getByRole('listitem')).toHaveCount(2)
    await page.getByRole('link', { name: 'Fantasy One' }).click()
    await expect(page).toHaveURL(/\/team\/1$/)
  })
})
