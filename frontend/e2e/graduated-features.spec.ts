import { test, expect, isMobile } from './support/test'

// Features that used to sit behind removed feature flags (FF_TODAY_HUB,
// FF_NAV_REORG, FF_SCHEDULE, FF_MATCHUP_QUALITY, FF_CUSTOM_RANGE, FF_MINIGAMES,
// FF_TRENDS, FF_PLAYER_RANKINGS). They must render with no env configuration.

test('home is the Today hub', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Rank movers' })).toBeVisible()
})

test('/shots redirects to the tabbed Analytics page', async ({ page }) => {
  await page.goto('/shots')
  await expect(page).toHaveURL(/\/analytics$/)
  for (const tab of ['Heatmap', 'Rankings Over Time', 'Shooting Stats']) {
    await expect(page.getByRole('button', { name: tab })).toBeVisible()
  }
})

test('Players: slate picker, matchup column and schedule view', async ({ page }) => {
  await page.goto('/players')
  await expect(page.getByText('Alpha Star').first()).toBeVisible()
  await expect(page.getByText('Slate', { exact: true })).toBeVisible()
  await expect(page.getByText('Only playing on slate')).toBeVisible()
  await expect(page.locator('th', { hasText: 'Matchup' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Custom' })).toBeVisible()

  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(page.locator('th', { hasText: 'Matchup' })).toBeHidden()
  await expect(page.locator('th', { hasText: 'Games' })).toBeVisible()
})

test('Team page: roster coverage, matchup column and schedule toggle', async ({ page }) => {
  await page.goto('/team/1')
  await expect(page.getByRole('heading', { name: 'Roster coverage' })).toBeVisible()
  await expect(page.locator('th', { hasText: 'Matchup' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Custom' })).toBeVisible()
})

test('Minigames hub lists all four games', async ({ page }) => {
  await page.goto('/minigames')
  for (const game of ['Hangman', 'Who He Play For?', 'Who Am I?', 'Now You See Me']) {
    await expect(page.getByRole('heading', { name: game })).toBeVisible()
  }
})

test('search covers the graduated pages', async ({ page }) => {
  test.skip(isMobile(page), 'keyboard shortcut is desktop-only')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog')
  for (const label of ['Player Rankings', 'Player Trends', 'Season Schedule', 'Now You See Me']) {
    await dialog.getByRole('textbox').fill(label)
    await expect(dialog.getByText(label, { exact: true })).toBeVisible()
  }
})
