import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll, FIXED_NOW } from './support/test'
import { mockApi } from './support/mockApi'

// Step 4 of the mobile redesign: the Today page (Home tab) on a phone.

const TEAMS = [
  [1, "Khachapuri’s Team", 'KHA', 65],
  [2, 'DORELIT', 'DOR', 63],
  [3, 'Hapoel Yifat', 'HY', 60],
  [4, "Dor's Injured Team", 'DIT', 59],
  [5, 'Maccabi Haifa NBA 777', 'MH', 57],
  [6, "Oriel's Otherworldly Team", 'OOT', 52],
  [7, "Roy's Rowdy Team", 'RRT', 50],
  [8, 'Trust the process', 'TTP', 47],
  [9, 'Chat GPT', 'GPT', 44],
  [10, "Asaf's Astounding Team", 'LA', 40],
  [11, "Amihai's Awesome Team", 'AAT', 36],
  [12, 'Machlins team', 'MT', 30],
] as const

const mover = (id: number, category: string, delta: number) => ({ team_id: id, team_name: TEAMS[id - 1][1], category, delta })

const DATA = {
  '/rankings': {
    averages_rankings: TEAMS.map(([team_id, team_name, , total_points]) => ({ team: { team_id, team_name }, total_points })),
    totals_rankings: [],
    categories: [],
    last_updated: '2026-10-19T08:08:00Z',
  },
  '/league/rank-changes': {
    previous_period: 1,
    latest_period: 2,
    teams: TEAMS.map(([team_id, team_name]) => ({
      team_id, team_name, rank_delta: 0, gp_delta: 2, categories: {},
      total_delta: ({ 1: -6, 2: -3, 4: 1 } as Record<number, number>)[team_id] ?? 0,
    })),
  },
  '/league/summary': {
    total_teams: 12, total_games_played: 400, nba_avg_pace: 8.2, nba_game_days_left: 144, category_leaders: {},
    league_averages: { fg_percentage: 0.465, ft_percentage: 0.792, three_pm: 1.71, reb: 5.8, ast: 3.87, stl: 1.09, blk: 0.63, pts: 16.86, gp: 83.25 },
    last_updated: '2026-10-19T08:08:00Z',
    espn_updated_at: '2026-10-19T08:08:00-04:00',
    trade_deadline: '2027-03-15T12:00:00-04:00',
  },
  '/league/today': {
    slate_date: '2026-10-19',
    games_count: 9,
    movers: [
      mover(1, 'TOTAL', -6), mover(1, 'STL', -3), mover(1, '3PM', -2), mover(1, 'AST', -1),
      mover(6, 'TOTAL', 5), mover(6, 'FT%', 2), mover(6, 'FG%', 1), mover(6, 'REB', 1), mover(6, 'STL', 1),
      mover(2, 'TOTAL', -3), mover(2, 'FT%', -4), mover(2, 'AST', 1),
      mover(7, 'TOTAL', 2), mover(7, 'AST', 1), mover(7, 'FT%', 1), mover(7, 'REB', 1), mover(7, 'STL', -1),
      mover(8, 'TOTAL', -2), mover(8, 'FG%', -1), mover(8, 'REB', -1),
      mover(9, 'TOTAL', 1), mover(9, 'STL', 2), mover(9, 'AST', -1),
      mover(4, 'TOTAL', 1), mover(4, 'BLK', 1),
    ],
    roster_health: TEAMS.map(([team_id, team_name], i) => ({
      team_id, team_name, games_tonight: [10, 10, 8, 8, 11, 12, 10, 9, 11, 8, 7, 10][i],
      available_tonight: [8, 7, 6, 6, 8, 9, 8, 6, 10, 8, 7, 6][i],
      probable: i === 1 ? 1 : 0, questionable: 0, doubtful: 0,
      out: [0, 0, 0, 0, 2, 1, 1, 0, 1, 0, 0, 1][i],
    })),
    last_nightly: { game_date: '2026-10-18', rows: 240 },
  },
  '/league/activity/latest': {
    teams: TEAMS.map(([team_id, name, abbrev]) => ({ team_id, name, abbrev })),
    moves: [
      { id: 'a', kind: 'add', at: '2026-10-19T10:00:00Z', team_id: 10, other_team_id: null, trade_id: null, added: [{ player_id: 1, name: 'Terrence Shannon Jr.' }], dropped: [{ player_id: 2, name: 'Collin Gillespie' }] },
      { id: 'b', kind: 'waiver', at: '2026-10-19T09:00:00Z', team_id: 2, other_team_id: null, trade_id: null, added: [{ player_id: 3, name: "Ja'Kobe Walter" }], dropped: [{ player_id: 4, name: 'Jakob Poeltl' }] },
      { id: 'c', kind: 'trade', at: '2026-10-18T09:00:00Z', team_id: 3, other_team_id: 7, trade_id: 't1', added: [{ player_id: 5, name: 'Jared McCain' }], dropped: [{ player_id: 6, name: 'Charles Bassey' }] },
      { id: 'd', kind: 'drop', at: '2026-10-18T08:00:00Z', team_id: 10, other_team_id: null, trade_id: null, added: [], dropped: [{ player_id: 7, name: 'Moritz Wagner' }] },
    ],
  },
}

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

async function openToday(page: Page, overrides: Record<string, unknown> = {}) {
  await mockApi(page, { ...DATA, ...overrides })
  await page.goto('/?ff=mobile')
  await expect(page.getByRole('heading', { name: 'Rank movers' })).toBeVisible()
}

test('desktop: Today keeps the old layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await openToday(page)
  await expect(page.getByRole('columnheader', { name: 'Cat' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Rank movers by team' })).toHaveCount(0)
})

test.describe('phone Today', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('cards in design order, no sideways page scroll', async ({ page }) => {
    await openToday(page)
    const headings = await page.locator('main h1, main h2').allTextContents()
    expect(headings).toEqual(['Today', 'Top 5 Teams (average)', 'Rank movers', 'Roster health today', 'Latest moves', 'League averages'])
    await expect(page.getByText('▼6').first()).toBeVisible()
    await expect(page.getByText('STL −3 · 3PM −2 · AST −1')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shots(page, 'today-light')
  })

  test('mover filter is a sheet that browser back closes', async ({ page }) => {
    await openToday(page)
    await page.getByRole('button', { name: 'Filter teams: All teams' }).click()
    const sheet = page.getByRole('dialog', { name: 'Teams' })
    await sheet.getByText('DORELIT').click()
    if (process.env.MR_SHOTS) await page.screenshot({ path: `${process.env.MR_SHOTS}/today-filter-sheet.png` })
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
    const list = page.getByRole('list', { name: 'Rank movers by team' })
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list).toContainText('DORELIT')
  })

  test('cards link to their full pages', async ({ page }) => {
    await openToday(page)
    await page.getByRole('link', { name: 'Full standings' }).click()
    await expect(page).toHaveURL(/\/rankings\?view=standings$/)
    await page.goBack()
    await page.getByRole('link', { name: 'Rankings ›' }).click()
    await expect(page).toHaveURL(/\/rankings\?view=rankings$/)
    await page.goBack()
    await page.getByRole('button', { name: /Oriel's Otherworldly Team/ }).click()
    await expect(page).toHaveURL(/\/team\/6$/)
  })

  test('trade deadline card in the last 7 days', async ({ page }) => {
    const soon = new Date(FIXED_NOW.getTime() + (3 * 24 + 5) * 3600_000).toISOString()
    await openToday(page, { '/league/summary': { ...DATA['/league/summary'], trade_deadline: soon } })
    await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /^3 Days, 5 Hours/)
    await page.getByRole('button', { name: /Trade Deadline/ }).click()
    await expect(page).toHaveURL(/\/trade$/)
  })

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await openToday(page)
    await expectNoHorizontalScroll(page)
    await shots(page, 'today-dark')
  })
})
