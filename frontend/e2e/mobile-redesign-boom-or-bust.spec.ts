import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'

// Step 5 of the mobile redesign: Boom or Bust on a phone.

const row = (id: number, name: string, team: string, opp: string, home: boolean, score: number, fantasy: string | null) => ({
  game_date: '2026-10-18', player_id: id, player_name: name, team_abbr: team, opponent_abbr: opp, is_home: home, minutes: 30 + id,
  pts: 24, reb: 6, ast: 5, fg3m: 3, stl: 1, blk: 0, fgm: 9, fga: 17, ftm: 3, fta: 4, score, metric_z: 2, metric_err: 0.5,
  has_estimate: id % 2 === 0, fantasy_team: fantasy, fantasy_team_name: fantasy ? `${fantasy} team` : null, lineup_slot: 'PG', started: true,
  reasons: [], verdict: score > 0 ? 'good' : 'bad',
})

const NIGHT = {
  latest_run: { game_date: '2026-10-18', status: 'processed' },
  game_date: '2026-10-18', games: 2, players_played: 52, players_scored: 52, players_with_estimate: 47,
  thresholds: { good: 2.1, bad: 2.2 },
  good: [row(1, 'Wendell Carter Jr.', 'ORL', 'PHO', false, 3.1, 'HY'), row(2, 'Miles Bridges', 'PHO', 'ORL', true, 2.6, null), row(3, 'Devin Booker', 'PHO', 'ORL', true, 2.3, 'MT')],
  bad: [row(4, 'Franz Wagner', 'ORL', 'PHO', false, -2.9, 'DOR'), row(5, 'Jase Richardson', 'ORL', 'PHO', false, -2.4, null)],
  computed_at: '2026-10-19T08:00:00Z',
}

async function openBob(page: Page) {
  await mockApi(page, {
    '/surprises/latest': NIGHT,
    '/surprises/dates': ['2026-10-18', '2026-10-17', '2026-10-16'],
    '/surprises/2026-10-17': { ...NIGHT, game_date: '2026-10-17' },
  })
  await page.goto('/boom-or-bust?ff=mobile')
  await expect(page.getByRole('heading', { name: 'Boom or Bust' })).toBeVisible()
}

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

test('desktop: Boom or Bust keeps the old layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await openBob(page)
  await expect(page.locator('.mr-bob')).toHaveCount(0)
})

test.describe('phone Boom or Bust', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('summary, period chips, both cards with their sliders', async ({ page }) => {
    await openBob(page)
    await expect(page.getByText('52 of 52 players scored · 47 with a model estimate')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Period' }).getByRole('button')).toHaveText(['Last night', 'Last 7 days', 'Last 30 days', 'Season', 'Custom'])
    await expect(page.getByRole('heading', { name: /Booms/ })).toContainText('(3)')
    await expect(page.getByRole('heading', { name: /Busts/ })).toContainText('(2)')
    await expect(page.getByLabel('Surprise threshold')).toBeVisible()
    await expect(page.getByLabel('Disappointment threshold')).toBeVisible()
    await expect(page.getByText('Wendell Carter Jr.')).toBeVisible()
    await expect(page.getByText('3 players')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'bob-light')
  })

  test('previous night button', async ({ page }) => {
    await openBob(page)
    await page.getByRole('button', { name: 'Previous night' }).click()
    await expect(page.getByText('Oct 17, 2026').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Latest' })).toBeVisible()
  })

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await openBob(page)
    await expectNoHorizontalScroll(page)
    await shots(page, 'bob-dark')
  })
})
