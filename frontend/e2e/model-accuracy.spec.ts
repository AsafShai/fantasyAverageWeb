import type { Page } from '@playwright/test'
import { test, expect, expectNoHorizontalScroll, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'

// Fixtures are real API output from the 2025-26 season replayed locally through
// the snapshot -> nightly -> reconcile path (players trimmed to 20).
const players = fixture<{ players: { player_id: number; player_name: string }[] }>('model-accuracy-players')

/** Mocks the Model vs. Reality endpoints; every listed player is on a fantasy
 *  roster so the default "All rostered" filter shows them. */
async function mockAccuracy(page: Page, overrides: Record<string, unknown> = {}) {
  await mockApi(page, {
    '/model-accuracy/summary': (route: import('@playwright/test').Route) =>
      route.fulfill({
        json: fixture(
          route.request().url().includes('mode=retro') ? 'model-accuracy-summary-retro' : 'model-accuracy-summary-pregame',
        ),
      }),
    '/model-accuracy/weekly': fixture('model-accuracy-weekly'),
    '/model-accuracy/misses': fixture('model-accuracy-misses'),
    '/model-accuracy/players': players,
    '/model-accuracy/player/4432166': fixture('model-accuracy-player'),
    '/nba-players/4432166': fixture('nba-player-4432166'),
    '/players': {
      players: players.players.map((p) => ({
        player_id: p.player_id, player_name: p.player_name, team_id: 1, status: 'ONTEAM',
        pro_team: 'DET', positions: [], stats: {}, fantasy_team_name: 'Fantasy One',
      })),
      total_count: players.players.length, page: 1, limit: 1200, has_more: false,
    },
    ...overrides,
  })
}

/** Stricter than expectNoHorizontalScroll: the app sets overflow-x: hidden on
 *  html/body, so a too-wide block is clipped rather than scrolled and
 *  scrollWidth never sees it. Checks every element outside a scroll container. */
async function expectNothingPastViewport(page: Page) {
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const inScroller = (el: Element) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX
        if (o === 'auto' || o === 'scroll') return true
      }
      return false
    }
    return [...document.querySelectorAll('main *')]
      .filter((el) => !inScroller(el) && el.getBoundingClientRect().right > width + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`)
  })
  expect(offenders, 'elements past the right edge of the viewport').toEqual([])
}

test.describe('Model vs. Reality page', () => {
  test('shows accuracy against the baseline, misses and players', async ({ page }) => {
    await mockAccuracy(page)
    await page.goto('/model-accuracy')

    await expect(page.getByRole('heading', { name: 'Model vs. Reality' })).toBeVisible()
    await expect(page.getByText('Categories beating baseline')).toBeVisible()
    const table = page.getByRole('table').first()
    for (const cat of ['PTS', 'REB', 'AST', '3PM', 'STL', 'BLK', 'FG%', 'FT%']) {
      await expect(table.getByRole('cell', { name: cat, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Weekly trend' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Biggest misses, week of/ })).toBeVisible()
    await expect(page.getByText(/Projected but didn't play/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Players vs. their projections' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Last \d+ games vs projection/ }).first()).toBeVisible()

    await expectNoHorizontalScroll(page)
    await expectNothingPastViewport(page)
  })

  test('given-minutes mode explains itself and hides pre-game-only sections', async ({ page }) => {
    await mockAccuracy(page)
    await page.goto('/model-accuracy')
    await expect(page.getByRole('heading', { name: /Biggest misses/ })).toBeVisible()

    await page.getByRole('button', { name: 'Given actual minutes' }).click()

    await expect(page.getByText(/measures per-minute\s+skill only/)).toBeVisible()
    await expect(page.getByText('Given', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Biggest misses/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Players vs. their projections' })).toHaveCount(0)
  })

  test('players table shows 15 rows until expanded', async ({ page }) => {
    await mockAccuracy(page)
    await page.goto('/model-accuracy')
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Players vs. their projections' }) })
    await expect(section.locator('tbody tr')).toHaveCount(15)

    await section.getByRole('button', { name: 'Show all 20 players' }).click()
    await expect(section.locator('tbody tr')).toHaveCount(20)
  })

  test('before any graded game it says so and offers the given-minutes view', async ({ page }) => {
    await mockAccuracy(page, {
      '/model-accuracy/summary': (route: import('@playwright/test').Route) =>
        route.fulfill({
          json: route.request().url().includes('mode=retro')
            ? fixture('model-accuracy-summary-retro')
            : { mode: 'pregame', window: 'season', start: null, end: null, games: 0, dnp: 0, categories: [], minutes: null, first_snapshot_date: null },
        }),
      '/model-accuracy/misses': { week_start: null, misses: [], didnt_play: [], didnt_play_count: 0 },
      '/model-accuracy/players': { players: [] },
    })
    await page.goto('/model-accuracy')

    await expect(page.getByText('No graded pre-game projections yet.')).toBeVisible()
    await page.getByRole('button', { name: 'See given-minutes accuracy instead' }).click()
    await expect(page.getByRole('heading', { name: 'Accuracy by category' })).toBeVisible()
  })
})

test.describe('Model vs. Reality on phones', () => {
  test.skip(({ page }) => !isMobile(page), 'mobile only')

  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }]) {
    test(`fits ${viewport.width}px with readable tables and tappable controls`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockAccuracy(page)
      await page.goto('/model-accuracy')
      await expect(page.getByRole('heading', { name: 'Players vs. their projections' })).toBeVisible()

      // Category table: the to-scale bar becomes a signed number, Games drops
      // out, and the hit rate column is on screen without scrolling the table.
      const table = page.getByRole('table').first()
      await expect(table.locator('th', { hasText: 'Games' })).toHaveCount(1)
      await expect(table.locator('th', { hasText: 'Games' })).toBeHidden()
      await expect(table.getByText(/^[+-]\d+\.\d%$/).filter({ visible: true })).toHaveCount(8)
      const hit = await table.locator('th', { hasText: /^Hit/ }).boundingBox()
      expect(hit!.x + hit!.width).toBeLessThanOrEqual(viewport.width)

      // Players: stats fold under the name, so the row is name + strip.
      const section = page.locator('section', { has: page.getByRole('heading', { name: 'Players vs. their projections' }) })
      await expect(section.locator('th', { hasText: /PTS proj/ })).toHaveCount(1)
      await expect(section.locator('th', { hasText: /PTS proj/ })).toBeHidden()
      await expect(section.locator('tbody tr').first().getByText(/^PTS /)).toBeVisible()

      for (const name of ['Pre-game projections', 'Given actual minutes', 'Season', `Show all ${players.players.length} players`]) {
        const box = await page.getByRole('button', { name }).boundingBox()
        expect(box!.height, `${name} tap height`).toBeGreaterThanOrEqual(32)
      }

      await expectNoHorizontalScroll(page)
      await expectNothingPastViewport(page)
    })
  }
})

test.describe('PlayerProfile accuracy card', () => {
  test('shows the last graded games for the player', async ({ page }) => {
    await mockAccuracy(page)
    await page.goto('/player/4432166')

    await expect(page.getByRole('main').getByText('Model vs. Reality', { exact: true })).toBeVisible()
    await expect(page.getByText(/Last \d+ games · pre-game projections/)).toBeVisible()
    await expect(page.getByRole('img', { name: /Last \d+ games vs projection/ })).toBeVisible()
    await expectNothingPastViewport(page)
  })

  test('is absent for a player with no graded projections', async ({ page }) => {
    await mockAccuracy(page, { '/model-accuracy/player/4432166': null })
    await page.goto('/player/4432166')

    await expect(page.getByRole('heading', { name: /Cade Cunningham/ })).toBeVisible()
    await expect(page.getByRole('main').getByText('Model vs. Reality', { exact: true })).toHaveCount(0)
  })
})
