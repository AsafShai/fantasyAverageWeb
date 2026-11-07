import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { API_BASE_URL, fixture } from './support/mockApi'

// Step 4 of the mobile redesign: Teams list + Team page on a phone.

test('desktop: Team page keeps every section on one page', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/team/1?ff=mobile')
  await expect(page.getByRole('heading', { name: /Fantasy One/ }).first()).toBeVisible()
  await expect(page.getByTestId('mobile-team-page')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Team statistics/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Roster coverage/ })).toBeVisible()
  await expect(page).not.toHaveURL(/tab=/)
})

test.describe('phone Teams + Team page', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE_URL}/league/rank-changes*`, (route) =>
      route.fulfill({
        json: { previous_period: 1, latest_period: 2, teams: [{ team_id: 1, team_name: 'Fantasy One', rank_delta: -2, total_delta: -3, gp_delta: 4, categories: {} }] },
      }),
    )
    await page.goto('/?ff=mobile')
    await expect(page.locator('.mr-shell')).toBeVisible()
  })

  test('Teams list: one row per team, opens the team page', async ({ page }) => {
    await page.goto('/teams')
    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible()
    const rows = page.locator('.mr-tm-row')
    await expect(rows).toHaveCount(fixture<unknown[]>('teams').length)
    await expect(rows.first()).toContainText('Team #1')
    await expectNoHorizontalScroll(page)
    await rows.first().click()
    await expect(page).toHaveURL(/\/team\/1$/)
    await expect(page.getByTestId('mobile-team-page')).toBeVisible()
  })

  test('header card and Team Statistics tab', async ({ page }) => {
    await page.goto('/team/1')
    const head = page.getByRole('region', { name: 'Team summary' })
    await expect(head.getByRole('heading', { name: /Fantasy One/ })).toBeVisible()
    await expect(head).toContainText('#1 · 80 pts')
    await expect(head).toContainText('▼2 since yesterday')
    await expect(head.getByRole('listitem', { name: 'PTS: 1 points' })).toBeVisible()
    await expect(head.getByRole('link', { name: /View on ESPN/ })).toHaveAttribute('href', 'https://fantasy.espn.com')
    await expect(head.getByRole('button', { name: /Share/ })).toBeVisible()

    await expect(page.getByRole('radio', { name: 'Team Statistics' })).toHaveAttribute('aria-checked', 'true')
    for (const h of ['Team statistics', 'Shot chart', 'Per-game averages']) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible()
    }
    await expect(page.getByText('100/200 (50.00%)')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('tabs and roster modes live in the URL; reload keeps them', async ({ page }) => {
    await page.goto('/team/1')
    await page.getByRole('radio', { name: 'Roster' }).click()
    await expect(page).toHaveURL(/tab=roster/)
    // Daily (default): moves card + one roster table with box lines and the starters row.
    await expect(page.getByTestId('roster-day-moves')).toBeVisible()
    await expect(page.getByTestId('roster-day-row')).toHaveCount(fixture<{ players: unknown[] }>('team-roster-day').players.length)
    await expect(page.getByTestId('roster-day-totals')).toBeVisible()

    await page.getByRole('radio', { name: 'Stats' }).click()
    await expect(page).toHaveURL(/mode=stats/)
    await expect(page.getByRole('region', { name: 'Roster stats' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Include all players' })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Include Bench Guy in team average' }).uncheck()
    await expect(page.getByRole('row', { name: /Avg \(Season\)/ })).toContainText('1 players')
    await page.getByRole('radio', { name: 'Totals' }).click()
    await expect(page.getByRole('row', { name: /Total \(Season\)/ })).toBeVisible()
    await page.getByRole('button', { name: /^PTS/ }).click()
    await expect(page).toHaveURL(/sort=pts/)

    await page.getByRole('radio', { name: 'Schedule' }).click()
    await expect(page).toHaveURL(/mode=schedule/)
    await expect(page.getByRole('heading', { name: /Who plays/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Roster schedule' })).toBeVisible()

    await page.getByRole('radio', { name: 'Slots & coverage' }).click()
    await expect(page).toHaveURL(/tab=slots/)
    await expect(page.getByRole('heading', { name: 'Roster coverage' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('radio', { name: 'Slots & coverage' })).toHaveAttribute('aria-checked', 'true')
    await expectNoHorizontalScroll(page)
  })

  test("today's opponent opens the matchup sheet; back closes it first", async ({ page }) => {
    const day = fixture<{ players: Array<Record<string, unknown>> } & Record<string, unknown>>('team-roster-day')
    const today = { ...day, is_today: true, date: '2026-10-19', last_date: '2026-10-19' }
    await page.route(`${API_BASE_URL}/teams/1/roster-day*`, (route) => route.fulfill({ json: today }))
    const first = day.players.find((p) => p.opponent) as { player_name: string; opponent: string }
    const matchups = fixture<Array<Record<string, unknown>>>('matchups').map((m, i) => (i === 0 ? { ...m, player_name: first.player_name, opponent: first.opponent } : m))
    await page.route(`${API_BASE_URL}/matchups/today*`, (route) => route.fulfill({ json: matchups }))

    await page.goto('/team/1?tab=roster')
    const opp = page.getByRole('button', { name: new RegExp(`${first.player_name} vs ${first.opponent}`) })
    await opp.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/team\/1\?tab=roster$/)
  })
})
