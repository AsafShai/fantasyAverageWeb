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
  it('tab bar: Home · Standings · Teams · Players · Trade, Home current on /', () => {
    renderShell('/')
    const tabs = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Standings', 'Teams', 'Players', 'Trade'])
    expect(tabs[0]).toHaveAttribute('aria-current', 'page')
    expect(tabs.slice(1).every((t) => !t.hasAttribute('aria-current'))).toBe(true)
  })

  it.each([
    ['/team/4', 'Teams'],
    ['/player/123', 'Players'],
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
    expect(TABS.map((t) => t.path)).toEqual(['/', '/rankings', '/teams', '/players', '/trade'])
  })

  it('menu sheet lists every group and page of the desktop nav, and a page link closes it', async () => {
    renderShell('/rankings')
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const menu = screen.getByRole('dialog', { name: 'Menu' })
    for (const group of getNavGroups()) {
      const section = within(menu).getByRole('region', { name: new RegExp(group.label.toUpperCase()) })
      expect(within(section).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(group.items.map((i) => i.path))
    }
    expect(within(menu).getByRole('combobox', { name: 'My team' })).toBeInTheDocument()

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
