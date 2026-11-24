import { test, expect, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'

// NBA Teams schedule with Results / Upcoming / All: Cleveland's real season
// (schedule from the backend, results from ESPN) on Nov 24, 2026, after 18 games.
const NOW = new Date('2026-11-24T12:00:00-05:00')

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await mockApi(page, {
    '/nba-teams': [{ team_id: '5', abbreviation: 'CLE', team_name: 'Cleveland Cavaliers' }],
    '/nba-teams/5/depthchart': null,
    '/nba-teams/5/results': fixture('team-results-cle'),
    '/nba/schedule': fixture('schedule-cle'),
  })
})

test('Results opens at the latest game and links to its box score; All opens at today', async ({ page }) => {
  const mobile = isMobile(page)
  await page.goto(`/nba-teams?team=5${mobile ? '&ff=mobile' : ''}`)
  const scroll = page.getByTestId('team-schedule-scroll')
  await expect(scroll).toBeVisible()

  // Upcoming is the default and starts at the next game.
  await expect(scroll.locator('tr[data-row-index="0"]')).toContainText(/Nov 25/)

  const results = mobile ? page.getByRole('radio', { name: /^Results/ }) : page.getByRole('button', { name: /^Results/ })
  await results.click()
  // Bring the box itself on screen; what matters is where it scrolled inside.
  await scroll.scrollIntoViewIfNeeded()
  const latest = page.getByRole('link', { name: 'Box score: Loss 108-122 at Chicago Bulls, Nov 23' })
  await expect(latest).toBeInViewport()
  await expect(page.getByRole('link', { name: /^Box score: Loss 106-114 at Philadelphia 76ers/ })).not.toBeInViewport()
  expect(await scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2)

  const all = mobile ? page.getByRole('radio', { name: /^All/ }) : page.getByRole('button', { name: /^All/ })
  await all.click()
  await scroll.scrollIntoViewIfNeeded()
  await expect(page.getByTestId('schedule-today')).toBeInViewport()
  await expect(page.getByTestId('schedule-today')).toContainText('Today · Nov 24')
  await expect(page.getByRole('link', { name: 'Box score: Loss 108-122 at Chicago Bulls, Nov 23' })).toBeInViewport()

  await page.getByRole('link', { name: 'Box score: Loss 108-122 at Chicago Bulls, Nov 23' }).click()
  await expect(page).toHaveURL(/\/box-scores\?date=2026-11-23&game=401910041/)
})
