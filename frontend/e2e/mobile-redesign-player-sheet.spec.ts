import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { API_BASE_URL, fixture } from './support/mockApi'

// Step 3 of the mobile redesign: the player sheet, opened from any player
// name on a phone (?player=<id>), closed by browser back.

type Fx = { players: Array<Record<string, unknown>> }

function withIds() {
  const data = fixture<Fx>('players')
  data.players = data.players.map((p, i) => ({
    ...p,
    player_id: 100 + i,
    ...(p.status === 'ONTEAM' ? { fantasy_team_name: 'Alpha Team' } : {}),
  }))
  return data
}

async function mockPlayerApis(page: Page) {
  const players = withIds()
  const periods: string[] = []
  // Registered after the default mocks, so these win.
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, '')
    if (path === '/players' || path === '/players/') {
      const period = url.searchParams.get('time_period') ?? 'season'
      periods.push([period, url.searchParams.get('start'), url.searchParams.get('end')].filter(Boolean).join(' '))
      if (period === 'season') return route.fulfill({ json: players })
      // In any window Alpha Star played 2 games for 40 pts.
      const windowed = players.players.map((p) =>
        p.player_id === 100 ? { ...p, stats: { ...(p.stats as object), pts: 40, gp: 2 } } : p,
      )
      return route.fulfill({ json: { ...players, players: windowed } })
    }
    if (path === '/teams/1/players')
      return route.fulfill({ json: { team_id: 1, last_updated: '', players: players.players.filter((p) => p.team_id === 1).map((p) => ({ ...p, lineup_slot: 'PG' })) } })
    return route.fallback()
  })
  return { periods }
}

test('desktop: player names still go to the profile page', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await mockPlayerApis(page)
  await page.goto('/players?ff=mobile')
  await expect(page.getByRole('link', { name: 'Alpha Star' }).first()).toHaveAttribute('href', '/player/100')
})

test.describe('phone player sheet', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('a name opens the sheet over the page; back closes it first', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/teams?ff=mobile')
    await page.goto('/players')
    await page.getByRole('link', { name: 'Alpha Star' }).first().click()
    await expect(page).toHaveURL(/\/players\?player=100$/)

    const sheet = page.getByRole('dialog', { name: 'Alpha Star' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('LAL · PG/SG · PG · 10 GP')
    await expect(sheet.getByRole('link', { name: 'Alpha Team' })).toBeVisible()
    await expect(sheet.getByText('SEASON · PER GAME')).toBeVisible()
    for (const k of ['MPG', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%']) {
      await expect(sheet.getByRole('list', { name: 'Per game' }).getByText(k, { exact: true })).toBeVisible()
    }
    await expect(sheet.getByRole('region', { name: 'Next game projection' })).toHaveCount(0)
    await expectNoHorizontalScroll(page)

    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/players$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('shared link opens the sheet; Full profile replaces it, back returns to the page', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/teams?ff=mobile')
    await page.goto('/players?player=100')
    const sheet = page.getByRole('dialog', { name: 'Alpha Star' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Full profile' }).click()
    await expect(page).toHaveURL(/\/player\/100$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('scrim tap closes the sheet and drops ?player=', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/players?ff=mobile')
    await page.getByRole('link', { name: 'Alpha Star' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Alpha Star' })).toBeVisible()
    await page.mouse.click(195, 60)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/players$/)
  })

  test('a player search result opens the sheet over the current page', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/teams?ff=mobile')
    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click()
    await page.getByRole('dialog', { name: 'Search' }).getByRole('textbox').fill('Alpha')
    await page.getByRole('dialog', { name: 'Search' }).getByText('Alpha Star').click()
    await expect(page).toHaveURL(/\/teams\?player=100$/)
    await expect(page.getByRole('dialog', { name: 'Alpha Star' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('short screens: the sheet scrolls inside and its buttons stay on screen', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/players?ff=mobile')
    for (const [width, height] of [[341, 605], [320, 568], [390, 480]]) {
      await page.setViewportSize({ width, height })
      await page.goto('/players?player=100')
      const sheet = page.getByRole('dialog', { name: 'Alpha Star' })
      await expect(sheet.getByRole('list', { name: 'Per game' })).toBeVisible()
      for (const name of ['Full profile', 'Trade Analyzer']) {
        const box = (await sheet.getByRole('button', { name }).boundingBox())!
        expect(box.y + box.height, `${name} at ${width}x${height}`).toBeLessThanOrEqual(height)
      }
      await expectNoHorizontalScroll(page)
    }
  })

  test('period chips and a custom range switch the per-game grid', async ({ page }) => {
    const { periods } = await mockPlayerApis(page)
    await page.goto('/players?ff=mobile')
    await page.goto('/players?player=100')
    const sheet = page.getByRole('dialog', { name: 'Alpha Star' })
    await expect(sheet.getByText('SEASON · PER GAME')).toBeVisible()

    await sheet.getByRole('button', { name: /Last 15 Days/ }).click()
    await expect(sheet.getByText('LAST 15 DAYS · PER GAME · 2 GP')).toBeVisible()
    await expect(sheet.getByRole('list', { name: 'Per game' })).toContainText('PTS20.0')
    expect(periods).toContain('last_15')

    await sheet.getByRole('button', { name: /Custom/ }).click()
    await sheet.getByLabel('Start date').fill('2026-10-10')
    await sheet.getByLabel('End date').fill('2026-10-18')
    await sheet.getByRole('button', { name: 'Apply' }).click()
    await expect(sheet.getByText('OCT 10 – OCT 18 · PER GAME · 2 GP')).toBeVisible()
    expect(periods).toContain('custom 2026-10-10 2026-10-18')

    await sheet.getByRole('button', { name: 'Clear custom range' }).click()
    await expect(sheet.getByText('LAST 15 DAYS · PER GAME · 2 GP')).toBeVisible()
    // back from the sheet still returns to the page under it
    await page.goBack()
    await expect(sheet).toHaveCount(0)
  })

  test('Trade Analyzer opens with the player already in the trade', async ({ page }) => {
    await mockPlayerApis(page)
    await page.goto('/players?ff=mobile')
    await page.goto('/players?player=100')
    await page.getByRole('dialog', { name: 'Alpha Star' }).getByRole('button', { name: 'Trade Analyzer' }).click()
    await expect(page).toHaveURL(/\/trade$/)
    // Picked on his team's side (no My Team set). Visible text only, so a
    // closed <select> listing him does not count.
    await expect(page.getByRole('main').getByText('Alpha Star', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  })
})
