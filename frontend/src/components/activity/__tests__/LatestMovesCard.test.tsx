import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import fixture from '../../../test/fixtures/leagueActivity2026.json'
import LatestMovesCard from '../LatestMovesCard'

function stub(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => (status === 200 ? Response.json(body) : new Response('down', { status })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('LatestMovesCard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the latest moves and links to the full page', async () => {
    const fetchMock = stub({ teams: fixture.teams, moves: fixture.moves.slice(0, 8) })
    renderWithProviders(<LatestMovesCard />)

    await waitFor(() => expect(screen.getByText('ASAF ⇄ DOR')).toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByRole('link', { name: 'All activity →' })).toHaveAttribute('href', '/activity')
    const requested = (fetchMock.mock.calls[0] as unknown[])[0] as Request
    expect(requested.url).toContain('/league/activity/latest?limit=8')
  })

  it('says so when there are no moves yet', async () => {
    stub({ teams: fixture.teams, moves: [] })
    renderWithProviders(<LatestMovesCard />)
    await waitFor(() => expect(screen.getByText('No adds, drops or trades yet this season.')).toBeInTheDocument())
  })

  it('degrades quietly when the activity is unavailable', async () => {
    stub(null, 503)
    renderWithProviders(<LatestMovesCard />)
    await waitFor(() => expect(screen.getByText('League activity is unavailable right now.')).toBeInTheDocument())
  })
})
