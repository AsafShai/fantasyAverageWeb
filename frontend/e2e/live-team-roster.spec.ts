import type { Page } from '@playwright/test'
import { test, expect, expectNoHorizontalScroll, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'

// The team page on a live night (PR 4): the Daily roster with games in
// progress, each player's game (result always, score and clock while live),
// "N starters are playing now", "+N live" on slot rows and "+N tonight" next
// to GP and points. Every moment of the day is a different `live` block plus
// the roster day and team `tonight` the backend sends with it.

test.use({ timezoneId: 'America/New_York' })

type Live = Record<string, unknown> | undefined
const OFFICIAL_AT = '2026-10-19T14:15:00Z'
const AS_OF = '2026-10-20T01:42:00Z'
const TODAY = '2026-10-19'
const TIP = (h: number) => `2026-10-${h >= 24 ? 20 : 19}T${String(h % 24).padStart(2, '0')}:00:00Z`

const LIVE_BLOCKS: Record<string, Live> = {
  'before tip-off': { active: false, period: 24, as_of: null, games_total: 4, games_live: 0, games_final: 0, official_updated_at: OFFICIAL_AT },
  'games live': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 2, games_final: 1, official_updated_at: OFFICIAL_AT },
  'all final, ESPN pending': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 0, games_final: 4, official_updated_at: OFFICIAL_AT },
  'ESPN official': undefined,       // the next morning: Oct 19 is a past day
  'flag off': undefined,
}
type Moment = keyof typeof LIVE_BLOCKS

const TONIGHT: Partial<Record<Moment, object>> = {
  'games live': { gp: 0, points: 0, slots: { SF: 1, F: 1 }, starters_live: 2 },
  'all final, ESPN pending': { gp: 2, points: -3, slots: { SF: 1, F: 1 }, starters_live: 0 },
}

type Phase = 'pre' | 'live' | 'final'
const line = (min: number, fgm: number, fga: number, ftm: number, fta: number, tpm: number, reb: number, ast: number, stl: number, blk: number, pts: number) =>
  ({ minutes: min, fgm, fga, ftm, fta, three_pm: tpm, reb, ast, stl, blk, pts, to: 1 })
const game = (status: Phase | 'scheduled', tip: number, mine?: number, theirs?: number, detail = '') => ({
  status: status === 'pre' ? 'scheduled' : status, detail, start_time: TIP(tip),
  team_score: mine ?? null, opp_score: theirs ?? null,
  won: status === 'final' && mine != null && theirs != null ? mine > theirs : null,
})

// One player per row: slot, name, positions, pro team, opponent, then per moment.
interface Row { slot: string; name: string; pos: string[]; pro: string; opp: string | null; tip?: number; final?: ReturnType<typeof line> | 'dnp'; live?: ReturnType<typeof line>; result?: [number, number]; score?: [number, number]; clock?: string; finalByLive?: boolean }
const ROWS: Row[] = [
  { slot: 'PG', name: 'Ryan Rollins', pos: ['PG', 'SG'], pro: 'MIL', opp: null },
  { slot: 'SG', name: "De'Anthony Melton", pos: ['PG', 'SG'], pro: 'GSW', opp: null },
  { slot: 'SF', name: 'Ausar Thompson', pos: ['SF', 'PF'], pro: 'DET', opp: 'WAS', tip: 23, final: line(31, 5, 11, 2, 4, 0, 8, 4, 3, 1, 12), live: line(22, 3, 8, 1, 2, 0, 5, 3, 2, 1, 7), result: [112, 104], score: [78, 71], clock: 'Q3 4:12' },
  { slot: 'PF', name: 'Tari Eason', pos: ['SF', 'PF'], pro: 'HOU', opp: null },
  { slot: 'C', name: 'Zach Edey', pos: ['C'], pro: 'MEM', opp: null },
  { slot: 'G', name: 'Dyson Daniels', pos: ['PG', 'SG'], pro: 'ATL', opp: null },
  { slot: 'F', name: 'Paul Reed', pos: ['PF', 'C'], pro: 'DET', opp: 'WAS', tip: 23, final: line(22, 4, 6, 1, 2, 0, 7, 1, 1, 2, 9), live: line(14, 2, 3, 0, 0, 0, 4, 1, 0, 1, 4), result: [112, 104], score: [78, 71], clock: 'Q3 4:12' },
  { slot: 'UTIL', name: 'Austin Reaves', pos: ['PG', 'SG'], pro: 'LAL', opp: null },
  { slot: 'UTIL', name: "Kel'el Ware", pos: ['C'], pro: 'MIA', opp: null },
  { slot: 'BE', name: 'Kawhi Leonard', pos: ['SF', 'PF'], pro: 'TOR', opp: 'PHI', tip: 23, final: 'dnp', result: [104, 110], finalByLive: true },
  { slot: 'BE', name: 'Nickeil Alexander-Walker', pos: ['PG', 'SG'], pro: 'ATL', opp: null },
  { slot: 'BE', name: 'Khaman Maluach', pos: ['C'], pro: 'PHX', opp: 'CHA', tip: 26, final: line(12, 2, 3, 0, 0, 0, 4, 0, 0, 1, 4), result: [118, 101] },
  { slot: 'IR', name: 'Anthony Edwards', pos: ['SG', 'SF'], pro: 'MIN', opp: 'DAL', tip: 24, final: line(36, 11, 23, 6, 7, 4, 5, 4, 2, 0, 32), live: line(16, 5, 11, 3, 3, 2, 2, 2, 1, 0, 15), result: [121, 117], score: [51, 48], clock: 'Q2 7:30' },
]

function rosterDay(moment: Moment) {
  const isToday = moment !== 'ESPN official'
  const liveBlock = LIVE_BLOCKS[moment]
  const flagOn = liveBlock !== undefined
  const players = ROWS.map((r, i) => {
    const base = { player_id: 1000 + i, player_name: r.name, positions: r.pos, pro_team: r.pro, lineup_slot: r.slot, opponent: r.opp, added: false, dropped: false }
    if (!r.opp || r.tip === undefined) return { ...base, status: 'no_game', stats: null }
    // Where this player's game is at this moment.
    const phase: Phase = moment === 'before tip-off' ? 'pre'
      : moment === 'games live' ? (r.finalByLive ? 'final' : r.live ? 'live' : 'pre')
      : moment === 'flag off' ? (r.finalByLive ? 'final' : 'pre')
      : 'final'
    if (phase === 'pre') {
      return { ...base, status: 'scheduled', stats: null, ...(flagOn ? { game: game('pre', r.tip) } : {}) }
    }
    if (phase === 'live') {
      return { ...base, status: 'live', stats: r.live, game: game('live', r.tip, r.score?.[0], r.score?.[1], r.clock) }
    }
    const final = game('final', r.tip, r.result?.[0], r.result?.[1], 'Final')
    return r.final === 'dnp'
      ? { ...base, status: 'dnp', stats: null, game: final }
      : { ...base, status: 'played', stats: r.final, game: final }
  })
  return {
    team_id: 1, date: TODAY, scoring_period_id: 24, is_today: isToday, has_games: true,
    lock_at: TIP(23), first_date: '2026-10-01', last_date: isToday ? TODAY : '2026-10-20',
    players, moves: [],
    ...(liveBlock ? { live: liveBlock } : {}),
  }
}

async function atMoment(page: Page, moment: Moment) {
  const live = LIVE_BLOCKS[moment]
  const team = { ...fixture<Record<string, unknown>>('team-detail') }
  delete team.data_date
  await mockApi(page, {
    '/teams/1': {
      ...team,
      ranking_stats: { ...(team.ranking_stats as object), total_points: moment === 'all final, ESPN pending' ? 36 : 39 },
      raw_averages: { ...(team.raw_averages as object), gp: moment === 'all final, ESPN pending' ? 104 : 102 },
      slot_usage: {
        PG: { games_used: 11, cap: 82, remaining: 71 }, SG: { games_used: 10, cap: 82, remaining: 72 },
        SF: { games_used: 11, cap: 82, remaining: 71 }, PF: { games_used: 10, cap: 82, remaining: 72 },
        C: { games_used: 11, cap: 82, remaining: 71 }, G: { games_used: 10, cap: 82, remaining: 72 },
        F: { games_used: 10, cap: 82, remaining: 72 }, UTIL: { games_used: 31, cap: 246, remaining: 215 },
      },
      ...(live ? { live } : {}),
      ...(TONIGHT[moment] ? { tonight: TONIGHT[moment] } : {}),
    },
    '/teams/1/roster-day': rosterDay(moment),
    '/league/summary': { ...fixture<object>('league-summary'), espn_updated_at: OFFICIAL_AT },
    '/nba/scoreboard': { date: TODAY, games: [] },
  })
}

/** Scrolls the first visible element with this test id to the top of the viewport. */
async function toTop(page: Page, testId: string) {
  await page.getByTestId(testId).locator('visible=true').first().evaluate((el) => {
    const y = el.getBoundingClientRect().top + window.scrollY - 180
    window.scrollTo(0, Math.max(0, y))
  })
}

async function shot(page: Page, name: string) {
  const dir = process.env.LIVE_SHOTS
  if (dir) await page.screenshot({ path: `${dir}/${isMobile(page) ? 'mobile' : 'desktop'}-${name}.png`, fullPage: false })
}

const slug = (s: string) => s.replace(/\W+/g, '-').toLowerCase()
const row = (page: Page, name: string) => page.getByTestId('roster-day-row').filter({ hasText: name }).locator('visible=true').first()

for (const moment of Object.keys(LIVE_BLOCKS) as Moment[]) {
  test(`team page Daily roster: ${moment}`, async ({ page }) => {
    await atMoment(page, moment)
    const day = moment === 'ESPN official' ? '&day=2026-10-19' : ''
    const mobile = isMobile(page)

    // Team statistics: deltas and the starters note.
    await page.goto(`/team/1?mode=daily${day}${mobile ? '&ff=mobile' : ''}`)
    const note = page.getByTestId('starters-playing-note').locator('visible=true')
    if (moment === 'games live') {
      await expect(note.first()).toHaveText(/^2 starters are playing now\. Averages and ranks below update when their game goes final/)
    } else {
      await expect(note).toHaveCount(0)
    }
    if (moment === 'all final, ESPN pending') {
      await expect(page.getByText('+2 tonight').locator('visible=true').first()).toBeVisible()
      await expect(page.getByText('▼3 tonight').locator('visible=true').first()).toBeVisible()
    } else {
      await expect(page.getByText(/tonight$/).locator('visible=true')).toHaveCount(0)
    }
    await shot(page, `team-stats-${slug(moment)}`)

    // Slot usage: "+1 live" while live, "+1 tonight" once final.
    if (mobile) await page.getByRole('radio', { name: 'Slots & coverage' }).click()
    else await page.locator('#slot-usage').scrollIntoViewIfNeeded()
    const marks = page.getByTestId('slot-tonight').locator('visible=true')
    if (moment === 'games live') await expect(marks).toHaveText(['+1 live', '+1 live'])
    else if (moment === 'all final, ESPN pending') await expect(marks).toHaveText(['+1 tonight', '+1 tonight'])
    else await expect(marks).toHaveCount(0)
    await shot(page, `team-slots-${slug(moment)}`)

    // The Daily roster.
    if (mobile) await page.getByRole('radio', { name: 'Roster' }).click()
    else await page.getByTestId('roster-day-moves').scrollIntoViewIfNeeded()
    const noteText = page.getByTestId('roster-day-note').locator('visible=true').first()
    const ausar = row(page, 'Ausar Thompson')
    const kawhi = row(page, 'Kawhi Leonard')
    switch (moment) {
      case 'before tip-off':
        await expect(noteText).toHaveText('Live · locks 7:00 PM ET')
        await expect(ausar).toContainText('7:00 PM')
        break
      case 'games live':
        await expect(noteText).toHaveText('Live · 2 starters playing now')
        await expect(ausar).toContainText('LIVE')
        await expect(ausar).toContainText('78–71 · Q3 4:12')
        await expect(kawhi).toContainText('L 104–110')
        await expect(page.getByTestId(mobile ? 'roster-day-totals' : 'roster-day-totals').locator('visible=true').first()).toContainText('Today, so far')
        break
      case 'all final, ESPN pending':
        await expect(noteText).toHaveText('Final · ESPN official pending')
        await expect(ausar).toContainText('W 112–104')
        await expect(page.getByTestId('roster-day-totals').locator('visible=true').first()).toContainText('(Today)')
        break
      case 'ESPN official':
        await expect(noteText).toHaveText(/^Lineup at lock/)
        await expect(ausar).toContainText('W 112–104')
        break
      case 'flag off':
        // Today without a live block: the page as before, plus results of finished games.
        await expect(noteText).toHaveText(/^Live · locks/)
        await expect(ausar).not.toContainText('LIVE')
        await expect(kawhi).toContainText('L 104–110')
        await expect(page.getByTestId('roster-day-totals').locator('visible=true')).toHaveCount(0)
        break
    }
    await toTop(page, 'roster-day-note')
    await shot(page, `team-roster-${slug(moment)}`)
    await expectNoHorizontalScroll(page)
  })
}

test('the Daily spoiler toggle: same setting as Box Scores, opponents only when on', async ({ page }) => {
  await atMoment(page, 'games live')
  const mobile = isMobile(page)
  await page.goto(`/team/1?mode=daily${mobile ? '&ff=mobile&tab=roster' : ''}`)
  const ausar = row(page, 'Ausar Thompson')
  await expect(ausar).toContainText('78–71 · Q3 4:12')
  await toTop(page, 'roster-day-note')
  await shot(page, 'team-roster-spoilers-shown')

  const toggle = page.getByRole(mobile ? 'radio' : 'button', { name: /No spoilers/ }).locator('visible=true').first()
  await toggle.click()
  await expect(ausar).not.toContainText('78–71')
  await expect(ausar).not.toContainText('LIVE')
  await expect(row(page, 'Kawhi Leonard')).not.toContainText('L 104–110')
  await expect(ausar).toContainText('vs WAS')
  await expect(page.getByTestId('roster-day-note').locator('visible=true').first()).toHaveText(/^Live · lock/)
  await expect(page.getByTestId('roster-day-totals').locator('visible=true')).toHaveCount(0)
  await toTop(page, 'roster-day-note')
  await page.waitForTimeout(400)   // let the switch finish its colour transition
  await shot(page, 'team-roster-no-spoilers')

  // The setting is the Box Scores one.
  expect(await page.evaluate(() => localStorage.getItem('fw:boxScores.noSpoilers'))).toBe('true')
  await expectNoHorizontalScroll(page)
})

test('the morning after: Played only on tonight\'s roster once its games are counted', async ({ page }) => {
  await atMoment(page, 'all final, ESPN pending')
  const mobile = isMobile(page)
  await page.goto(`/team/1?mode=daily${mobile ? '&ff=mobile&tab=roster' : ''}`)
  await expect(row(page, 'Ausar Thompson')).toContainText('W 112–104')
  await expect(row(page, 'Kawhi Leonard')).toBeVisible()
  await page.getByRole('button', { name: 'Played only' }).locator('visible=true').first().click()
  await expect(row(page, 'Ausar Thompson')).toBeVisible()
  await expect(page.getByTestId('roster-day-row').filter({ hasText: 'Kawhi Leonard' }).locator('visible=true')).toHaveCount(0)
  await expect(page.getByTestId('roster-day-row').filter({ hasText: 'Ryan Rollins' }).locator('visible=true')).toHaveCount(0)
  await toTop(page, 'roster-day-note')
  await shot(page, 'team-roster-played-only-tonight')
  await expectNoHorizontalScroll(page)
})

test('a past day has no spoiler toggle and always shows its results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fw:boxScores.noSpoilers', 'true'))
  await atMoment(page, 'ESPN official')
  const mobile = isMobile(page)
  await page.goto(`/team/1?mode=daily&day=2026-10-19${mobile ? '&ff=mobile&tab=roster' : ''}`)
  await expect(row(page, 'Ausar Thompson')).toContainText('W 112–104')
  await expect(page.getByRole(mobile ? 'radio' : 'button', { name: /No spoilers/ }).locator('visible=true')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Played only' }).locator('visible=true').first()).toBeVisible()
  await toTop(page, 'roster-day-note')
  await shot(page, 'team-roster-past-day')
})

test('the Daily roster polls every 60 s while games are live', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T22:00:00-04:00') })
  let hits = 0
  await atMoment(page, 'games live')
  await page.route('**/api/teams/1/roster-day*', async (route) => {
    hits += 1
    await route.fulfill({ json: rosterDay('games live') })
  })
  await page.goto(`/team/1?mode=daily${isMobile(page) ? '&ff=mobile&tab=roster' : ''}`)
  await expect(row(page, 'Ausar Thompson')).toContainText('LIVE')
  const first = hits
  // The 60 s timer starts once the first response has set the interval, which
  // can land just after the first jump; two minutes always cover a poll.
  await page.clock.fastForward(61_000)
  await page.waitForTimeout(300)
  await page.clock.fastForward(61_000)
  await expect.poll(() => hits).toBeGreaterThan(first)
})
