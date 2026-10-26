import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBlob } from 'html-to-image'
import { renderWithProviders } from '../../../test/helpers'
import { MyTeamProvider } from '../../../context/MyTeamContext'
import type { Player } from '../../../types/api'
import type { TradePreset } from '../../../hooks/useTradeState'
import PendingTradeShareButton from '../PendingTradeShareButton'

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }))
vi.mock('../../../config/featureFlags', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../config/featureFlags')>()),
  FF_SHARE_CARDS: true,
}))

// The real pending trade from 2026-10-26: DORELIT gives Gordon, Machlins gives Pritchard.
const PRESET: TradePreset = {
  teamA: { team_id: 4, team_name: 'DORELIT' },
  teamB: { team_id: 15, team_name: 'Machlins team' },
  playersA: [{ player_name: 'Aaron Gordon', player_id: 3064290 }],
  playersB: [{ player_name: 'Payton Pritchard', player_id: 4066354 }],
}

const player = (player_id: number, player_name: string, team_id: number, pts: number): Player => ({
  player_id, player_name, team_id, pro_team: 'X', positions: ['F'], status: 'ONTEAM',
  stats: { pts, reb: 6, ast: 4, stl: 2, blk: 1, fgm: 8, fga: 16, ftm: 4, fta: 5, fg_percentage: 50, ft_percentage: 80, three_pm: 3, minutes: 60, gp: 2 },
})

const roster = (teamId: number, name: string, players: Player[]) => ({
  team: { team_id: teamId, team_name: name }, espn_url: '', players,
  shot_chart: {}, raw_averages: {}, ranking_stats: {}, category_ranks: {}, slot_usage: {},
})

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/teams/4')) return Response.json(roster(4, 'DORELIT', [player(3064290, 'Aaron Gordon', 4, 27)]))
    if (url.includes('/teams/15')) return Response.json(roster(15, 'Machlins team', [player(4066354, 'Payton Pritchard', 15, 21)]))
    if (url.includes('/teams/')) return Response.json([PRESET.teamA, PRESET.teamB])
    return new Response('not found', { status: 404 })
  }))
}

describe('PendingTradeShareButton', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(toBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    stubApi()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shares the trade as a "Trade Accepted" image with the per-game comparison', async () => {
    const { baseElement } = renderWithProviders(
      <MyTeamProvider><PendingTradeShareButton preset={PRESET} processes="Processes Tue 11:01 AM" /></MyTeamProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    const card = () => baseElement.querySelector('.share-card') as HTMLElement
    await waitFor(() => expect(card().querySelector('table')).not.toBeNull())
    expect(within(card()).getByText('Trade Accepted')).toBeInTheDocument()
    expect(within(card()).getByText('Processes Tue 11:01 AM · season per game')).toBeInTheDocument()
    // Each column is what that team receives.
    const tiles = [...card().querySelectorAll('.share-card__tile')]
    expect(tiles.map(t => t.textContent)).toEqual(['DORELIT getsPayton Pritchard', 'Machlins team getsAaron Gordon'])
    const pts = within(card()).getByText('PTS').closest('tr') as HTMLElement
    expect(pts).toHaveTextContent('PTS10.513.5 ▲')
    // Image only: no message to send along.
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).toBeNull()
  })
})
