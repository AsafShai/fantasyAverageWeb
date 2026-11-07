import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockApi } from './support/mockApi'

// Step 5 of the mobile redesign: NBA Teams, Box Scores, Season Schedule, Injuries on a phone.

const NBA_TEAMS = [
  { team_id: '1', abbreviation: 'LAL', team_name: 'Los Angeles Lakers' },
  { team_id: '2', abbreviation: 'BOS', team_name: 'Boston Celtics' },
]

const DEPTH = {
  team_id: '1',
  team_name: 'Los Angeles Lakers',
  team_abbreviation: 'LAL',
  team_logo: '',
  record: '4-4',
  positions: [
    { abbreviation: 'PG', display_name: 'Point Guard', players: [{ id: '3992', display_name: 'James Harden', short_name: 'J. Harden' }, { id: '1', display_name: 'Bench Guard', short_name: 'B. Guard' }] },
    { abbreviation: 'C', display_name: 'Center', players: [{ id: '4066648', display_name: 'Jarrett Allen', short_name: 'J. Allen', injury: { status: 'Questionable' } }] },
  ],
}

const team = (abbreviation: string, score: number | null, winner = false) => ({
  team_id: abbreviation, name: abbreviation, short_name: abbreviation, abbreviation, logo: '', color: '1D4ED8', record: '1-0', score, winner,
})
const SCOREBOARD = {
  date: '2026-10-19',
  games: [
    { game_id: 'g1', status: 'final', status_detail: 'Final', start_time: '2026-10-19T23:00:00Z', broadcast: '', venue: '', away: team('BOS', 101), home: team('CLE', 110, true) },
    { game_id: 'g2', status: 'scheduled', status_detail: '', start_time: '2026-10-20T00:00:00Z', broadcast: '', venue: '', away: team('LAL', null), home: team('DEN', null) },
  ],
}

const line = (id: string, name: string, pts: string) => ({
  player_id: id, name, jersey: '1', position: 'G', ejected: false, on_court: false, min: '30', pts, fg: '5-10', fg3: '1-3', ft: '2-2',
  reb: '4', ast: '3', tov: '1', stl: '1', blk: '0', oreb: '1', dreb: '3', pf: '2', plus_minus: '+4',
})
const side = (abbreviation: string, score: number, winner: boolean) => ({
  ...team(abbreviation, score, winner), linescores: ['25', '25', '25', '25'],
  starters: [line(`${abbreviation}1`, `${abbreviation} Starter`, '22')], bench: [line(`${abbreviation}2`, `${abbreviation} Bench`, '9')], did_not_play: [],
  totals: { min: '240', pts: String(score), fg: '40-85', fg3: '12-30', ft: '10-12', reb: '40', ast: '22', tov: '10', stl: '6', blk: '4', oreb: '9', dreb: '31' },
  shooting: { fg_pct: '47', fg3_pct: '40', ft_pct: '83', points_in_paint: '40', fast_break_points: '12' },
})
const BOX_G1 = {
  game_id: 'g1', status: 'final', status_detail: 'Final', start_time: '2026-10-19T23:00:00Z', broadcast: '', venue: 'Rocket Arena', periods: ['1', '2', '3', '4'],
  away: side('BOS', 101, false), home: side('CLE', 110, true),
  plays: [
    { id: 'p1', period: 4, clock: '0:30', text: 'CLE Starter makes layup', team_id: 'CLE', scoring: true, points: 2, away_score: 99, home_score: 108, kind: 'score' },
    { id: 'p2', period: 4, clock: '0:00', text: 'End of game', team_id: '', scoring: false, points: 0, away_score: 101, home_score: 110, kind: 'period' },
  ],
}

const INJURIES = [
  { game: '07:00(ET) BOS@CHA', team: 'Charlotte Hornets', player: 'Michael Ajayi', status: 'Out', injury: 'G League-Two-Way', last_update: '2026-11-05T22:00:00Z', game_time_utc: '2026-11-06T00:00:00Z' },
  { game: '', team: 'Boston Celtics', player: 'Jayson Tatum', status: 'Questionable', injury: 'Ankle', last_update: '2026-11-04T22:00:00Z' },
]

test.describe('phone NBA pages', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await mockApi(page, {
      '/nba-teams/1/depthchart': DEPTH,
      '/nba-teams': NBA_TEAMS,
      '/nba/season': { start: '2026-10-01', end: '2027-04-30' },
      '/nba/games/g1/boxscore': BOX_G1,
      '/nba/scoreboard/values': { date: '2026-10-19', complete: false, games_counted: 1, categories: [], reverse_categories: [], players: [] },
      '/nba/scoreboard': SCOREBOARD,
      '/injuries/notifications': [],
      '/injuries/status': null,
      '/injuries': INJURIES,
    })
  })

  test('NBA Teams: pick a team, depth chart, Exclude chips, schedule', async ({ page }) => {
    await page.goto('/nba-teams?ff=mobile')
    await expect(page.getByTestId('mobile-nba-teams')).toBeVisible()
    await page.getByRole('button', { name: /NBA team/ }).click()
    await page.getByRole('option', { name: 'Los Angeles Lakers' }).click()
    await expect(page).toHaveURL(/team=1/)
    await expect(page.getByRole('heading', { name: 'Depth chart' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const depth = page.getByRole('table', { name: 'Depth chart' })
    await expect(depth.getByRole('columnheader')).toHaveText(['POSITION', 'STARTER', '2ND', '3RD', '4TH', '5TH'])
    await expect(depth.getByText('Jarrett Allen')).toBeVisible()
    await expect(depth.getByText('Questionable')).toBeVisible()
    await page.getByRole('button', { name: 'Questionable', exact: true }).click()
    await expect(depth.getByText('Jarrett Allen')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'LAL schedule' })).toBeVisible()
    await expect(page.getByText('Games left')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('Box Scores: cards, No spoilers hides scores, game opens under cards', async ({ page }) => {
    await page.goto('/box-scores?ff=mobile')
    await expect(page.getByTestId('mobile-box-scores')).toBeVisible()
    const cards = page.locator('.mr-nba-gc')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('110')
    await page.getByRole('radio', { name: /No spoilers/ }).click()
    await expect(cards.first()).not.toContainText('110')
    await expect(page.getByRole('radio', { name: 'Full box' })).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('radio', { name: 'Full box' }).click()
    await cards.first().click()
    await expect(page).toHaveURL(/game=g1/)
    // Play-by-play sits between the game cards and the player box score.
    const panel = page.locator('#mr-nba-box-panel')
    const pbp = panel.getByText('Play-by-play', { exact: true })
    await expect(pbp).toBeVisible()
    const [cardsBox, pbpBox, tableBox] = await Promise.all([
      cards.last().boundingBox(), pbp.boundingBox(), panel.getByRole('tablist', { name: 'Team' }).boundingBox(),
    ])
    expect(cardsBox!.y).toBeLessThan(pbpBox!.y)
    expect(pbpBox!.y).toBeLessThan(tableBox!.y)
    await pbp.evaluate(el => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })
    if (process.env.MR_SHOTS) await page.screenshot({ path: `${process.env.MR_SHOTS}/box-scores-pbp-order.png` })
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page).toHaveURL(/date=2026-10-20/)
    await expectNoHorizontalScroll(page)
  })

  test('Season Schedule: window chips, tonight, Who plays when, density table', async ({ page }) => {
    await page.goto('/schedule?ff=mobile')
    await expect(page.getByTestId('mobile-schedule')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Games per night' })).toBeVisible()
    await page.getByRole('button', { name: '28 days' }).click()
    await expect(page.getByRole('button', { name: '28 days' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: 'Who plays when' })).toBeVisible()
    await page.getByRole('button', { name: /Trace \w+ across the window/ }).first().click()
    await expect(page.getByRole('status')).toContainText('Tracing')
    await page.getByRole('radio', { name: 'Weeks' }).click()
    await expect(page.getByRole('table', { name: 'Games per week' })).toBeVisible()
    await page.getByRole('radio', { name: 'Months' }).click()
    await expect(page.getByRole('table', { name: 'Games per month' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('Injuries: cards, status filter sheet (back closes), scope-less without a team, sort', async ({ page }) => {
    await page.goto('/injuries?ff=mobile')
    await expect(page.getByTestId('mobile-injuries')).toBeVisible()
    const cards = page.locator('.mr-nba-inj')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('Michael Ajayi')
    await expect(page.getByText('Showing 2 of 2 player(s)')).toBeVisible()
    await page.getByRole('button', { name: /Filter statuses/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Questionable' }).check()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Jayson Tatum')
    await page.getByRole('searchbox', { name: 'Search player' }).fill('zzz')
    await expect(page.getByText('No results match your filters')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})

test('desktop: NBA pages keep today\'s layout', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/schedule?ff=mobile')
  await expect(page.getByTestId('mobile-schedule')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Season schedule' })).toBeVisible()
})
