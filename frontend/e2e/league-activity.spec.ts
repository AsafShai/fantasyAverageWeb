import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { fixture } from './support/mockApi'

// League Activity (FF_LEAGUE_ACTIVITY), against a trimmed copy of the real
// 2025-26 response: team 1 (ASAF) and team 8 (DOR) traded on Mar 17, and
// team 4's (CADE) Nov 13 trade starts a long chain of follow-up trades.

const MAR17 = 'cf9f5a50-f1d8-4eb9-b3b3-e4e29927f4b9'
const CADE_NOV13 = '51ab1606-8af1-4ddb-8e59-9c0f66963d3f'
const COLLINS = 3908845

// The activity fixture is served by DEFAULT_API (support/mockApi.ts).
test.beforeEach(async ({ page }) => {
  // Team 1 exists in the teams fixture, so it can be "my team".
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '1'))
})

const tableRow = (page: Page, cat: string) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: cat, exact: true }) })

test('Activity feed lists moves, highlights my team and filters by type', async ({ page }) => {
  await page.goto('/activity')
  await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible()
  const { moves } = fixture<{ moves: { kind: string }[] }>('league-activity')
  const trades = moves.filter((m) => m.kind === 'trade').length
  await expect(page.getByText(new RegExp(`^${moves.length} moves · .* ${trades} trades$`))).toBeVisible()
  await expect(page.locator('li[data-mine]').first()).toBeVisible()

  await page.getByLabel('Type').selectOption('trade')
  await expect(page.getByText(/^Added$/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Trade' }).first()).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('Trades: GP per side, leaving a player out, per-game and the open spot', async ({ page }) => {
  await page.goto(`/activity?tab=trades&trade=${MAR17}`)
  await expect(page.getByRole('heading', { name: 'ASAF ⇄ DOR · Mar 17' })).toBeVisible()

  const gp = tableRow(page, 'GP').getByRole('cell')
  await expect(gp.nth(1)).toHaveText('18') // Adebayo 13 + Collins 5
  await expect(gp.nth(3)).toHaveText('12') // Mobley

  await page.locator(`#count-${MAR17}-${COLLINS}`).click()
  await expect(page.getByText('Your view: 1 change from the default. Only you see this.')).toBeVisible()
  await expect(gp.nth(1)).toHaveText('13')

  // Paul Reed filled DOR's open roster spot: shown, but only counted when ticked.
  await expect(page.locator(`#count-${MAR17}-open_spot`)).not.toBeChecked()
  await page.locator(`#count-${MAR17}-open_spot`).click()
  await expect(gp.nth(3)).toHaveText('13')

  await page.getByRole('button', { name: 'Per Game' }).first().click()
  await expect(tableRow(page, 'PTS').getByRole('cell').nth(1)).toHaveText('20.5') // 266 / 13

  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(gp.nth(1)).toHaveText('18')
  await expectNoHorizontalScroll(page)
})

test('Trades: picking a trade brings its detail into view', async ({ page }) => {
  await page.goto('/activity?tab=trades')
  await page.getByRole('button', { name: /ASAF got Bam Adebayo, John Collins/ }).click()
  const heading = page.getByRole('heading', { name: 'ASAF ⇄ DOR · Mar 17' })
  await expect(heading).toBeVisible()
  await expect(heading).toBeInViewport()
})

test('Trade tree: follow-up trades collapse and expand', async ({ page }) => {
  await page.goto(`/activity?tab=tree&trade=${CADE_NOV13}&team=4`)
  await expect(page.getByRole('heading', { name: /What CADE's side of the Nov 13 trade turned into/ })).toBeVisible()
  await expect(page.getByText('CJ McCollum')).toBeVisible()

  const toggle = page.getByRole('button', { name: 'Collapse trade to AMI on Dec 5' })
  await toggle.click()
  await expect(page.getByText('CJ McCollum')).toBeHidden()
  await expect(page.getByText(/got back 2 players \(hidden\)/)).toBeVisible()
  await expect(page.getByText('DeMar DeRozan')).toBeVisible()

  await page.getByRole('button', { name: 'Expand trade to AMI on Dec 5' }).click()
  await expect(page.getByText('CJ McCollum')).toBeVisible()

  await page.getByRole('button', { name: 'Collapse all' }).click()
  await expect(page.getByText('DeMar DeRozan')).toBeHidden()
  await page.getByRole('button', { name: 'Expand all' }).click()
  await expect(page.getByText('DeMar DeRozan')).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('Released players: cards on phones, a table on desktop', async ({ page }) => {
  await page.goto('/activity?tab=released')
  await expect(page.getByRole('heading', { name: 'Released players who played elsewhere' })).toBeVisible()
  if (isMobile(page)) {
    await expect(page.locator('li', { hasText: 'Reed Sheppard' })).toContainText('73 GP after')
    await expect(page.getByRole('table')).toBeHidden()
  } else {
    await expect(page.getByRole('row', { name: /Reed Sheppard/ })).toContainText('73')
  }
  await expectNoHorizontalScroll(page)
})

test('Today shows the latest moves and links to the full page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Latest moves' })).toBeVisible()
  await page.getByRole('link', { name: 'All activity →' }).click()
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible()
})

test('Activity is in the League menu', async ({ page }) => {
  await page.goto('/')
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Toggle navigation menu' }).tap()
    await page.getByRole('button', { name: /League/ }).tap()
    await page.getByRole('link', { name: /Activity/ }).tap()
  } else {
    // Groups open on hover (hover then click would toggle the menu shut).
    await page.getByRole('navigation').getByRole('button', { name: /League/ }).hover()
    await page.getByRole('menuitem', { name: /Activity/ }).click()
  }
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByRole('heading', { level: 1, name: 'League Activity' })).toBeVisible()
})
