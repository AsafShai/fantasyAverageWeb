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

const LINE = { pts: 24.3, reb: 8.1, ast: 4, three_pm: 3, stl: 1, blk: 0.5, fgm: 9, fga: 18, fg_pct: 0.5, ftm: 3, fta: 4, ft_pct: 0.75 }

async function mockPlayerApis(page: Page) {
  const predicted: number[] = []
  const players = withIds()
  // Registered after the default mocks, so these win.
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (path === '/players' || path === '/players/') return route.fulfill({ json: players })
    if (path === '/teams/1/players')
      return route.fulfill({ json: { team_id: 1, last_updated: '', players: players.players.filter((p) => p.team_id === 1).map((p) => ({ ...p, lineup_slot: 'PG' })) } })
    if (path === '/projections/player/100')
      return route.fulfill({
        json: { player_name: 'Alpha Star', team: 'LAL', game_date: '2026-10-21', opponent: 'BOS', is_home: true, scheduled: true, default_minutes: 31, status: 'green', reason: '', stats: LINE },
      })
    if (path === '/projections/predict') {
      const body = route.request().postDataJSON() as { minutes: number }
      predicted.push(body.minutes)
      return route.fulfill({ json: { stats: { ...LINE, pts: 30.5 } } })
    }
    return route.fallback()
  })
  return { predicted }
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
      await expect(sheet.getByRole('list', { name: 'Season per game' }).getByText(k, { exact: true })).toBeVisible()
    }
    await expect(sheet.getByRole('region', { name: 'Next game projection' })).toContainText('Next: vs BOS')
    await expectNoHorizontalScroll(page)

    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/players$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('minutes stepper calls POST /projections/predict', async ({ page }) => {
    const { predicted } = await mockPlayerApis(page)
    await page.goto('/players?ff=mobile')
    await page.goto('/players?player=100')
    const proj = page.getByRole('region', { name: 'Next game projection' })
    await expect(proj).toContainText('24.3')
    await proj.getByRole('button', { name: /More minutes/ }).click()
    await expect(proj).toContainText('30.5')
    expect(predicted).toEqual([32])
    await proj.getByRole('button', { name: /Reset to default minutes/ }).click()
    await expect(proj).toContainText('24.3')
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
      await expect(sheet.getByRole('region', { name: 'Next game projection' })).toBeVisible()
      for (const name of ['Full profile', 'Trade Analyzer']) {
        const box = (await sheet.getByRole('button', { name }).boundingBox())!
        expect(box.y + box.height, `${name} at ${width}x${height}`).toBeLessThanOrEqual(height)
      }
      await expectNoHorizontalScroll(page)
    }
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
