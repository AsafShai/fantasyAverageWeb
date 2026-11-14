import { test, expect, isMobile, expectNoHorizontalScroll } from './support/test'
import { PROFILE_ID, mockProfileApis } from './support/profileMock'

// Step 4 of the mobile redesign: the Player profile page on a phone.

const URL = `/player/${PROFILE_ID}`

test('desktop: the profile keeps its desktop layout with the flag on', async ({ page }) => {
  test.skip(isMobile(page), 'desktop only')
  await mockProfileApis(page)
  await page.goto(`${URL}?ff=mobile`)
  await expect(page.getByRole('heading', { name: /Donovan Mitchell/ })).toBeVisible()
  // desktop time frame selector and plain stats table, no phone chips
  await expect(page.getByRole('group', { name: 'Time frame' })).toHaveCount(0)
  // the time frame button (section titles like 'Stats · Full Season' are buttons too)
  await expect(page.getByRole('button', { name: /^\W*Full Season$/ })).toBeVisible()
  // sections fold; League History starts open, under Previous Seasons
  const history = page.getByRole('button', { name: /^League History/ })
  await expect(history).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Drafted #26')).toBeVisible()
  await history.click()
  await expect(page.getByText('Drafted #26')).toHaveCount(0)
  await page.getByRole('button', { name: /^Game log/ }).click()
  await expect(page.getByRole('button', { name: /^Game log/ })).toHaveAttribute('aria-expanded', 'false')
})

test.describe('phone player profile', () => {
  test.skip(({ page }) => !isMobile(page), 'phone only')

  test('shows every section of the profile', async ({ page }) => {
    await mockProfileApis(page)
    await page.goto(`${URL}?ff=mobile`)

    // header
    await expect(page.getByRole('heading', { level: 1, name: /Donovan Mitchell #45/ })).toBeVisible()
    await expect(page.getByText('Cleveland Cavaliers (CLE) · Guard')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rostered by Trust the process' })).toHaveAttribute('href', '/team/1')

    // bio folded, opens on tap
    const bio = page.locator('details', { hasText: 'Bio' })
    await expect(bio.getByText('Conference')).toBeHidden()
    await bio.getByText('Bio', { exact: true }).click()
    for (const k of ['Conference', 'Division', 'Height', 'Age', 'Nationality']) await expect(bio.getByText(k)).toBeVisible()
    await expect(bio.getByText('Central')).toBeVisible()

    // time frame chips
    const frame = page.getByRole('group', { name: 'Time frame' })
    for (const k of ['Full Season', 'Last 7 Days', 'Last 15 Days', 'Last 30 Days', 'Custom']) await expect(frame.getByRole('button', { name: k })).toBeVisible()

    // fantasy value
    const fv = page.getByRole('region', { name: 'Fantasy Value' })
    await expect(fv.getByRole('heading', { name: 'Fantasy Value · Full Season' })).toBeVisible()
    await expect(fv.getByTestId('fantasy-rank')).toContainText(/#\d+ of 151/)
    await expect(fv.getByTestId('fantasy-z')).toHaveText(/^[+-]\d\.\d\d$/)
    await expect(fv.getByLabel('ESPN position eligibility')).toContainText('PGSG')
    await expect(fv.getByLabel(/^FG% z-score/)).toBeVisible()
    await expect(fv.getByRole('link', { name: 'Full rankings →' })).toHaveAttribute('href', '/player-rankings')

    // stats: all 14 columns, Per Game / Totals
    const stats = page.getByRole('region', { name: 'Stats', exact: true })
    for (const k of ['MIN', 'FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS', 'GP'])
      await expect(stats.getByRole('columnheader', { name: k, exact: true })).toHaveCount(1)
    await expect(stats.getByRole('rowheader')).toHaveText('33.1')
    await stats.getByRole('radio', { name: 'Totals' }).click()
    await expect(stats.getByRole('rowheader')).toHaveText('265')

    // trends: tiles, minutes chart open by default, tap toggles
    const trends = page.getByRole('region', { name: 'Trends' })
    await expect(trends.getByText('Last 15 days vs season · 8 games')).toBeVisible()
    const minutes = trends.getByRole('button', { name: /^Minutes:/ })
    await expect(minutes).toHaveAttribute('aria-expanded', 'true')
    await trends.getByRole('button', { name: /^PTS:/ }).click()
    await expect(trends.getByRole('button', { name: /^PTS:/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(minutes).toHaveAttribute('aria-expanded', 'false')

    // projection
    const proj = page.getByRole('region', { name: 'Next game projection' })
    await expect(proj).toContainText('Next game: vs PHI')
    await expect(proj.getByLabel('Integer projections')).toBeChecked()
    await expect(proj.getByRole('cell').last()).toHaveText('23')

    // game log: AVG row with record, every column
    const log = page.getByRole('region', { name: 'Game log' })
    await expect(log.getByText('2026-27 · 8 games')).toBeVisible()
    for (const k of ['DATE', 'OPP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3P', 'FT', 'TO', '+/−'])
      await expect(log.getByRole('columnheader', { name: k, exact: true })).toHaveCount(1)
    await expect(log.getByRole('row').nth(1)).toContainText('AVG')
    await expect(log.getByRole('row').nth(1)).toContainText('4–4')
    await expect(log.getByRole('link', { name: /@ OKC/ }).first()).toHaveAttribute('href', /\/box-scores\?date=2026-11-04&game=400/)

    await expectNoHorizontalScroll(page)
  })

  test('league history: open under Previous seasons, moves newest first, trade sides, tap a stint for its dates', async ({ page }) => {
    await mockProfileApis(page)
    await page.goto(`${URL}?ff=mobile`)
    // open by default, under Previous seasons
    const card = page.getByRole('region', { name: 'League history' })
    const seasons = page.getByRole('region', { name: 'Previous seasons' })
    await expect(seasons).toBeVisible()
    expect((await seasons.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y)
    await expect(card.getByRole('button', { name: /League history/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(card.getByText('Drafted #26')).toBeVisible()
    const moves = card.getByRole('listitem')
    await expect(moves).toHaveCount(6)
    await expect(moves.first()).toContainText('Traded from DORELIT to Trust the process')
    await expect(moves.first()).toContainText('Trust the process gotDonovan Mitchell, Peyton Watson')
    await expect(moves.first()).toContainText('DORELIT gotAndrew Wiggins, Josh Giddey')
    await expect(moves.first()).toContainText('Trust the process dropped Keon Ellis to make room')
    await expect(moves.nth(3)).toContainText('Claimed off waivers by Dor\'s Injured Team')
    await expect(moves.last()).toContainText('Pick #26 (round 3)')
    await expect(moves.nth(4)).toContainText('Released, no pickup in the same move')

    // a 3-hour stint still gets a tappable slice, and tapping shows its time frame
    await card.getByRole('button', { name: /^Dor's Injured Team,/ }).tap()
    await expect(card.getByRole('status')).toContainText(/Dor's Injured Team.*3 hours/)
    await page.getByRole('heading', { level: 1 }).tap()
    await expect(card.getByRole('status')).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })

  test('every section folds, and stays folded after a reload', async ({ page }) => {
    await mockProfileApis(page)
    await page.goto(`${URL}?ff=mobile`)
    const stats = page.getByRole('region', { name: 'Stats' })
    await expect(stats.getByRole('rowheader')).toBeVisible()
    for (const name of [/^Fantasy Value/, /^Stats/, /^Previous seasons/, /^League history/, /^Trends/, /^Next game/, /^Game log/])
      await expect(page.getByRole('button', { name, expanded: true })).toBeVisible()
    await stats.getByRole('button', { name: /^Stats/ }).tap()
    await expect(stats.getByRole('rowheader')).toHaveCount(0)
    await expect(stats.getByRole('radiogroup')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: /^Stats/, expanded: false })).toBeVisible()
    await expect(stats.getByRole('rowheader')).toHaveCount(0)
    await stats.getByRole('button', { name: /^Stats/ }).tap()
    await expect(stats.getByRole('rowheader')).toBeVisible()
  })

  test('minutes stepper re-runs the projection and resets', async ({ page }) => {
    const { predicted } = await mockProfileApis(page)
    await page.goto(`${URL}?ff=mobile`)
    const proj = page.getByRole('region', { name: 'Next game projection' })
    await proj.getByLabel('Integer projections').uncheck()
    await expect(proj).toContainText('22.6')
    await proj.getByRole('button', { name: /More minutes/ }).click()
    await expect(proj).toContainText('25.4')
    expect(predicted).toEqual([34])
    await proj.getByRole('button', { name: /Reset to default minutes/ }).click()
    await expect(proj).toContainText('22.6')
  })

  test('custom range opens in a sheet; back closes it; the chip clears it', async ({ page }) => {
    await mockProfileApis(page)
    await page.goto(`${URL}?ff=mobile`)
    const frame = page.getByRole('group', { name: 'Time frame' })
    await frame.getByRole('button', { name: 'Custom' }).click()
    const sheet = page.getByRole('dialog', { name: 'Custom range' })
    await expect(sheet).toBeVisible()
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/player/${PROFILE_ID}$`))

    await frame.getByRole('button', { name: 'Custom' }).click()
    await sheet.getByLabel('Start date').fill('2026-10-01')
    await sheet.getByLabel('End date').fill('2026-10-15')
    await sheet.getByRole('button', { name: 'Apply' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(frame.getByRole('button', { name: /Oct 1 – Oct 15/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: 'Stats · Oct 1 – Oct 15' })).toBeVisible()
    await frame.getByRole('button', { name: 'Clear custom range' }).click()
    await expect(frame.getByRole('button', { name: 'Full Season' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('back goes to the page the profile came from', async ({ page }) => {
    await mockProfileApis(page)
    await page.goto('/teams?ff=mobile')
    await page.goto(URL)
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page).toHaveURL(/\/teams$/)
  })
})
