import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from '../../../test/helpers'
import SettingsPage from '../../settings/SettingsPage'
import MobileShell from '../MobileShell'
import { DEFAULT_PREFS, resetTabPrefsCache, sanitizePrefs, TAB_PREFS_KEY } from '../tabPrefs'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function Harness() {
  const [dark, setDark] = useState(false)
  return <MobileShell darkMode={dark} setDarkMode={setDark} />
}

function renderShell(route = '/') {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/" element={<Harness />}>
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Where />} />
            <Route index element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

const bar = () => screen.getByRole('navigation', { name: 'Main' })
const barNames = () =>
  within(bar())
    .getAllByRole('link')
    .concat(within(bar()).queryAllByRole('button'))
    .map((el) => el.textContent)

beforeEach(() => {
  localStorage.clear()
  resetTabPrefsCache()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('sanitizePrefs', () => {
  it('keeps valid ids in order, drops unknown and repeated ones, caps at 5', () => {
    const out = sanitizePrefs({ tabs: ['trade', 'nope', 'trade', 'home', 'standings', 'teams', 'players', 'injuries'], labels: false })
    expect(out).toEqual({ tabs: ['trade', 'home', 'standings', 'teams', 'players'], labels: false })
  })

  it('falls back to the default bar when fewer than 3 tabs survive or the data is junk', () => {
    expect(sanitizePrefs({ tabs: ['home', 'nope'] }).tabs).toEqual(DEFAULT_PREFS.tabs)
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(sanitizePrefs('x')).toEqual(DEFAULT_PREFS)
    expect(sanitizePrefs({ tabs: 'home' }).tabs).toEqual(DEFAULT_PREFS.tabs)
  })
})

describe('tab bar from saved settings', () => {
  it('shows the saved tabs, Home included only if chosen', () => {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify({ tabs: ['standings', 'injuries', 'trade'], labels: true }))
    renderShell('/')
    expect(barNames()).toEqual(['Standings', 'Injuries', 'Trade'])
  })

  it('without labels the tabs are named for screen readers', () => {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify({ tabs: ['home', 'standings', 'trade'], labels: false }))
    renderShell('/')
    expect(within(bar()).getByRole('link', { name: 'Standings' })).toBeInTheDocument()
    expect(within(bar()).queryByText('Standings')).not.toBeInTheDocument()
  })

  it('My Team with no team chosen goes to Settings and wears a dot', () => {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify({ tabs: ['home', 'my-team', 'standings'], labels: true }))
    renderShell('/')
    const tab = within(bar()).getByRole('link', { name: 'My Team' })
    expect(tab).toHaveAttribute('href', '/settings')
    expect(tab.querySelector('.mr-tab-dot')).not.toBeNull()
  })

  it('Search is a button that opens search', async () => {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify({ tabs: ['home', 'search', 'standings'], labels: true }))
    renderShell('/')
    await userEvent.click(within(bar()).getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Recent goes back and forth between the last two pages opened from outside the bar', async () => {
    localStorage.setItem(TAB_PREFS_KEY, JSON.stringify({ tabs: ['home', 'recent', 'standings'], labels: true }))
    renderShell('/injuries')
    // Nothing earlier yet: Recent is the ☰ menu.
    expect(within(bar()).getByRole('button', { name: 'Recent' })).toBeInTheDocument()
    await userEvent.click(within(bar()).getByRole('link', { name: 'Home' }))
    // Home is in the bar, so Injuries is the page to come back to.
    expect(within(bar()).getByRole('link', { name: 'Recent' })).toHaveAttribute('href', '/injuries')
    await userEvent.click(within(bar()).getByRole('link', { name: 'Recent' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/injuries')
  })
})

describe('Settings page', () => {
  it('opens from the header gear', async () => {
    renderShell('/teams')
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it('edits the bar live: remove, add, reorder, preset, labels, reset', async () => {
    renderShell('/settings')
    expect(barNames()).toEqual(['Home', 'Standings', 'Teams', 'Player Ranks', 'Trade'])

    // Home is not locked: it can be removed
    await userEvent.click(screen.getByRole('button', { name: 'Remove Home' }))
    expect(barNames()).toEqual(['Standings', 'Teams', 'Player Ranks', 'Trade'])

    // reorder
    await userEvent.click(screen.getByRole('button', { name: 'Move Trade earlier' }))
    expect(barNames()).toEqual(['Standings', 'Teams', 'Trade', 'Player Ranks'])
    expect(screen.getByRole('button', { name: 'Move Standings earlier' })).toBeDisabled()

    // add a shortcut; the bar is full at 5
    await userEvent.click(screen.getByRole('button', { name: 'Add Box Scores' }))
    expect(barNames()).toEqual(['Standings', 'Teams', 'Trade', 'Player Ranks', 'Box Scores'])
    expect(screen.getByRole('status')).toHaveTextContent('The bar is full')
    expect(screen.getByRole('button', { name: 'Add Injuries' })).toBeDisabled()

    // minimum 3
    for (const name of ['Box Scores', 'Player Ranks']) await userEvent.click(screen.getByRole('button', { name: `Remove ${name}` }))
    expect(screen.getByRole('button', { name: 'Remove Trade' })).toBeDisabled()

    // preset, labels, reset
    await userEvent.click(screen.getByRole('button', { name: 'Game night' }))
    expect(barNames()).toEqual(['Box Scores', 'My Team', 'Standings', 'Injuries', 'Search'])
    await userEvent.click(screen.getByRole('switch', { name: 'Show tab labels' }))
    expect(within(bar()).queryByText('Box Scores')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(barNames()).toEqual(['Home', 'Standings', 'Teams', 'Player Ranks', 'Trade'])
  })

  it('remembers the bar across a reload', async () => {
    const { unmount } = renderShell('/settings')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Trade' }))
    unmount()
    resetTabPrefsCache()
    renderShell('/')
    expect(barNames()).toEqual(['Home', 'Standings', 'Teams', 'Player Ranks'])
  })
})

describe('current tab', () => {
  it('a shortcut beats the page it overlaps, whatever the order', async () => {
    const { currentTabIndex, getTab } = await import('../tabs')
    const tabs = ['teams', 'my-team', 'standings'].map((id) => getTab(id)!)
    const ctx = { myTeamId: 7, recentPath: null }
    expect(currentTabIndex(tabs, '/team/7', '', ctx)).toBe(1)
    // another team's page is still Teams
    expect(currentTabIndex(tabs, '/team/8', '', ctx)).toBe(0)
  })
})
