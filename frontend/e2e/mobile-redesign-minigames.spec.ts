import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'
import type { Page } from '@playwright/test'

// Step 5 of the mobile redesign: Minigames list and the four game pages on a phone.

const photo = (bg: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><circle cx="50" cy="38" r="20" fill="#fff" opacity=".85"/><rect x="18" y="64" width="64" height="40" rx="30" fill="#fff" opacity=".85"/></svg>`,
  )}`

const P = (id: string, displayName: string, team: string, teamAbbr: string, conference: string, division: string, position: string, color: string, height: string, age: number, jerseyNumber: string) => ({
  id, displayName, team, teamAbbr, conference, division, position, photoUrl: photo(color), height, nationality: 'USA', age, jerseyNumber,
})

const PLAYERS = {
  seasonLabel: '2025-26',
  source: 'test',
  updatedAt: '2026-10-19T00:00:00Z',
  players: [
    P('1', 'Jalen Brunson', 'New York Knicks', 'NYK', 'East', 'Atlantic', 'G', '#1D428A', '6-2', 29, '11'),
    P('2', 'Jayson Tatum', 'Boston Celtics', 'BOS', 'East', 'Atlantic', 'F', '#007A33', '6-8', 28, '0'),
    P('3', 'Donovan Mitchell', 'Cleveland Cavaliers', 'CLE', 'East', 'Central', 'G', '#860038', '6-3', 29, '45'),
    P('4', 'Tyrese Haliburton', 'Indiana Pacers', 'IND', 'East', 'Central', 'G', '#002D62', '6-5', 25, '0'),
    P('5', 'Trae Young', 'Atlanta Hawks', 'ATL', 'East', 'Southeast', 'G', '#E03A3E', '6-1', 27, '11'),
    P('6', 'Nikola Jokic', 'Denver Nuggets', 'DEN', 'West', 'Northwest', 'C', '#0E2240', '6-11', 30, '15'),
    P('7', 'Stephen Curry', 'Golden State Warriors', 'GSW', 'West', 'Pacific', 'G', '#1D428A', '6-2', 37, '30'),
    P('8', 'Luka Doncic', 'Los Angeles Lakers', 'LAL', 'West', 'Pacific', 'G', '#552583', '6-6', 26, '77'),
    P('9', 'Victor Wembanyama', 'San Antonio Spurs', 'SAS', 'West', 'Southwest', 'C', '#8A8D8F', '7-4', 21, '1'),
  ],
}

const LB = {
  hangman: { rows: [{ rank: 1, displayName: 'Dor Zilberman', bestStreak: 6, hintsUsed: 2 }, { rank: 2, displayName: 'Asaf', bestStreak: 4, hintsUsed: 0 }, { rank: 3, displayName: 'dor', bestStreak: 2, hintsUsed: 1 }] },
  'who-he-play-for': { rows: [{ rank: 1, displayName: 'Dor Zilberman', bestStreak: 9 }, { rank: 2, displayName: 'Asaf', bestStreak: 7 }] },
  'who-am-i': { rows: [{ rank: 1, displayName: 'Dor Zilberman', bestStreak: 4, hintsUsed: 0 }, { rank: 2, displayName: 'dor', bestStreak: 2, hintsUsed: 0 }] },
  'now-you-see-me': { rows: [] },
}

const DATA = {
  '/minigames/players': PLAYERS,
  '/minigames/hangman/leaderboard': LB.hangman,
  '/minigames/who-he-play-for/leaderboard': LB['who-he-play-for'],
  '/minigames/who-am-i/leaderboard': LB['who-am-i'],
  '/minigames/now-you-see-me/leaderboard': LB['now-you-see-me'],
  '/minigames/*': { qualifies: false },
}

/** MR_SHOTS=<dir>: save phone-screen captures for the PR (not run in CI). */
async function shot(page: Page, name: string, fullPage = true) {
  const dir = process.env.MR_SHOTS
  if (!dir) return
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
  if (!fullPage) return page.screenshot({ path: `${dir}/${name}.png` })
  // A viewport as tall as the page, so the fixed header and tab bar sit where a reader expects.
  const size = page.viewportSize()!
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: size.width, height })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${dir}/${name}.png` })
  await page.setViewportSize(size)
}

async function open(page: Page, path: string) {
  // The first player in the pool is always picked, so rounds are predictable.
  await page.addInitScript(() => { Math.random = () => 0 })
  await page.route('https://a.espncdn.com/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#9CA3AF"/></svg>' }))
  await mockApi(page, DATA)
  await page.goto(`${path}?ff=mobile`)
}

test('desktop keeps today\'s Minigames pages with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await open(page, '/minigames/hangman')
  await expect(page.getByRole('heading', { name: 'Hangman' })).toBeVisible()
  await expect(page.locator('.mr-mg')).toHaveCount(0)
  await page.getByRole('button', { name: 'Start New Game' }).click()
  await expect(page.getByRole('switch', { name: 'Auto next (3s)' })).toBeVisible()
})

test.describe('phone Minigames', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('list: heading, intro and the four games', async ({ page }) => {
    await open(page, '/minigames')
    await expect(page.getByTestId('mobile-minigames')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Minigames' })).toBeVisible()
    await expect(page.getByText("Play NBA guessing games and climb each game's top-5 streak leaderboard")).toBeVisible()
    for (const name of ['Hangman', 'Who He Play For?', 'Who Am I?', 'Now You See Me']) {
      await expect(page.getByRole('link', { name: new RegExp(name.replace('?', '\\?')) })).toBeVisible()
    }
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-minigames')
    await page.getByRole('link', { name: /Who Am I\?/ }).click()
    await expect(page).toHaveURL(/\/minigames\/who-am-i$/)
  })

  test('Hangman: streak tiles, leaderboard, a won round and Give up', async ({ page }) => {
    await open(page, '/minigames/hangman')
    await expect(page.getByRole('heading', { name: 'Hangman' })).toBeVisible()
    await expect(page.getByText('Guess the NBA player — build a streak')).toBeVisible()
    for (const l of ['Streak', 'Best this run', 'Hints used']) await expect(page.getByText(l, { exact: true })).toBeVisible()
    const lb = page.getByRole('table')
    await expect(lb.getByRole('columnheader')).toHaveText(['#', 'Player', 'Best', 'Hints'])
    await expect(lb.getByRole('row')).toHaveCount(4)
    await expect(page.getByText('Top 5 best streaks (fewer hints wins ties)')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-hangman')

    await page.getByRole('button', { name: 'Start New Game' }).click()
    await expect(page.getByRole('switch', { name: 'Auto next (3s)' })).toBeVisible()
    await page.getByRole('button', { name: 'Team', exact: true }).click()
    await expect(page.getByText('Team: New York Knicks')).toBeVisible()
    for (const L of 'JALEXZ') await page.getByRole('button', { name: L, exact: true }).click()
    await expect(page.getByRole('button', { name: 'X', exact: true })).toBeDisabled()
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-hangman-playing')
    for (const L of 'NBRUSO') await page.getByRole('button', { name: L, exact: true }).click()
    await expect(page.getByText('Correct!')).toBeVisible()
    await page.getByRole('button', { name: 'Next player' }).click()
    await page.getByRole('button', { name: 'Give up' }).click()
    await expect(page.getByText(/Run over — best streak:/)).toContainText('1')
  })

  test('Who He Play For?: timer, team picker, reveal on a miss', async ({ page }) => {
    await open(page, '/minigames/who-he-play-for')
    await expect(page.getByText('Pick the team — 30s per round')).toBeVisible()
    await page.getByRole('button', { name: 'Start New Game' }).click()
    await expect(page.getByText('Jalen Brunson')).toBeVisible()
    await page.getByPlaceholder('Filter by city or abbreviation…').click()
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-who-he-play-for-playing')
    await page.getByRole('button', { name: /Boston Celtics/ }).click()
    await expect(page.getByText('Answer:')).toContainText('Jalen Brunson')
    await expect(page.getByText('Team:')).toContainText('New York Knicks')
    await shot(page, 'live-who-he-play-for')
  })

  test('Who Am I?: guess cards, and the map is a sheet that back closes', async ({ page }) => {
    await open(page, '/minigames/who-am-i')
    await expect(page.getByText('Poeltl-style clues — 8 guesses')).toBeVisible()
    await shot(page, 'live-who-am-i')
    await page.getByRole('button', { name: 'Start New Game' }).click()
    for (const name of ['Stephen Curry', 'Donovan Mitchell']) {
      await page.getByPlaceholder('Search player…').fill(name.split(' ')[0])
      await page.getByRole('button', { name: new RegExp(name) }).click()
      await page.getByRole('button', { name: 'Guess' }).click()
    }
    await expect(page.getByLabel('2 of 8 guesses used')).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-who-am-i-playing')

    await page.getByRole('button', { name: 'Map' }).click()
    const sheet = page.getByRole('dialog', { name: 'Conferences and divisions' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('tab', { name: 'Eastern' })).toBeVisible()
    await shot(page, 'live-who-am-i-map', false)
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/minigames\/who-am-i$/)
    await expect(page.getByLabel('2 of 8 guesses used')).toBeVisible()
  })

  test('Now You See Me: photo, picker, empty leaderboard', async ({ page }) => {
    await open(page, '/minigames/now-you-see-me')
    await expect(page.getByText('No streaks yet — be the first to play.')).toBeVisible()
    await shot(page, 'live-now-you-see-me')
    await page.getByRole('button', { name: 'Start New Game' }).click()
    await expect(page.getByRole('img', { name: 'Mystery player' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, 'live-now-you-see-me-playing')
    await page.getByRole('button', { name: 'Give up' }).click()
    await expect(page.getByText('Answer:')).toContainText('Jalen Brunson')
  })

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark') } catch { /* */ } })
    await open(page, '/minigames/hangman')
    await page.getByRole('button', { name: 'Start New Game' }).click()
    await shot(page, 'live-dark-hangman-playing')
  })
})
