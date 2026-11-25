import { readFileSync } from 'node:fs'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'

// The Rotation card under a box score, fed a real game (MEM @ CLE, 2026-11-18)
// parsed by the backend and slimmed to the plays the rebuild needs.
const BOX = JSON.parse(
  readFileSync(new URL('../src/components/boxScores/__tests__/fixtures/boxscore-401910007.json', import.meta.url), 'utf8'),
)

const side = (key: 'away' | 'home') => {
  const { team_id, name, short_name, abbreviation, logo, color, record, score, winner } = BOX[key]
  return { team_id, name, short_name, abbreviation, logo, color, record, score, winner }
}
const SCOREBOARD = {
  date: '2026-11-18',
  games: [{ game_id: BOX.game_id, status: 'final', status_detail: 'Final', start_time: BOX.start_time, broadcast: '', venue: BOX.venue, away: side('away'), home: side('home') }],
}

test.beforeEach(async ({ page }) => {
  await mockApi(page, {
    '/nba/season': { start: '2026-10-01', end: '2027-04-30' },
    [`/nba/games/${BOX.game_id}/boxscore`]: BOX,
    '/nba/scoreboard': SCOREBOARD,
    '/nba/scoreboard/values': null,
  })
})

test('Rotation card: open, pick two players, see the time they shared', async ({ page }) => {
  const mobile = isMobile(page)
  await page.goto(`/box-scores?date=2026-11-18&game=${BOX.game_id}${mobile ? '&ff=mobile' : ''}`)
  const toggle = page.getByRole('button', { name: /^Rotation/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('rotation-row')).toHaveCount(12)

  await page.getByRole('button', { name: /^Compare Cam Spencer/ }).click()
  await page.getByRole('button', { name: /^Compare Jaylen Wells/ }).click()
  await expect(page.getByTestId('rotation-together')).toContainText('Spencer + Wells')

  if (mobile) {
    await page.getByRole('group', { name: 'Zoom the timeline' }).getByRole('button', { name: 'Q4' }).click()
    await expect(page.getByTestId('rotation-together')).toContainText('in Q4')
    for (const row of await page.getByTestId('rotation-row').all()) {
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    }
    await expectNoHorizontalScroll(page)
  } else {
    await page.getByRole('button', { name: /^Jaylen Wells, stint 2 of 3/ }).hover()
    await expect(page.getByText('of it with all picked players')).toBeVisible()
  }

  // Remembered open across reloads.
  await page.reload()
  await expect(page.getByRole('button', { name: /^Rotation/ })).toHaveAttribute('aria-expanded', 'true')
})
