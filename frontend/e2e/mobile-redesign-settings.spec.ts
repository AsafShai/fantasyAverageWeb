import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'

// Phone settings: the ⚙ in the header opens Settings, where the tab bar is
// edited live (pages and shortcuts) and my team is chosen.

test.describe('phone settings', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await page.goto('/?ff=mobile')
    await expect(page.locator('.mr-shell')).toBeVisible()
  })

  const shot = async (page: import('@playwright/test').Page, name: string, fullPage = false) => {
    if (process.env.MR_SHOTS) {
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${process.env.MR_SHOTS}/${name}.png`, fullPage })
    }
  }

  test('the gear opens Settings; desktop has no such page', async ({ page }) => {
    await shot(page, '1-home-with-gear')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await shot(page, '2-settings')
  })

  test('edit the bar: remove Home, add shortcuts, pick my team, and it lasts', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    const tabbar = page.getByRole('navigation', { name: 'Main' })

    await page.getByRole('button', { name: 'Remove Home' }).click()
    await expect(tabbar.getByRole('link', { name: 'Home' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Remove Player Ranks' }).click()
    await page.getByRole('button', { name: 'Add My Team' }).scrollIntoViewIfNeeded()
    await shot(page, '3-add-shortcuts')
    await page.getByRole('button', { name: 'Add My Team' }).click()
    await page.getByRole('button', { name: 'Add Box Scores' }).click()
    await page.getByRole('button', { name: 'Remove Trade' }).click()
    await page.getByRole('button', { name: 'Add Search' }).click()
    await expect(tabbar.getByRole('link')).toHaveCount(4)
    await expect(tabbar.getByRole('button', { name: 'Search' })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('bar is full')
    await expectNoHorizontalScroll(page)

    // My Team with no team chosen has a dot and leads back here
    await expect(tabbar.locator('.mr-tab-dot')).toHaveCount(1)
    await page.getByRole('combobox', { name: 'My team' }).selectOption({ index: 1 })
    await expect(tabbar.locator('.mr-tab-dot')).toHaveCount(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, '4-settings-customized')

    await tabbar.getByRole('link', { name: 'My Team' }).click()
    await expect(page).toHaveURL(/\/team\/\d+$/)
    await expect(tabbar.getByRole('link', { name: 'My Team' })).toHaveAttribute('aria-current', 'page')
    await shot(page, '5-my-team-tab')

    await tabbar.getByRole('link', { name: 'Box Scores' }).click()
    await expect(page).toHaveURL(/\/box-scores$/)
    await expect(tabbar.getByRole('link', { name: 'Box Scores' })).toHaveAttribute('aria-current', 'page')

    await tabbar.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(tabbar.getByRole('link', { name: 'Box Scores' })).toBeVisible()
    await expect(tabbar.getByRole('link', { name: 'Home' })).toHaveCount(0)
  })

  test('labels off gives a shorter icon-only bar; reset restores today\'s tabs', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    const tabbar = page.getByRole('navigation', { name: 'Main' })
    const before = (await tabbar.boundingBox())!.height
    await page.getByRole('switch', { name: 'Show tab labels' }).click({ force: true })
    await expect(tabbar.locator('.mr-tab-label')).toHaveCount(0)
    expect((await tabbar.boundingBox())!.height).toBeLessThan(before)
    await shot(page, '6-labels-off')
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(tabbar.getByRole('link')).toHaveCount(5)
    await expect(tabbar.locator('.mr-tab-label')).toHaveCount(5)
  })
})

test('desktop: /settings has no page and goes home', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/settings')
  await expect(page).toHaveURL(/localhost:\d+\/$/)
})
