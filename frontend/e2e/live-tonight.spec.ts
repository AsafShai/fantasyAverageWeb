import type { Page, Route } from '@playwright/test'
import { test, expect, expectNoHorizontalScroll, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'
import {
  heatmap, LIVE_BLOCKS, overTime, rangeRankings, rankChanges, rankings, summary, todayHub, type Moment,
} from './support/liveTonightData'

// PR 5: what "tonight" changes on Today (Rank movers switch, Top 5, league
// averages), Rankings (▲/▼ legend, ranges that end today), the heatmap (GP
// "+N", ranges) and Rankings Over Time (dashed live point), in each moment of
// the day plus the backend flag off (no `live` block anywhere).

const MOMENTS: Moment[] = ['before tip-off', 'games live', 'all final, ESPN pending', 'ESPN official', 'flag off']
const tonight = (m: Moment) => m === 'games live' || m === 'all final, ESPN pending'

const side = (a: string) => ({ team_id: a, name: a, short_name: a, abbreviation: a, logo: '', color: '', record: '', score: null, winner: false })
const game = (id: string, away: string, home: string, status: string, detail: string) =>
  ({ game_id: id, status, status_detail: detail, start_time: '2026-11-13T00:00:00Z', broadcast: '', venue: '', away: side(away), home: side(home) })

async function setUp(page: Page, m: Moment) {
  await page.clock.setFixedTime(new Date('2026-11-13T09:00:00Z'))
  const live = LIVE_BLOCKS[m]
  await mockApi(page, {
    '/rankings': (route: Route) => route.fulfill({
      json: new URL(route.request().url()).searchParams.has('start_date') ? rangeRankings(m, route.request().url()) : rankings(m),
    }),
    '/analytics/heatmap': (route: Route) => {
      const url = new URL(route.request().url())
      const body = heatmap(m) as Record<string, unknown>
      if (!url.searchParams.has('start_date')) return route.fulfill({ json: body })
      const ranged = rangeRankings(m, route.request().url()) as Record<string, unknown>
      const dates = Object.fromEntries(Object.entries(ranged).filter(([k]) => k.startsWith('date_range') || k.startsWith('actual_')))
      return route.fulfill({ json: { ...body, ...dates, live: ranged.live } })
    },
    '/league/summary': summary(m, { ...fixture<Record<string, unknown>>('league-summary'), season_start: '2026-10-21' }),
    '/league/today': todayHub(m, fixture<Record<string, unknown>>('today-hub')),
    '/league/rank-changes': rankChanges(m),
    '/analytics/over-time': overTime(m),
    '/nba/scoreboard': {
      date: '2026-11-12',
      games: live?.games_live === 0
        ? [game('0', 'TOR', 'PHI', 'final', 'Final'), game('1', 'DET', 'WSH', 'final', 'Final'), game('2', 'DAL', 'MIN', 'final', 'Final'), game('3', 'CHA', 'PHX', 'final', 'Final')]
        : [game('0', 'TOR', 'PHI', 'final', 'Final'), game('1', 'DET', 'WSH', 'live', 'Q3 4:12'), game('2', 'DAL', 'MIN', 'live', 'Q2 7:30'), game('3', 'CHA', 'PHX', 'scheduled', '4:00 AM')],
    },
  })
}

const url = (page: Page, path: string) => `${path}${isMobile(page) ? (path.includes('?') ? '&' : '?') + 'ff=mobile' : ''}`
const slug = (...parts: string[]) => parts.join('-').replace(/\W+/g, '-').replace(/-+$/, '').toLowerCase()

async function shot(page: Page, name: string, fullPage = false) {
  const dir = process.env.LIVE_SHOTS
  if (dir) await page.screenshot({ path: `${dir}/${isMobile(page) ? 'mobile' : 'desktop'}-${name}.png`, fullPage })
}

for (const m of MOMENTS) {
  test(`Today: ${m}`, async ({ page }) => {
    await setUp(page, m)
    await page.goto(url(page, '/'))
    await expect(page.getByRole('heading', { name: 'Rank movers' })).toBeVisible()
    const tonightButton = page.getByRole(isMobile(page) ? 'radio' : 'button', { name: 'Tonight', exact: true })
    if (tonight(m)) {
      await expect(tonightButton).toBeVisible()
      await expect(page.getByText(m === 'games live'
        ? 'Roto points now vs this morning’s official standings (finished games)'
        : 'Roto points after tonight vs this morning’s official standings')).toBeVisible()
      await expect(page.getByText('pts · change tonight')).toBeVisible()
      await expect(page.locator('[data-moved]').first()).toBeVisible()
      await expect(page.getByText(m === 'games live' ? 'per team, season to date · incl. tonight’s finished games' : /^per team, season to date · incl\. tonight$/)).toBeVisible()
    } else {
      await expect(tonightButton).toHaveCount(0)
      await expect(page.getByText('vs yesterday').first()).toBeVisible()
      await expect(page.getByText('pts · change tonight')).toHaveCount(0)
      await expect(page.locator('[data-moved]')).toHaveCount(0)
    }
    await shot(page, slug('today', m), true)
    if (tonight(m)) {
      await page.getByRole(isMobile(page) ? 'radio' : 'button', { name: 'vs yesterday' }).click()
      await expect(page.getByText('Roto points, latest official day vs the day before')).toBeVisible()
    }
    await expectNoHorizontalScroll(page)
  })

  test(`Rankings movers legend: ${m}`, async ({ page }) => {
    await setUp(page, m)
    await page.goto(url(page, '/rankings'))
    const legend = m === 'games live'
      ? '▲/▼ = change tonight so far, GP + = games counted tonight.'
      : m === 'all final, ESPN pending'
        ? '▲/▼ = change tonight, GP + = games played tonight.'
        : '▲/▼ = change since last night, GP + = games played last night.'
    await expect(page.getByText(legend, { exact: false }).first()).toBeVisible()
    await shot(page, slug('rankings', m))
    await expectNoHorizontalScroll(page)
  })

  test(`Rankings range ending today: ${m}`, async ({ page }) => {
    await setUp(page, m)
    await page.goto(url(page, '/rankings?from=2026-11-06&to=2026-11-13'))
    const note = page.getByText(
      m === 'games live' ? 'Nov 6 – tonight (live). Averages count tonight’s finished games; totals include games in progress.'
        : m === 'all final, ESPN pending' ? 'Nov 6 – Nov 12. Tonight is complete; ESPN official pending.'
          : m === 'before tip-off' ? 'Nov 5 – Nov 11. Today is added once the first game starts.'
            : /closest available data used/,
    )
    await expect(note.first()).toBeVisible()
    await note.first().scrollIntoViewIfNeeded()
    await shot(page, slug('rankings-range', m))
  })

  test(`Heatmap: ${m}`, async ({ page }) => {
    await setUp(page, m)
    await page.goto(url(page, '/analytics'))
    await expect(page.getByText('Khachapuri\'s Team').first()).toBeVisible()
    if (tonight(m)) await expect(page.getByText('+2', { exact: true }).first()).toBeVisible()
    else await expect(page.getByText('+2', { exact: true })).toHaveCount(0)
    await shot(page, slug('heatmap', m))
    // Range that ends today, from the quick range.
    await page.getByRole('button', { name: /Last 7d|last 7 days/ }).click()
    await page.getByRole('button', { name: 'Apply' }).click()
    if (tonight(m)) await expect(page.getByTestId('live-range-note').or(page.getByText(/tonight|Tonight is complete/)).first()).toBeVisible()
    await shot(page, slug('heatmap-range', m))
    await expectNoHorizontalScroll(page)
  })

  test(`Rankings Over Time: ${m}`, async ({ page }) => {
    await setUp(page, m)
    if (isMobile(page)) {
      await page.goto(url(page, '/analytics?tab=race'))
    } else {
      await page.goto('/analytics')
      await page.getByRole('button', { name: 'Rankings Over Time' }).click()
    }
    await expect(page.getByText(/Standings Race/).first()).toBeVisible()
    if (tonight(m)) {
      await expect(page.getByTestId('race-live-point')).toHaveCount(12)
      await expect(page.getByTestId('race-live-note')).toHaveText('The dashed segment is tonight. It is not stored; the solid point replaces it after ESPN’s update.')
      await expect(page.locator('text').filter({ hasText: m === 'games live' ? /^Live$/ : /^Tonight$/ }).first()).toBeVisible()
    } else {
      await expect(page.getByTestId('race-live-point')).toHaveCount(0)
      await expect(page.getByTestId('race-live-note')).toHaveCount(0)
    }
    await page.getByTestId('race-live-note').or(page.getByText(/▲\/▼ in the tooltip/)).first().scrollIntoViewIfNeeded()
    await shot(page, slug('race', m))
  })
}
