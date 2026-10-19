import { readFileSync } from 'node:fs'
import type { Download, Page } from '@playwright/test'
import { test, expect, expectNoHorizontalScroll, isMobile } from './support/test'
import { fixture, mockApi } from './support/mockApi'

// "Share as image" on Rankings, Team Detail and the Trade Analyzer
// (FF_SHARE_CARDS, switched on in playwright.config.ts).

const CATEGORIES = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%']
const TEAMS = [
  { team_id: 1, team_name: 'Fantasy One' },
  { team_id: 2, team_name: 'Second Team' },
  { team_id: 3, team_name: 'Third Wheel' },
  { team_id: 4, team_name: 'Fourth Quarter' },
]

// Roto points per category (4 = first of 4 teams), rotated so each team
// leads somewhere.
const rankingRow = (index: number) => {
  const category_ranks = Object.fromEntries(CATEGORIES.map((c, ci) => [c, ((index + ci) % 4) + 1]))
  const stats = Object.fromEntries(CATEGORIES.map((c, ci) =>
    [c, c.endsWith('%') ? 0.45 + ci / 100 : 10 + index + ci]))
  return {
    team: TEAMS[index],
    fg_percentage: 0.47, ft_percentage: 0.8, three_pm: 12, ast: 24, reb: 43, stl: 7, blk: 4, pts: 110,
    gp: 80,
    total_points: Object.values(category_ranks).reduce((a, b) => a + b, 0),
    rank: index + 1,
    category_ranks,
    stats,
  }
}

const RANKINGS = {
  averages_rankings: TEAMS.map((_, i) => rankingRow(i)),
  totals_rankings: TEAMS.map((_, i) => rankingRow(i)),
  categories: [...CATEGORIES, 'TOTAL_POINTS'],
  last_updated: '2026-10-18T09:41:00Z',
  data_date: '2026-10-19',
}

type TeamDetailFixture = { players: { player_name: string; team_id: number }[] } & Record<string, unknown>

const teamDetail = (index: number, playerNames: [string, string]) => {
  const base = fixture<TeamDetailFixture>('team-detail')
  const row = rankingRow(index)
  return {
    ...base,
    team: TEAMS[index],
    players: base.players.map((p, i) => ({ ...p, player_name: playerNames[i], team_id: TEAMS[index].team_id })),
    ranking_stats: row,
    category_ranks: row.category_ranks,
  }
}

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '1'))
  await mockApi(page, {
    '/rankings': RANKINGS,
    '/teams/': TEAMS,
    '/teams/1': teamDetail(0, ['Alpha Star', 'Bench Guy']),
    '/teams/2': teamDetail(1, ['Gamma Guard', 'Delta Big']),
  })
}

/** Pixel size from the PNG header (IHDR width/height at bytes 16-23). */
async function pngSize(download: Download) {
  const bytes = readFileSync((await download.path())!)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function openShareMenu(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share as image' })
  await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeEnabled({ timeout: 15_000 })
  return dialog
}

/** The menu fits the screen: a bottom sheet with thumb-sized targets on
 * phones, a dropdown under the button on desktop. */
async function expectMenuLayout(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Share as image' })
  const box = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  if (isMobile(page)) {
    expect(viewport.height - (box.y + box.height)).toBeLessThan(24)
    expect(box.height, 'sheet leaves most of the page visible').toBeLessThan(viewport.height * 0.45)
    for (const button of await dialog.getByRole('button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
  } else {
    const trigger = (await page.getByRole('button', { name: 'Share', exact: true }).boundingBox())!
    expect(box.y).toBeGreaterThan(trigger.y)
  }
  await expectNoHorizontalScroll(page)
}

// 400px card + 12px margin each side, exported at 2x.
const CARD_PNG_WIDTH = (400 + 24) * 2

test.beforeEach(async ({ page }) => setup(page))

test('Rankings: share menu previews and downloads the roto card', async ({ page }) => {
  await page.goto('/rankings')
  const dialog = await openShareMenu(page)
  await expectMenuLayout(page)

  await expect(dialog.getByRole('checkbox', { name: 'Highlight my team' })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Highlight my team' }).check()
  await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'View full size' }).click()
  await expect(page.getByAltText('Roto Rankings full size')).toBeVisible()
  await page.getByRole('button', { name: 'Close full-size image' }).click()
  await expect(page.getByAltText('Roto Rankings full size')).toBeHidden()
  await expect(dialog).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('roto-rankings-2026-10-19.png')
  expect((await pngSize(download)).width).toBe(CARD_PNG_WIDTH)
  await expect(dialog.getByRole('status')).toHaveText('Saved roto-rankings-2026-10-19.png')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('Rankings: the Standings view shares a Standings card', async ({ page }) => {
  await page.goto('/rankings')
  await page.getByRole('button', { name: 'Standings', exact: true }).click()
  const dialog = await openShareMenu(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('roto-standings-2026-10-19.png')
})

test('Team Detail: shares the team report card', async ({ page }) => {
  await page.goto('/team/1')
  const dialog = await openShareMenu(page)
  await expectMenuLayout(page)
  // One team's own report has no other teams to highlight against.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('fantasy-one-report-2026-10-19.png')
  const { width, height } = await pngSize(download)
  expect(width).toBe(CARD_PNG_WIDTH)
  expect(height).toBeGreaterThan(400)
})

test('Trade Analyzer: Share appears once both sides have players', async ({ page }) => {
  await page.goto('/trade')
  const teamSelects = page.locator('select:has(option:text-is("Choose a team..."))')
  await teamSelects.nth(0).selectOption('1')
  await teamSelects.nth(1).selectOption('2')
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)

  const playerSelects = page.locator('select:has(option:text-is("Select a player to add..."))')
  const addButtons = page.getByRole('button', { name: 'Add', exact: true })
  await playerSelects.nth(0).selectOption('Alpha Star')
  await addButtons.nth(0).click()
  await playerSelects.nth(1).selectOption('Gamma Guard')
  await addButtons.nth(1).click()

  await page.getByRole('button', { name: 'Share', exact: true }).scrollIntoViewIfNeeded()
  const dialog = await openShareMenu(page)
  await expectMenuLayout(page)
  // My team (Fantasy One) is part of this trade, so it can be highlighted.
  await expect(dialog.getByRole('checkbox', { name: 'Highlight my team' })).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('trade-analysis-2026-10-19.png')
})

test('phones with Web Share get the share sheet with the PNG attached', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: { name: string; type: string; size: number }[] = []
    Object.assign(window, { __shared: shared })
    navigator.canShare = () => true
    navigator.share = async (data?: ShareData) => {
      for (const f of data?.files ?? []) shared.push({ name: f.name, type: f.type, size: f.size })
    }
  })
  await page.goto('/rankings')
  const dialog = await openShareMenu(page)
  await dialog.getByRole('button', { name: 'Share…' }).click()

  await expect(dialog).toBeHidden()
  const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number }[] }).__shared)
  expect(shared).toHaveLength(1)
  expect(shared[0]).toMatchObject({ name: 'roto-rankings-2026-10-19.png', type: 'image/png' })
  expect(shared[0].size).toBeGreaterThan(10_000)
})
