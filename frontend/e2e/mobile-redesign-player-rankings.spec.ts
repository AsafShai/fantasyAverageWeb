import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'

// Step 4 of the mobile redesign: Player Rankings on a phone (search + Filters
// sheet, calc/display mode, period chips, weight sliders, pinned-name table).

test('desktop: Player Rankings keeps today\'s layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/player-rankings?ff=mobile')
  await expect(page.getByRole('heading', { name: 'Player Rankings' })).toBeVisible()
  await expect(page.locator('.mr-pr')).toHaveCount(0)
  await expect(page.getByText('Fantasy team', { exact: true })).toBeVisible()
})

test.describe('phone Player Rankings', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('filters live in a sheet that browser back closes; table fits the phone', async ({ page }) => {
    await page.goto('/player-rankings?ff=mobile')
    await expect(page.locator('.mr-pr')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Player rankings' })).toBeVisible()
    await expectNoHorizontalScroll(page)

    await page.getByRole('button', { name: /^Filters/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Top 50' }).click()
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/player-rankings$/)
    await expect(page.getByRole('button', { name: 'Remove filter Top 50' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('position filter picks several positions; each chip clears just its position', async ({ page }) => {
    await page.goto('/player-rankings?ff=mobile')
    await expect(page.getByRole('table', { name: 'Player rankings' })).toBeVisible()
    await page.getByRole('button', { name: /^Filters/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    const group = sheet.getByRole('group', { name: 'Position' })
    await group.getByRole('button', { name: 'PG', exact: true }).click()
    await group.getByRole('button', { name: 'C', exact: true }).click()
    await expect(group.getByRole('button', { name: 'PG', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.getByRole('button', { name: 'C', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.goBack()
    await page.getByRole('button', { name: 'Remove filter PG' }).click()
    await expect(page.getByRole('button', { name: 'Remove filter PG' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove filter C' })).toBeVisible()
  })
})
