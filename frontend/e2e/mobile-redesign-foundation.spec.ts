import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'

// Step 1 of the mobile redesign: the flag switch and the shared components.
// The components are shown on the dev-only /mobile-kit.html preview page.

test.describe('mobile redesign flag', () => {
  test('?ff=mobile turns the override on and leaves a clean URL; ?ff=off clears it', async ({ page }) => {
    await page.goto('/rankings?ff=mobile')
    await expect(page).toHaveURL(/\/rankings$/)
    expect(await page.evaluate(() => localStorage.getItem('fw:ff-mobile-redesign'))).toBe('1')

    await page.goto('/?ff=off')
    await expect(page).toHaveURL(/\/$/)
    expect(await page.evaluate(() => localStorage.getItem('fw:ff-mobile-redesign'))).toBeNull()
  })

  test('no visible change: the flag alone does not change today\'s layout', async ({ page }) => {
    await page.goto('/?ff=mobile')
    // today's header and nav are still the old ones
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.locator('.mr-root')).toHaveCount(0)
  })
})

test.describe('component kit at phone width', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('renders every component without sideways page scroll', async ({ page }) => {
    await page.goto('/mobile-kit.html')
    await expect(page.getByRole('heading', { name: 'Component kit' })).toBeVisible()
    for (const name of ['Layout', 'Show', 'Values']) {
      await expect(page.getByRole('radiogroup', { name })).toBeVisible()
    }
    await expect(page.getByRole('group', { name: 'Period' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Standings' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Minutes for Donovan Mitchell' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('table: pinned team column stays put while the table scrolls sideways', async ({ page }) => {
    await page.goto('/mobile-kit.html')
    const table = page.getByRole('region', { name: 'Standings' })
    const pinned = page.getByRole('rowheader', { name: /Trust the process/ })
    const before = await pinned.boundingBox()
    await table.evaluate((el) => { el.scrollLeft = 200 })
    const after = await pinned.boundingBox()
    expect(after!.x).toBeCloseTo(before!.x, 0)
    await expect(pinned.locator('xpath=..')).toHaveClass(/mr-me/)
  })

  test('filters sheet: browser back closes it first, without leaving the page', async ({ page }) => {
    await page.goto('/')
    await page.goto('/mobile-kit.html')
    await page.getByRole('button', { name: /^Filters/ }).click()
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0)
    await expect(page).toHaveURL(/mobile-kit\.html$/)

    // closing from inside the sheet pops its history entry too
    await page.getByRole('button', { name: /^Filters/ }).click()
    await page.getByRole('button', { name: 'Show results' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goBack()
    await expect(page).not.toHaveURL(/mobile-kit/)
  })

  test('select button opens a list sheet and picks a team', async ({ page }) => {
    await page.goto('/mobile-kit.html')
    await page.getByRole('button', { name: 'Fantasy team: All teams' }).click()
    await page.getByRole('option', { name: 'Trust the process' }).click()
    await expect(page.getByRole('button', { name: 'Fantasy team: Trust the process' })).toBeVisible()
  })

  test('minutes stepper steps and resets', async ({ page }) => {
    await page.goto('/mobile-kit.html')
    await page.getByRole('button', { name: 'More minutes for Donovan Mitchell' }).click()
    await expect(page.getByRole('status')).toHaveText('32 min')
    await page.getByRole('button', { name: 'Reset to default minutes for Donovan Mitchell' }).click()
    await expect(page.getByRole('status')).toHaveText('31 min')
  })
})
