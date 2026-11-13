import type { Page } from '@playwright/test'
import { test, expect, expectNoHorizontalScroll, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'

// Live standings (PR 3): the badge, its tap sheet and the page notes in each
// "moment of the day". The frontend has no flag; it follows the `live` block
// the backend adds to responses, so every moment is a different block.

type Live = Record<string, unknown> | undefined
const OFFICIAL_AT = '2026-10-19T07:15:00Z'
const AS_OF = '2026-10-19T08:42:00Z'

const MOMENTS: Record<string, Live> = {
  'before tip-off': { active: false, period: 24, as_of: null, games_total: 4, games_live: 0, games_final: 0, official_updated_at: OFFICIAL_AT },
  'games live': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 2, games_final: 1, official_updated_at: OFFICIAL_AT },
  'all final, ESPN pending': { active: true, period: 24, as_of: AS_OF, games_total: 4, games_live: 0, games_final: 4, official_updated_at: OFFICIAL_AT },
  'ESPN official': { active: false, period: 25, as_of: null, games_total: 0, games_live: 0, games_final: 0, official_updated_at: '2026-10-19T14:15:00Z' },
}
const NO_LIVE_BLOCK = 'flag off (no live block)'

const side = (a: string) => ({ team_id: a, name: a, short_name: a, abbreviation: a, logo: '', color: '', record: '', score: null, winner: false })
const game = (id: string, away: string, home: string, status: string, detail: string) =>
  ({ game_id: id, status, status_detail: detail, start_time: '2026-10-19T07:00:00Z', broadcast: '', venue: '', away: side(away), home: side(home) })
const SCOREBOARD = (live: Live) => ({
  date: '2026-10-21',
  games: live?.games_live === 0
    ? ['TOR @ PHI', 'DET @ WSH', 'DAL @ MIN', 'CHA @ PHX'].map((n, i) => game(String(i), n.split(' @ ')[0], n.split(' @ ')[1], 'final', 'Final'))
    : [game('0', 'TOR', 'PHI', 'final', 'Final'), game('1', 'DET', 'WSH', 'live', 'Q3 4:12'), game('2', 'DAL', 'MIN', 'live', 'Q2 7:30'), game('3', 'CHA', 'PHX', 'scheduled', '4:00 AM')],
})

async function withLive(page: Page, live: Live) {
  // Fixtures carry a data_date (the DB-fallback "Data as of" mode); live data is never in that mode.
  const withBlock = <T extends object>(body: T) => {
    const rest: Record<string, unknown> = { ...(body as object) }
    delete rest.data_date
    return live ? { ...rest, live } : rest
  }
  await mockApi(page, {
    '/rankings': withBlock(fixture<object>('rankings')),
    '/analytics/heatmap': withBlock(fixture<object>('heatmap')),
    '/league/summary': withBlock({ ...fixture<object>('league-summary'), espn_updated_at: OFFICIAL_AT }),
    '/teams/1': withBlock({
      ...fixture<object>('team-detail'),
      slot_usage: { PG: { games_used: 11, cap: 82, remaining: 71 }, UTIL: { games_used: 31, cap: 246, remaining: 215 } },
    }),
    '/nba/scoreboard': SCOREBOARD(live),
    '/league/rank-changes': { previous_period: 1, latest_period: 2, teams: [] },
  })
}

const PAGES = [
  { name: 'Rankings', path: '/rankings' },
  { name: 'Analytics heatmap', path: '/analytics' },
  { name: 'Today', path: '/' },
  { name: 'Team page', path: '/team/1' },
]

async function shot(page: Page, name: string) {
  const dir = process.env.LIVE_SHOTS
  if (dir) await page.screenshot({ path: `${dir}/${isMobile(page) ? 'mobile' : 'desktop'}-${name}.png`, fullPage: false })
}

for (const pg of PAGES) {
  for (const [moment, live] of Object.entries<Live>({ ...MOMENTS, [NO_LIVE_BLOCK]: undefined })) {
    test(`${pg.name}: ${moment}`, async ({ page }) => {
      await withLive(page, live)
      await page.goto(`${pg.path}${isMobile(page) ? (pg.path.includes('?') ? '&' : '?') + 'ff=mobile' : ''}`)
      const badge = page.getByRole('button', { name: /^(LIVE|FINAL)/ })
      const slug = `${pg.name.replace(/\W+/g, '-')}-${moment.replace(/\W+/g, '-')}`.toLowerCase()

      if (live?.active) {
        await expect(badge).toBeVisible()
        await expect(page.getByText(/ESPN updated/)).toHaveCount(0)
        const label = live.games_live === 0 ? 'FINAL' : 'LIVE'
        await expect(badge).toContainText(label)
        if (isMobile(page)) await expect(badge).toContainText(live.games_live === 0 ? '4 of 4' : '2 of 4')
        await shot(page, slug)
        await badge.click()
        await expect(page.getByText("Tonight's games").first()).toBeVisible()
        await expect(page.getByText('TOR @ PHI')).toBeVisible()
        await shot(page, `${slug}-sheet`)
      } else {
        await expect(badge).toHaveCount(0)
        await expect(page.getByText(/ESPN updated/).locator('visible=true').first()).toBeVisible()
        await shot(page, slug)
      }
      await expectNoHorizontalScroll(page)
    })
  }
}

test('Rankings explains what averages and totals count while live (desktop header, phone sheet)', async ({ page }) => {
  await withLive(page, MOMENTS['games live'])
  await page.goto(`/rankings${isMobile(page) ? '?ff=mobile' : ''}`)
  if (isMobile(page)) {
    await page.getByRole('button', { name: /^LIVE/ }).click()
    await expect(page.getByRole('dialog').getByText(/Averages count finished games only/)).toBeVisible()
  } else {
    await expect(page.getByText(/Averages count finished games only. 2 games in progress/)).toBeVisible()
    await page.getByRole('button', { name: 'Totals', exact: true }).click()
    await expect(page.getByText('Totals include the 2 games still in progress.')).toBeVisible()
  }
})

test('team page subtitles carry a short live status', async ({ page }) => {
  test.skip(isMobile(page), 'desktop sections; the phone page has its own cards')
  await withLive(page, MOMENTS['games live'])
  await page.goto('/team/1')
  await expect(page.getByText(/live, finished games counted/)).toBeVisible()
  await expect(page.getByText(/includes 2 games in progress/)).toBeVisible()
})

test('polls every 60 s only while games are live, not when all are final', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T12:00:00-04:00') })
  let rankingHits = 0
  await withLive(page, MOMENTS['games live'])
  await page.route('**/api/rankings*', async (route) => {
    rankingHits += 1
    await route.fulfill({ json: { ...fixture<object>('rankings'), live: MOMENTS['games live'] } })
  })
  await page.goto(`/rankings${isMobile(page) ? '?ff=mobile' : ''}`)
  await expect(page.getByRole('button', { name: /^LIVE/ })).toBeVisible()
  const first = rankingHits
  await page.clock.fastForward(61_000)
  await expect.poll(() => rankingHits).toBeGreaterThan(first)
})
