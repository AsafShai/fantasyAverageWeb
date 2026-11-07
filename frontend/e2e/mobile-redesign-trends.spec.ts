import type { Page, Route } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'

// Step 5 of the mobile redesign: Player Trends on a phone.

const NAMES: [number, string, string, string, string, number][] = [
  [1, 'Jalen Suggs', 'ORL', 'PG', 'FA', 6.5],
  [2, 'Tre Jones', 'CHI', 'SG', 'DORELIT', 5.1],
  [3, 'Scottie Barnes', 'TOR', 'PF', "Khachapuri's Team", -4.2],
  [4, 'Kel’el Ware', 'MIA', 'C', 'FA', 3.4],
]
const common = { min_season_gp: 10, min_window_gp: 2, window_days: 15, last_updated: '2026-10-19T08:00:00Z' }

const MINUTES = {
  ...common,
  items: NAMES.map(([player_id, player_name, pro_team, position, fantasy_status, d]) => ({
    player_id, player_name, pro_team, position, fantasy_status, games_last_15d: 4, season_mpg: 24, l5_mpg: 24 + d, delta_mpg: d,
    season_gp: 12, window_gp: 4, low_sample: player_id === 2,
  })),
}
const USAGE = {
  ...common,
  items: NAMES.map(([player_id, player_name, pro_team, position, fantasy_status, d]) => ({
    player_id, player_name, pro_team, position, fantasy_status, games_last_15d: 4, season_usg: 20, l5_usg: 20 + d, delta_usg: d,
    season_mpg: 24, l5_mpg: 24 + d, delta_mpg: d, season_gp: 12, window_gp: 4, role_badge: d > 5 ? 'Role ↑' : null,
  })),
}
const CATEGORIES = {
  ...common,
  league_categories: ['PTS', 'REB', 'AST', '3PM', 'STL', 'BLK'],
  reverse_categories: [],
  min_delta: { PTS: 3 },
  items: NAMES.map(([player_id, player_name, pro_team, position, fantasy_status, d]) => ({
    player_id, player_name, pro_team, position, fantasy_status, games_last_15d: 4, season_gp: 12, window_gp: 4,
    season_mpg: 24, window_mpg: 24 + d, low_sample: false,
    stats: [{ cat: 'PTS', season_avg: 12, window_avg: 12 + d, delta: d, flagged: true }],
  })),
}
const reg = (mode: 'season' | 'form') => ({
  ...common, mode, baseline_seasons: mode === 'form' ? 0 : 2,
  min_season_attempts: { '3P%': 50, 'FT%': 50, 'FG%': 200 }, min_window_attempts: 10, min_baseline_attempts: 40,
  items: NAMES.slice(0, 3).map(([player_id, player_name, pro_team, position, fantasy_status, d]) => ({
    player_id, player_name, pro_team, position, fantasy_status, games_last_15d: 4,
    stats: [
      { stat: '3P%', current_pct: 40 + d, baseline_pct: 35, dev: 5 + d, attempts_per_game: 5, drift_score: 1.2, window_pct: 45, window_attempts: 20, z: 2.1 },
      { stat: 'FT%', current_pct: 70, baseline_pct: 80, dev: -10, attempts_per_game: 3, drift_score: 0.8, window_pct: 60, window_attempts: 12, z: -1.6 },
    ],
  })),
})
const GAMELOG = {
  player_id: 1, player_name: 'Jalen Suggs', season: '2026-27', window_days: 15, window_start: '2026-10-10', season_gp: 12,
  season_mpg: 24, season_usg: 20, season_pct: { '3P%': 40 }, baseline_pct: { '3P%': 35 }, league_pct: { '3P%': 36 }, league_usg: 20, baseline_seasons: 2,
  games: Array.from({ length: 8 }, (_, i) => ({
    game_date: `2026-10-${String(10 + i).padStart(2, '0')}`, matchup: 'vs BOS', min: 24 + i, usg: 20, fgm: 5, fga: 11, ftm: 2, fta: 3,
    fg3m: 2, fg3a: 5, pts: 14, reb: 4, ast: 3, stl: 1, blk: 0, tov: 2,
  })),
}

async function openTrends(page: Page, query = '') {
  await mockApi(page, {
    '/trends/minutes': MINUTES,
    '/trends/usage': USAGE,
    '/trends/categories': CATEGORIES,
    '/trends/regression': async (route: Route) => {
      const mode = new URL(route.request().url()).searchParams.get('mode') === 'form' ? 'form' : 'season'
      await route.fulfill({ json: reg(mode) })
    },
    '/trends/player/*': GAMELOG,
  })
  await page.goto(`/trends?ff=mobile${query}`)
  await expect(page.getByRole('heading', { name: /Trends/ })).toBeVisible()
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

test('desktop: Trends keeps the old layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await openTrends(page)
  await expect(page.locator('table th', { hasText: 'Season MPG' })).toBeVisible()
})

test.describe('phone Trends', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('tabs, window, scope and the minutes table', async ({ page }) => {
    await openTrends(page)
    const tabs = page.getByRole('group', { name: 'Trend type' })
    await expect(tabs.getByRole('button')).toHaveText(['Minutes Movers', 'Usage & Role', 'Categories', 'Shooting · Season', 'Shooting · Form'])
    await expect(page.getByRole('radio', { name: '15d' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'All players' })).toBeChecked()
    // sorted by Δ MPG descending
    await expect(page.locator('.mr-tr-name').first()).toContainText('Jalen Suggs')
    await expect(page.getByText('partial')).toBeVisible()
    await expect(page.getByText('Shows players with 10+ games')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'trends-minutes')
  })

  test('scope: Free agents only', async ({ page }) => {
    await openTrends(page)
    await page.getByRole('radio', { name: 'Free agents' }).click()
    await expect(page.locator('.mr-tr-name')).toHaveCount(2)
  })

  test('tap a player for the game-by-game chart', async ({ page }) => {
    await openTrends(page)
    await page.locator('.mr-tr-name').first().click()
    await expect(page.locator('.mr-tr-chart')).toBeVisible()
    await expect(page.locator('.mr-tr-chart')).toContainText('Jalen Suggs')
    await shots(page, 'trends-chart')
  })

  test('filters sheet: position, closed by back', async ({ page }) => {
    await openTrends(page)
    await page.getByRole('button', { name: 'Filters' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await sheet.getByRole('group', { name: 'Position' }).getByRole('button', { name: 'C', exact: true }).click()
    if (process.env.MR_SHOTS) await page.screenshot({ path: `${process.env.MR_SHOTS}/trends-filters.png` })
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page.locator('.mr-tr-name')).toHaveCount(1)
  })

  test('position filter picks several positions; chip and Reset clear them', async ({ page }) => {
    await openTrends(page)
    await page.getByRole('button', { name: 'Filters' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    const group = sheet.getByRole('group', { name: 'Position' })
    await group.getByRole('button', { name: 'PG', exact: true }).click()
    await group.getByRole('button', { name: 'C', exact: true }).click()
    await expect(page.locator('.mr-tr-name')).toHaveCount(2)
    await sheet.getByRole('button', { name: 'Reset' }).click()
    await expect(page.locator('.mr-tr-name')).toHaveCount(4)
    await group.getByRole('button', { name: 'SG', exact: true }).click()
    await group.getByRole('button', { name: 'PF', exact: true }).click()
    await expect(page.locator('.mr-tr-name')).toHaveCount(2)
    await page.goBack()
    await page.getByRole('button', { name: 'Remove filter SG, PF' }).click()
    await expect(page.locator('.mr-tr-name')).toHaveCount(4)
  })

  test('usage, categories and both shooting tabs', async ({ page }) => {
    await openTrends(page)
    const tabs = page.getByRole('group', { name: 'Trend type' })
    await tabs.getByRole('button', { name: 'Usage & Role' }).click()
    await expect(page.getByText('Role ↑').first()).toBeVisible()
    await tabs.getByRole('button', { name: 'Categories' }).click()
    await expect(page.getByRole('group', { name: 'Category' }).getByRole('button')).toHaveCount(6)
    await tabs.getByRole('button', { name: 'Shooting · Season' }).click()
    await expect(page.getByRole('radio', { name: /Prior 2 seasons/ })).toBeChecked()
    await expect(page.getByRole('button', { name: '3P%' }).first()).toBeVisible()
    await shots(page, 'trends-shooting-season')
    await tabs.getByRole('button', { name: 'Shooting · Form' }).click()
    await expect(page.getByRole('radio', { name: 'This season' })).toBeChecked()
    await expectNoHorizontalScroll(page)
  })

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await openTrends(page)
    await page.locator('.mr-tr-name').first().click()
    await expectNoHorizontalScroll(page)
    await shots(page, 'trends-dark')
  })
})
