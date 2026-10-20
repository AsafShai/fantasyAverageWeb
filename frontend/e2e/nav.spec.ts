import { test, expect, isMobile } from './support/test'

const GROUPS = ['League', 'Players', 'Insights', 'Tools', 'Minigames', 'NBA']

test.describe('desktop nav', () => {
  test.skip(({ page }) => isMobile(page), 'desktop only')

  test('shows the grouped nav and navigates from a dropdown', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation')
    for (const group of GROUPS) {
      await expect(nav.getByRole('button', { name: new RegExp(group) })).toBeVisible()
    }

    await nav.getByRole('button', { name: /Insights/ }).click()
    await page.getByRole('menuitem', { name: /Player Trends/ }).click()
    await expect(page).toHaveURL(/\/trends$/)
    await expect(page.getByRole('heading', { level: 1, name: /Trends/ })).toBeVisible()
  })

  test('clicking a group that hover just opened keeps it open', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('navigation').getByRole('button', { name: /Insights/ })
    await button.hover()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(300)
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu')).toBeVisible()

    // Once the click owns the menu, a second click closes it.
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  test('clicking a closed group with the mouse already on it opens it', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('navigation').getByRole('button', { name: /Insights/ })
    await button.hover()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    // Close it with Escape while the mouse stays on the button.
    await button.press('Escape')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu')).toBeVisible()
  })

  test('clicking a focused group without hovering opens it', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('navigation').getByRole('button', { name: /Insights/ })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    // Fire the click without moving the mouse, as an assistive tech activation does.
    await button.dispatchEvent('click')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu')).toBeVisible()
  })

  test('Escape and clicking outside close the menu', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('navigation').getByRole('button', { name: /Insights/ })
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await button.press('Escape')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('menu')).toBeHidden()

    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('heading', { level: 1, name: 'Today' }).click()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('menu')).toBeHidden()
  })

  test('Enter, Space and ArrowDown work from the keyboard', async ({ page }) => {
    await page.goto('/')
    const button = page.getByRole('navigation').getByRole('button', { name: /Insights/ })
    await button.focus()

    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('Space')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('ArrowDown')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toBeFocused()
  })

  test('the logo links home', async ({ page }) => {
    await page.goto('/teams')
    await page.getByRole('link', { name: /Fantasy League/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  })

  test('Ctrl+K opens search and Enter navigates', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder(/Search players, teams, pages/).fill('Season Schedule')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/schedule$/)
    await expect(dialog).toBeHidden()
  })
})

test.describe('mobile nav', () => {
  test.skip(({ page }) => !isMobile(page), 'mobile only')

  test('hamburger menu opens, expands a group and navigates', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Toggle navigation menu' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.tap()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const group = page.getByRole('button', { name: /Minigames/ })
    await group.tap()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('link', { name: /Hangman/ }).tap()

    await expect(page).toHaveURL(/\/minigames\/hangman$/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('header tap targets are at least 40px', async ({ page }) => {
    await page.goto('/')
    for (const name of ['Search', 'Toggle dark mode', 'Toggle navigation menu']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(box, name).not.toBeNull()
      expect(Math.min(box!.width, box!.height), name).toBeGreaterThanOrEqual(40)
    }
  })

  test('search icon opens the search dialog', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Search', exact: true }).tap()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
