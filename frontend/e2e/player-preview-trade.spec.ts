import type { Page } from '@playwright/test'
import { test, expect, isMobile } from './support/test'
import { API_BASE_URL, fixture } from './support/mockApi'
import { PROFILE_ID, mockProfileApis, playersList } from './support/profileMock'

// "Preview trade" on the player page: opens the Trade Analyzer with the player
// already picked: on his team's side (against My Team when set), or in
// "vs Free Agents" when he is a free agent.

const SHOTS = process.env.PREVIEW_TRADE_SHOTS

type Detail = { team: { team_id: number; team_name: string }; players: Array<Record<string, unknown>> }

async function mockTrade(page: Page, { freeAgent = false } = {}) {
  await mockProfileApis(page)
  let donovan: Record<string, unknown> | undefined
  // Registered after the profile mocks, so these win.
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '').replace(/\/$/, '')
    if (path === '/players') {
      const json = playersList() as { players: Array<Record<string, unknown>> }
      json.players = json.players.map((p) => {
        if (p.player_id !== PROFILE_ID) return p
        donovan = freeAgent ? { ...p, status: 'FREEAGENT', team_id: 0, fantasy_team_name: null } : { ...p, team_id: 1, fantasy_team_name: 'Fantasy One' }
        return donovan
      })
      return route.fulfill({ json })
    }
    const team = path.match(/^\/teams\/(\d+)$/)
    if (team) {
      const detail = fixture<Detail>('team-detail')
      const id = Number(team[1])
      if (id === 1) {
        if (!freeAgent && donovan) detail.players = [donovan, ...detail.players]
        return route.fulfill({ json: detail })
      }
      return route.fulfill({
        json: { ...detail, team: { team_id: id, team_name: 'Second Team' }, players: detail.players.map((p) => ({ ...p, team_id: id, player_name: `${p.player_name} II` })) },
      })
    }
    return route.fallback()
  })
}

async function openPreview(page: Page) {
  await page.goto(`/player/${PROFILE_ID}?ff=mobile`)
  await page.getByRole('button', { name: 'Preview trade' }).click()
  await expect(page).toHaveURL(/\/trade(\?side=B)?$/)
}

async function onTrade(page: Page) {
  await expect(page.getByRole('heading', { name: /Trade Analyzer/ })).toBeVisible()
}

const picked = (page: Page, name: string) =>
  page.getByRole('main').getByText(name, { exact: true }).filter({ visible: true }).first()

test('rostered player: his team on his side, My Team on the other', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '2'))
  await mockTrade(page)
  await page.goto(`/player/${PROFILE_ID}?ff=mobile`)
  await expect(page.getByRole('button', { name: 'Preview trade' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/profile-${isMobile(page) ? 'phone' : 'desktop'}.png` })
  await page.getByRole('button', { name: 'Preview trade' }).click()
  await expect(page).toHaveURL(/\/trade\?side=B$/)
  await onTrade(page)
  await expect(picked(page, 'Donovan Mitchell')).toBeVisible()
  await page.waitForLoadState('networkidle')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trade-team-${isMobile(page) ? 'phone' : 'desktop'}.png`, fullPage: !isMobile(page) })
})

test('free agent: opens vs Free Agents with him picked', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fw:myTeam.id', '1'))
  await mockTrade(page, { freeAgent: true })
  await openPreview(page)
  await onTrade(page)
  await expect(picked(page, 'Donovan Mitchell')).toBeVisible()
  await page.waitForLoadState('networkidle')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trade-fa-${isMobile(page) ? 'phone' : 'desktop'}.png`, fullPage: !isMobile(page) })
})
