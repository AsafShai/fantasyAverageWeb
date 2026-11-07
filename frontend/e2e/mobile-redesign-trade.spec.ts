import type { Page } from '@playwright/test'
import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { mockTradeApi } from './support/tradeMocks'

// Step 4 of the mobile redesign: Trade Analyzer on a phone. One side at a
// time behind a Team A / Team B switch, comparison card, sticky Avg Z.

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

  test('team vs team: pick both sides, compare, sticky Avg Z', async ({ page }) => {
    await mockTradeApi(page)
    await page.goto('/trade?ff=mobile')

    await expect(page.getByRole('heading', { name: '🔄 Trade Analyzer' })).toBeVisible()
    for (const name of ['Trade mode', 'Stats', 'Side']) await expect(page.getByRole('radiogroup', { name })).toBeVisible()
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

    const table = page.getByRole('table', { name: 'Trade comparison' })
    await expect(table).toBeVisible()
    await expect(table.getByRole('rowheader', { name: 'Trust the process gets' })).toBeVisible()
    await expect(table.getByRole('rowheader', { name: 'DORELIT gets' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'AVG Z' })).toBeVisible()
    // Phone opens on the 8 categories; Show/Hide brings back the rest.
    await expect(table.getByRole('columnheader', { name: 'MIN' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '8 cats only' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Show/Hide Columns' }).click()
    const sheet = page.getByRole('dialog', { name: 'Show/Hide Columns' })
    await sheet.getByRole('button', { name: 'Show All' }).click()
    await page.goBack()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/trade\?side=B$/)
    await expect(table.getByRole('columnheader', { name: 'MIN' })).toBeVisible()

    const avgZ = page.getByRole('status', { name: 'Average Z-score per side' })
    await expect(avgZ).toContainText('Trust the process gets')
    // Sticks above the tab bar while the rest of the page is still above it,
    // and the logo header stays at the top.
    await page.evaluate(() => window.scrollTo(0, 0))
    const box = (await avgZ.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 76)
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

    const table = page.getByRole('table', { name: 'Trade comparison' })
    await expect(table.getByRole('rowheader', { name: 'Drop' })).toBeVisible()
    await expect(table.getByRole('rowheader', { name: 'Add' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
