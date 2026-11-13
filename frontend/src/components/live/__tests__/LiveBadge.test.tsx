import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveBadge from '../LiveBadge'
import { renderWithProviders } from '../../../test/helpers'
import type { LiveBlock } from '../../../types/api'

const live: LiveBlock = {
  active: true, period: 24, as_of: '2026-11-13T01:42:00Z',
  games_total: 4, games_live: 2, games_final: 1, official_updated_at: '2026-11-12T08:15:00Z',
}
const side = (abbreviation: string) => ({ team_id: abbreviation, name: abbreviation, short_name: abbreviation, abbreviation, logo: '', color: '', record: '', score: null, winner: false })
const game = (id: string, away: string, home: string, status: string, detail: string) => ({
  game_id: id, status, status_detail: detail, start_time: '2026-11-13T09:00:00Z', broadcast: '', venue: '', away: side(away), home: side(home),
})

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = (input as Request).url
    const body = url.includes('current-slate-date')
      ? '"2026-11-12"'
      : JSON.stringify({ date: '2026-11-12', games: [
          game('1', 'TOR', 'PHI', 'final', 'Final'),
          game('2', 'DET', 'WSH', 'live', 'Q3 4:12'),
          game('3', 'DAL', 'MIN', 'scheduled', '4:00 AM'),
        ] })
    return new Response(body, { headers: { 'Content-Type': 'application/json' } })
  })
}

describe('LiveBadge', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('falls back to the ESPN updated note when there is no live block', () => {
    renderWithProviders(<LiveBadge live={undefined} espnUpdatedAt="2026-11-13T08:03:07Z" />)
    expect(screen.getByText(/ESPN updated/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('falls back to the ESPN note when the block is inactive', () => {
    renderWithProviders(<LiveBadge live={{ ...live, active: false, games_live: 0, games_final: 0 }} espnUpdatedAt="2026-11-13T08:03:07Z" />)
    expect(screen.getByText(/ESPN updated/)).toBeInTheDocument()
  })

  it('shows LIVE with games in progress, replacing the ESPN note', () => {
    renderWithProviders(<LiveBadge live={live} espnUpdatedAt="2026-11-13T08:03:07Z" />)
    const btn = screen.getByRole('button', { name: /LIVE/ })
    expect(btn).toHaveTextContent('2 of 4 games in progress')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/ESPN updated/)).toBeNull()
  })

  it('shows FINAL when all games are counted and ESPN is pending', () => {
    renderWithProviders(<LiveBadge live={{ ...live, games_live: 0, games_final: 4 }} />)
    expect(screen.getByRole('button', { name: /FINAL/ })).toHaveTextContent('all 4 games counted · ESPN official pending')
  })

  it('opens tonight\'s games on tap, only fetching them then', async () => {
    const fetchSpy = mockApi()
    renderWithProviders(<LiveBadge live={live} />)
    expect(fetchSpy).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /LIVE/ }))
    expect(await screen.findByText("Tonight's games")).toBeInTheDocument()
    expect(await screen.findByText('TOR @ PHI')).toBeInTheDocument()
    expect(screen.getByText('Final')).toBeInTheDocument()
    expect(screen.getByText('Q3 4:12')).toBeInTheDocument()
    expect(screen.getByText(/ESPN official standings: yesterday/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /LIVE/ })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: /LIVE/ }))
    await waitFor(() => expect(screen.queryByText("Tonight's games")).toBeNull())
  })

  it('hides the game clock while No spoilers is on', async () => {
    localStorage.setItem('fw:boxScores.noSpoilers', 'true')
    mockApi()
    renderWithProviders(<LiveBadge live={live} />)
    await userEvent.click(screen.getByRole('button', { name: /LIVE/ }))
    expect(await screen.findByText('DET @ WSH')).toBeInTheDocument()
    expect(screen.queryByText('Q3 4:12')).toBeNull()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })
})
