import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'

// Step 2 of the mobile redesign: the phone shell (header, bottom tab bar,
// ☰ menu sheet, footer) and browser back for its sheets.

const GROUPS = ['LEAGUE', 'PLAYERS', 'INSIGHTS', 'TOOLS', 'NBA', 'MINIGAMES']
const TABS = ['Home', 'Standings', 'Teams', 'Player Ranks', 'Trade']

test.describe('shell is off unless flag + phone width', () => {
  test('desktop keeps today\'s nav even with the flag on', async ({ page }) => {
    test.skip(isMobile(page), 'desktop only')
    await page.goto('/?ff=mobile')
    await expect(page.locator('.mr-shell')).toHaveCount(0)
    await expect(page.getByRole('navigation').getByRole('button', { name: /Insights/ })).toBeVisible()
  })

  test('phone without the flag keeps today\'s nav', async ({ page }) => {
    test.skip(!isMobile(page), 'phone only')
    await page.goto('/')
    await expect(page.locator('.mr-shell')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toggle navigation menu' })).toBeVisible()
  })
})

test.describe('phone shell', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await page.goto('/?ff=mobile')
    await expect(page.locator('.mr-shell')).toBeVisible()
  })

  test('Player Ranks tab opens Player Rankings and stays current there', async ({ page }) => {
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Player Ranks' })
    await tab.click()
    await expect(page).toHaveURL(/\/player-rankings/)
    await expect(tab).toHaveAttribute('aria-current', 'page')
    if (process.env.MR_SHOTS) await page.getByRole('heading', { level: 1 }).first().waitFor(); await page.screenshot({ path: `${process.env.MR_SHOTS}/rankings-tab.png` })
  })

  test('header, tab bar and footer; Home is the current tab on Today', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Fantasy League' })).toBeVisible()
    for (const name of ['Search', 'Toggle dark mode', 'Menu']) {
      await expect(page.getByRole('banner').getByRole('button', { name })).toBeVisible()
    }
    const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link')
    await expect(tabs).toHaveText(TABS)
    await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    const footer = page.getByRole('contentinfo')
    await expect(footer).toContainText('Asaf Shai')
    for (const name of ['Email', 'GitHub', 'LinkedIn']) {
      await expect(footer.getByRole('link', { name })).toBeVisible()
    }
    await expectNoHorizontalScroll(page)
  })

  test('tabs navigate with real URLs; team pages keep Teams current; back works', async ({ page }) => {
    const tabbar = page.getByRole('navigation', { name: 'Main' })
    await tabbar.getByRole('link', { name: 'Standings' }).click()
    await expect(page).toHaveURL(/\/rankings$/)
    await expect(tabbar.getByRole('link', { name: 'Standings' })).toHaveAttribute('aria-current', 'page')

    await tabbar.getByRole('link', { name: 'Teams' }).click()
    await expect(page).toHaveURL(/\/teams$/)
    await page.goto('/team/1')
    await expect(tabbar.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).toHaveURL(/\/teams$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/rankings$/)
  })

  test('tab bar stays on screen while the page scrolls', async ({ page }) => {
    const tabbar = page.getByRole('navigation', { name: 'Main' })
    const before = await tabbar.boundingBox()
    await page.mouse.wheel(0, 2000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const after = await tabbar.boundingBox()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    expect(before!.y + before!.height).toBeCloseTo(page.viewportSize()!.height, 0)
  })

  test('menu sheet: same groups as today, back closes it first', async ({ page }) => {
    await page.goto('/rankings')
    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.getByRole('dialog', { name: 'Menu' })
    await expect(menu).toBeVisible()
    for (const g of GROUPS) await expect(menu.getByRole('heading', { name: g })).toBeVisible()
    await expect(menu.getByRole('combobox', { name: 'My team' })).toBeAttached()
    await expect(menu.getByRole('link', { name: /Standings & Rankings/ })).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(menu).toHaveCount(0)
    await expect(page).toHaveURL(/\/rankings$/)
  })

  test('menu item replaces the menu entry: back returns to the page, menu closed', async ({ page }) => {
    await page.goto('/rankings')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /Player Trends/ }).click()
    await expect(page).toHaveURL(/\/trends$/)
    await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/rankings$/)
    await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
  })

  test('select my team from the menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.getByRole('dialog', { name: 'Menu' })
    const select = menu.getByRole('combobox', { name: 'My team' })
    const firstTeam = await select.locator('option').nth(1).textContent()
    await select.selectOption({ index: 1 })
    await expect(menu).toContainText(`My team: ${firstTeam}`)
    await menu.getByRole('link', { name: 'Open my team ›' }).click()
    await expect(page).toHaveURL(/\/team\/\d+$/)
    await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
  })

  test('search overlay closes on back', async ({ page }) => {
    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })

  test('dark mode toggle switches the shell to dark', async ({ page }) => {
    await page.getByRole('button', { name: 'Toggle dark mode' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    const bg = await page.getByRole('banner').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(21, 30, 46)')
  })
})
