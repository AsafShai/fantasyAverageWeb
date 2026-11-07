import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi, fixture } from './support/mockApi'

// Step 5 of the mobile redesign: Projections on a phone (one card per player).

const base = fixture<Record<string, unknown>[]>('matchups')[0]

function line(pts: number, min: number) {
  const k = min / 34
  return {
    pts, reb: 8 * k, ast: 7.4 * k, three_pm: 3.8 * k, stl: 1.8 * k, blk: 0.6 * k,
    fgm: 10.2 * k, fga: 22.3 * k, fg_pct: 0.458, ftm: 8.4 * k, fta: 9.6 * k, ft_pct: 0.873,
  }
}

const PLAYERS: [string, string, string, boolean, number, number, 'green' | 'amber' | 'red', string | null][] = [
  ['Luka Doncic', 'LAL', 'POR', true, 32.6, 36, 'green', null],
  ['Cooper Flagg', 'DAL', 'UTA', true, 30.6, 38, 'green', null],
  ['Victor Wembanyama', 'SAS', 'SAC', false, 28.1, 33, 'amber', 'Questionable'],
  ['Jalen Brunson', 'NYK', 'BOS', true, 26.9, 35, 'green', null],
  ['Tyrese Haliburton', 'IND', 'MIA', false, 19.2, 31, 'amber', null],
  ['Rookie Guy', 'CHA', 'ORL', true, 0, 0, 'red', null],
]

const MATCHUPS = PLAYERS.map(([player_name, pro_team, opponent, is_home, pts, min, status, injury_status]) => ({
  ...base,
  player_name, pro_team, opponent, is_home, injury_status,
  game_date: '2026-10-21',
  projection: {
    default_minutes: min,
    status,
    reason: status === 'amber' ? 'Minutes uncertain (role change)' : status === 'red' ? 'Fewer than 5 games in the store' : '',
    stats: status === 'red' ? null : line(pts, min),
  },
}))

const PLAYER_LIST = {
  players: PLAYERS.map(([player_name, pro_team], i) => ({
    player_name, pro_team, player_id: 1000 + i, team_id: i % 2 ? 2 : 0, status: i % 2 ? 'ONTEAM' : 'FREEAGENT',
    positions: ['PG'], stats: {},
  })),
  total_count: PLAYERS.length,
}

async function openProjections(page: Page) {
  let predicted = 0
  await mockApi(page, {
    '/matchups/today': MATCHUPS,
    '/players/': PLAYER_LIST,
    '/projections/predict': async (route) => {
      predicted += 1
      const body = route.request().postDataJSON() as { minutes: number; player_name: string }
      await route.fulfill({ json: { stats: line(body.minutes, body.minutes) } })
    },
  })
  await page.goto('/projections?ff=mobile')
  await expect(page.getByRole('heading', { name: 'Projections' })).toBeVisible()
  return { predictedCount: () => predicted }
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

test('desktop: Projections keeps the table with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await openProjections(page)
  await expect(page.getByRole('slider').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset to default minutes', exact: true })).toHaveCount(0)
})

test.describe('phone Projections', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('one card per player, sorted by PTS, nothing lost', async ({ page }) => {
    await openProjections(page)
    const names = page.locator('.mr-pj-card .mr-pj-name')
    await expect(names).toHaveText(['Luka Doncic', 'Cooper Flagg', 'Victor Wembanyama', 'Jalen Brunson', 'Tyrese Haliburton', 'Rookie Guy'])
    await expect(page.getByText('6 players')).toBeVisible()
    await expect(page.getByText('Slate')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Integer projections' })).toBeChecked()
    const luka = page.locator('.mr-pj-card').first()
    await expect(luka).toContainText('LAL vs POR')
    await expect(luka.getByRole('group', { name: 'Minutes for Luka Doncic' })).toContainText('36')
    await expect(luka).toContainText('PTS33')
    await expect(page.locator('.mr-pj-card').nth(2)).toContainText('Questionable')
    await expect(page.locator('.mr-pj-card').nth(2)).toContainText('Minutes uncertain (role change)')
    await expect(page.locator('.mr-pj-card').last()).toContainText('not enough data')
    await expectNoHorizontalScroll(page)
    await shots(page, 'projections-light')
  })

  test('sort chips reorder the cards', async ({ page }) => {
    await openProjections(page)
    await page.getByRole('group', { name: 'Sort by' }).getByRole('button', { name: 'MIN' }).click()
    await expect(page.locator('.mr-pj-card .mr-pj-name').first()).toHaveText('Cooper Flagg')
  })

  test('minutes stepper re-predicts; Reset to default minutes puts every card back', async ({ page }) => {
    const api = await openProjections(page)
    const luka = page.locator('.mr-pj-card').first()
    await luka.getByRole('button', { name: 'More minutes for Luka Doncic' }).click()
    await expect(luka.getByRole('group', { name: 'Minutes for Luka Doncic' })).toContainText('37')
    await expect.poll(api.predictedCount).toBe(1)
    await expect(luka).toContainText('PTS37')
    await page.getByRole('button', { name: '↺ Reset to default minutes' }).click()
    await expect(luka.getByRole('group', { name: 'Minutes for Luka Doncic' })).toContainText('36')
    await expect(luka).toContainText('PTS33')
  })

  test('filters sheet: NBA team, closed by back', async ({ page }) => {
    await openProjections(page)
    await page.getByRole('button', { name: 'Filters' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await sheet.getByRole('group', { name: 'NBA team' }).getByRole('button', { name: 'DAL' }).click()
    if (process.env.MR_SHOTS) await page.screenshot({ path: `${process.env.MR_SHOTS}/projections-filters.png` })
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page.locator('.mr-pj-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Remove filter DAL' })).toBeVisible()
  })

  test('player name opens the player sheet', async ({ page }) => {
    await openProjections(page)
    await page.getByRole('link', { name: 'Luka Doncic' }).click()
    await expect(page).toHaveURL(/player=1000/)
  })

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await openProjections(page)
    await expectNoHorizontalScroll(page)
    await shots(page, 'projections-dark')
  })
})
