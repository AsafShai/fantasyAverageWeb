import { Route, Routes } from 'react-router'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import PlayerProfile from '../PlayerProfile'
import type { NbaPlayerBio } from '../../types/api'

vi.mock('../../mobile/flag', () => ({ useMobileRedesign: () => false }))

const bio: NbaPlayerBio = {
  id: '1',
  display_name: 'Test Player',
  team: 'Boston Celtics',
  team_abbr: 'BOS',
  conference: 'East',
  division: 'Atlantic',
  position: 'PG',
  photo_url: null,
  height: null,
  nationality: null,
  age: null,
  jersey_number: null,
}

vi.mock('../../hooks/usePlayerProfileData', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePlayerProfileData')>('../../hooks/usePlayerProfileData')
  return {
    ...actual,
    usePlayerProfileData: () => ({
      bio,
      bioError: undefined,
      bioLoading: false,
      statsResponse: undefined,
      statsError: undefined,
      statsLoading: false,
      statsFetching: false,
      allPlayers: undefined,
      allPlayersLoading: false,
      fantasyEntry: undefined,
      periodPlayersFetching: false,
      apiCategories: [],
      rankCategories: [],
      rankSummary: null,
      periodLabel: 'Full Season',
    }),
  }
})

const renderProfile = () =>
  renderWithProviders(
    <Routes>
      <Route path="/player/:playerId" element={<PlayerProfile />} />
    </Routes>,
    { route: '/player/1' },
  )

describe('PlayerProfile tabs', () => {
  it('opens on Stats and shows the game log only after Games is selected', async () => {
    const user = userEvent.setup()
    renderProfile()

    expect(screen.getByRole('tab', { name: 'Stats', selected: true })).toBeInTheDocument()
    expect(screen.getByText(/Time frame/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Previous Seasons/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Game log' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /League History/ })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Games' }))

    expect(screen.getByRole('heading', { name: 'Game log' })).toBeInTheDocument()
    expect(screen.queryByText(/Time frame/)).toBeNull()
    expect(screen.queryByRole('heading', { name: /Previous Seasons/ })).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Fantasy' }))

    expect(screen.getByRole('heading', { name: /League History/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Previous Seasons/ })).toBeNull()
  })
})
