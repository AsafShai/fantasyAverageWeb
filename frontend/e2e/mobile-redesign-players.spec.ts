import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'

// Step 4 of the mobile redesign: the Players page on a phone (flag on).
// Same data and URL state as desktop; filters live in a bottom sheet.

test('desktop: Players keeps today\'s layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await page.goto('/players?ff=mobile')
  await expect(page.getByPlaceholder('Search players...')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Filter' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0)
})

test.describe('phone Players page', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test.beforeEach(async ({ page }) => {
    await page.goto('/teams?ff=mobile')
    await page.goto('/players')
  })

  test('search, Filters, count, toggles, period chips and the pinned-name table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Players', level: 1 })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search players' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible()
    await expect(page.getByText('Showing 2 players')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Table' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Per Game or Totals' })).toBeVisible()
    const period = page.getByRole('group', { name: 'Period' })
    for (const p of ['Full Season', 'Last 7 Days', 'Last 15 Days', 'Last 30 Days', 'Custom']) {
      await expect(period.getByRole('button', { name: new RegExp(p) })).toBeVisible()
    }

    const table = page.getByRole('table', { name: 'Players' })
    const headers = await table.getByRole('columnheader').allInnerTexts()
    expect(headers.map((h) => h.trim())).toEqual([
      'NAME', 'MPG', 'FG%', 'FT%', '3PG', 'RPG', 'APG', 'SPG', 'BPG', 'PPG', 'GP', 'MATCHUP', 'NBA', 'POS', 'TEAM',
    ])
    await expect(table.getByRole('rowheader').first()).toHaveClass(/mr-pin/)
    await expectNoHorizontalScroll(page)

    // Totals relabels the stat headers; sorting by PPG/PTS works.
    await page.getByRole('radio', { name: 'Totals' }).click()
    await expect(table.getByRole('columnheader', { name: 'PTS' })).toBeVisible()
    await expect(page).toHaveURL(/avg=0/)
  })

  test('Filters sheet: filters apply, URL keeps them, back closes the sheet first', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await expect(sheet).toBeVisible()
    for (const g of ['Team', 'Position', 'Status', 'Stat filter', 'Slate', 'Options']) {
      await expect(sheet.getByRole('group', { name: g, exact: true }).first()).toBeVisible()
    }
    await sheet.getByRole('button', { name: 'C', exact: true }).click()
    await expect(page.getByText('Showing 1 players')).toBeVisible()
    await expect(sheet).toBeVisible() // a filter change must not close the sheet

    await sheet.getByLabel('Filter by stat').selectOption('pts')
    await sheet.getByLabel('Operator').selectOption('gte')
    await sheet.getByLabel('Stat value').fill('1')
    await sheet.getByRole('button', { name: '+ Add Filter' }).click()
    await expect(sheet.getByRole('button', { name: 'Remove filter PTS >= 1' })).toBeVisible()

    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(/\/players\?.*pos=C/)
    await expect(page).toHaveURL(/sf=pts%3Agte%3A1/)
    await expect(page.getByRole('button', { name: 'Filters (2 active)' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Players' }).getByRole('rowheader')).toHaveText(['Bench Guy'])

    // An active chip clears its filter.
    await page.getByRole('button', { name: 'Remove filter C' }).click()
    await expect(page.getByText('Showing 2 players')).toBeVisible()

    // Reset clears the rest; Show results closes the sheet.
    await page.getByRole('button', { name: /^Filters/ }).click()
    await sheet.getByRole('button', { name: 'Reset' }).click()
    await sheet.getByRole('button', { name: 'Show results' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('All Teams')
    await page.goBack()
    await expect(page).toHaveURL(/\/teams$/)
  })

  test('matchup expands under its row; Schedule mode shows the week grid', async ({ page }) => {
    const table = page.getByRole('table', { name: 'Players' })
    await table.getByRole('button', { name: /vs BOS/ }).first().click()
    await expect(table.getByText('Opponent defense')).toBeVisible()
    await expectNoHorizontalScroll(page)

    await page.getByRole('radio', { name: 'Schedule' }).click()
    await expect(page.getByRole('radiogroup', { name: 'Schedule horizon' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Period' })).toHaveCount(0)
    await expect(table.getByRole('columnheader', { name: 'Games' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Fantasy team' })).toBeVisible()
  })
})
