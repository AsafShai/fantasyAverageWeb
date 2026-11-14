import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockTradeApi } from './support/tradeMocks'

// Step 4 of the mobile redesign: Trade Analyzer on a phone. One side at a
// time behind a Team A / Team B switch, then the category comparison.

async function pick(page: Page, button: RegExp, option: RegExp | string) {
  await page.getByRole('button', { name: button }).click()
  await page.getByRole('option', { name: option }).click()
}

test('desktop: Trade Analyzer keeps both columns', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await mockTradeApi(page)
  await page.goto('/trade?ff=mobile')
  await expect(page.getByRole('heading', { name: 'Team A' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Team B' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Side' })).toHaveCount(0)
})

test.describe('phone Trade Analyzer', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('team vs team: pick both sides, compare by category', async ({ page }) => {
    await mockTradeApi(page)
    await page.goto('/trade?ff=mobile')

    await expect(page.getByRole('heading', { name: '🔄 Trade Analyzer' })).toBeVisible()
    for (const name of ['Trade mode', 'Side']) await expect(page.getByRole('radiogroup', { name })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '📅 Full Season' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Select a team to view available players')).toBeVisible()
    await expect(page.getByText('No Trade Selected')).toBeVisible()

    // Side A
    await pick(page, /^Select Team: Choose a team/, 'Trust the process')
    await expect(page.getByRole('list', { name: 'Team Category Rankings' })).toContainText('3PM12')
    await expect(page.getByText('3 players available')).toBeVisible()
    await pick(page, /^Add Players:/, /^Josh Giddey/)
    await expect(page.getByText('Selected Players (1)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Josh Giddey' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Team A (1)' })).toBeChecked()

    // Side B, kept in the URL
    await page.getByRole('radio', { name: 'Team B' }).click()
    await expect(page).toHaveURL(/\/trade\?side=B$/)
    await pick(page, /^Select Team: Choose a team/, 'DORELIT')
    await pick(page, /^Add Players:/, /^Jrue Holiday/)

    // Each team card lists what that side receives, next to each other.
    const cards = page.locator('.tc-versus__teams .tc-team-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('Trust the process')
    await expect(cards.nth(0)).toContainText('Jrue Holiday')
    await expect(cards.nth(1)).toContainText('DORELIT')
    await expect(cards.nth(1)).toContainText('Josh Giddey')
    const [boxA, boxB] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()]
    expect(Math.abs(boxA!.y - boxB!.y), 'cards side by side').toBeLessThan(2)

    // Phone opens on the 8 categories, FT% expanded; minutes and games are a tap away.
    const rows = page.getByRole('table', { name: 'Category comparison' })
    for (const cat of ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']) {
      await expect(rows.getByRole('button', { name: new RegExp(`^${cat}`) })).toBeVisible()
    }
    await expect(rows.getByRole('button', { name: /^FT%/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: /Columns|cats only/ })).toHaveCount(0)
    await expect(page.locator('.tc-detail-grid')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show minutes and games' }).click()
    await expect(page.locator('.tc-detail-grid')).toContainText('MIN')
    await expect(page.locator('.tc-detail-grid')).toContainText('GP')
    await page.getByRole('button', { name: 'Hide minutes and games' }).click()
    await expect(page.locator('.tc-detail-grid')).toHaveCount(0)

    // Totals / Per game live in the comparison now.
    await page.getByRole('button', { name: 'Totals', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Totals', exact: true })).toHaveAttribute('aria-pressed', 'true')

    // The logo header stays at the top while scrolling.
    await page.evaluate(() => window.scrollTo(0, 400))
    expect((await page.locator('header.mr-hdr').boundingBox())!.y).toBe(0)

    // Remove a player: the comparison goes back to its empty state.
    await page.getByRole('button', { name: 'Remove Jrue Holiday' }).click()
    await expect(page.getByText('No Trade Selected')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('team vs free agents: search the pool on side B', async ({ page }) => {
    await mockTradeApi(page)
    await page.goto('/trade?ff=mobile')
    await page.getByRole('radio', { name: '🆓 Team vs Free Agents' }).click()
    await expect(page.getByText('Compare your team players against free agents')).toBeVisible()
    await pick(page, /^Select Team: Choose a team/, 'Trust the process')
    await pick(page, /^Add Players:/, /^Jayson Tatum/)

    await page.getByRole('radio', { name: 'Free Agents', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Free Agent Pool' })).toBeVisible()
    await expect(page.getByText('2 free agents available')).toBeVisible()
    await page.getByLabel('Search Free Agents & Waivers').fill('zia')
    await page.getByRole('list', { name: 'Free agent results' }).getByRole('button', { name: /Ziaire Williams/ }).click()
    await expect(page.getByText('Selected Free Agents (1)')).toBeVisible()

    // Both cards are your team's move: what it drops and what it adds.
    const cards = page.locator('.tc-versus__teams .tc-team-card')
    await expect(cards.nth(0)).toContainText('Trust the process')
    await expect(cards.nth(0)).toContainText(/drops/i)
    await expect(cards.nth(0)).toContainText('Jayson Tatum')
    await expect(cards.nth(1)).toContainText(/adds/i)
    await expect(cards.nth(1)).toContainText('Ziaire Williams')
    await expect(page.getByRole('table', { name: 'Category comparison' }).getByRole('button', { name: /^PTS/ })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
