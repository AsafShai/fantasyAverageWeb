import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNavGroups } from '../../../components/navConfig'
import { createTestStore } from '../../../test/helpers'
import MobileShell from '../MobileShell'
import { TABS } from '../tabs'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}</p>
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
            <Route path="*" element={<Where />} />
            <Route index element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))))
})
afterEach(() => vi.unstubAllGlobals())

describe('MobileShell', () => {
  it('tab bar: Home · Standings · Teams · Player Ranks · Trade, Home current on /', () => {
    renderShell('/')
    const tabs = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Standings', 'Teams', 'Player Ranks', 'Trade'])
    expect(tabs[0]).toHaveAttribute('aria-current', 'page')
    expect(tabs.slice(1).every((t) => !t.hasAttribute('aria-current'))).toBe(true)
  })

  it.each([
    ['/team/4', 'Teams'],
    ['/player-rankings', 'Player Ranks'],
    ['/rankings', 'Standings'],
    ['/trade', 'Trade'],
  ])('%s keeps the %s tab current', (route, label) => {
    renderShell(route)
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  })

  it('no tab is current on pages reached from the menu', () => {
    renderShell('/injuries')
    const tabs = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
    expect(tabs.some((t) => t.hasAttribute('aria-current'))).toBe(false)
  })

  it('tab routes match the TABS config', () => {
    expect(TABS.map((t) => t.path)).toEqual(['/', '/rankings', '/teams', '/player-rankings', '/trade'])
  })

  it('menu dropdown: collapsed accordion with the current page\'s group highlighted, every desktop page reachable, a link closes it', async () => {
    renderShell('/rankings')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    let menu = screen.getByRole('dialog', { name: 'Menu' })
    expect(within(menu).getByRole('combobox', { name: 'My team' })).toBeInTheDocument()
    const heads = within(menu).getAllByRole('heading', { level: 2 })
    expect(heads.map((h) => h.querySelector('.mr-acc-label')?.textContent)).toEqual([
      'League', 'Players', 'Insights', 'Tools', 'NBA', 'Minigames',
    ])
    // all groups start collapsed, like master; the page's own group is highlighted
    for (const b of within(menu).getAllByRole('button', { expanded: false })) expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(within(menu).queryAllByRole('link')).toHaveLength(0)
    expect(within(menu).getByRole('button', { name: /League/ })).toHaveClass('mr-acc-current')
    await userEvent.click(within(menu).getByRole('button', { name: /League/ }))
    expect(within(menu).getByRole('link', { name: /Standings & Rankings/ })).toHaveAttribute('aria-current', 'page')
    // the header button closes it again
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    menu = screen.getByRole('dialog', { name: 'Menu' })

    // every page of the desktop nav is reachable by opening its group
    const hrefs = new Set<string>()
    for (const button of within(menu).getAllByRole('button', { expanded: undefined }).filter((b) => b.hasAttribute('aria-expanded'))) {
      if (button.getAttribute('aria-expanded') === 'false') await userEvent.click(button)
      within(menu).getAllByRole('link').forEach((a) => hrefs.add(a.getAttribute('href') as string))
    }
    for (const group of getNavGroups()) for (const item of group.items) expect(hrefs).toContain(item.path)

    await userEvent.click(within(menu).getByRole('button', { name: /NBA/ }))
    await userEvent.click(within(menu).getByRole('link', { name: /Injuries/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/injuries')
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('header: logo goes home, dark toggle flips the icon, footer has the social links', async () => {
    renderShell('/teams')
    expect(screen.getByRole('link', { name: 'Fantasy League' })).toHaveAttribute('href', '/')
    const toggle = screen.getByRole('button', { name: 'Toggle dark mode' })
    expect(toggle).toHaveTextContent('🌙')
    await userEvent.click(toggle)
    expect(toggle).toHaveTextContent('☀️')
    const footer = screen.getByRole('contentinfo')
    for (const name of ['Email', 'GitHub', 'LinkedIn']) expect(within(footer).getByRole('link', { name })).toBeInTheDocument()
  })
})
