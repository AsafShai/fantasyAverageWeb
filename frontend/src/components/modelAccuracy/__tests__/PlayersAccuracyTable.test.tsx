import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PlayerAccuracyRow } from '../../../types/api'
import { renderWithProviders } from '../../../test/helpers'
import PlayersAccuracyTable from '../PlayersAccuracyTable'

const rows: PlayerAccuracyRow[] = Array.from({ length: 20 }, (_, i) => ({
  player_id: i + 1, player_name: `Player ${String(i + 1).padStart(2, '0')}`, team_id: 1, team: 'ATL',
  games: [{ game_date: '2026-12-01', opponent_team_id: 2, opponent: 'BOS', z: i / 10, proj_pts: 10, actual_pts: 11, proj_min: 30, actual_min: 30 }],
  dnp: 0, proj_pts: 10, actual_pts: 11, proj_min: 30, actual_min: 30, flag: 'flat',
}))

describe('PlayersAccuracyTable', () => {
  it('shows the 15 most out-of-line players, then all on request', async () => {
    renderWithProviders(<PlayersAccuracyTable rows={rows} />)
    expect(screen.getByText('Player 20')).toBeInTheDocument()
    expect(screen.queryByText('Player 01')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show all 20 players' }))
    expect(screen.getByText('Player 01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
  })
})
