import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import CommandPalette from '../CommandPalette'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

const player = (name: string, id: number | null) => ({
  player_name: name, pro_team: 'PHL', positions: ['C'], stats: {}, team_id: 1, status: 'ONTEAM', player_id: id, fantasy_team_name: 'Team One',
})

describe('CommandPalette images', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/players/')) {
        return jsonResponse({ players: [player('Joel Embiid', 3059318), player('Joel Nobody', null)], total_count: 2, page: 1, limit: 1200, has_more: false })
      }
      if (url.includes('/nba-teams')) return jsonResponse([{ team_id: '20', abbreviation: 'PHL', team_name: 'Philadelphia 76ers' }])
      if (url.includes('/teams/')) return jsonResponse([])
      return new Response('not found', { status: 404 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows player headshots and NBA team logos, the icon when there is no image', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CommandPalette isOpen onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Search' })
    await user.type(within(dialog).getByPlaceholderText(/Search players/), 'joel')
    const embiid = (await within(dialog).findByText('Embiid', { exact: false })).closest('div.flex')!
    expect(embiid.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/headshots/nba/players/full/3059318.png'))
    // No ESPN id: no headshot to show, the icon stays.
    const nobody = within(dialog).getByText('Nobody', { exact: false }).closest('div.flex')!
    expect(nobody.querySelector('img')).toBeNull()
    expect(nobody).toHaveTextContent('🏀')

    await user.clear(within(dialog).getByPlaceholderText(/Search players/))
    await user.type(within(dialog).getByPlaceholderText(/Search players/), '76ers')
    const team = (await within(dialog).findByText('76ers', { exact: false })).closest('div.flex')!
    const logo = team.querySelector('img')!
    expect(logo).toHaveAttribute('src', expect.stringContaining('/teamlogos/nba/500/phi.png'))

    // A logo that fails to load falls back to the icon.
    fireEvent.error(logo)
    expect(team.querySelector('img')).toBeNull()
    expect(team).toHaveTextContent('🏟️')
  })
})
