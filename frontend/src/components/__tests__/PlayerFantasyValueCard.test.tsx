import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import PlayerFantasyValueCard from '../PlayerFantasyValueCard'
import type { PlayerRankSummary } from '../../utils/playerRankings'

const SUMMARY = {
  rank: 12, poolSize: 156, totalZ: 1.23, positionRanks: [],
  zScores: { PTS: 1.5, REB: 0.2 },
} as unknown as PlayerRankSummary

function renderCard(periodLabel?: string) {
  return render(
    <MemoryRouter>
      <PlayerFantasyValueCard positions={['SG']} summary={SUMMARY} categories={['REB', 'PTS']} loading={false} periodLabel={periodLabel} />
    </MemoryRouter>,
  )
}

describe('PlayerFantasyValueCard', () => {
  it('names the time frame the rank and z-score are computed over', () => {
    renderCard('Last 7 Days')
    expect(screen.getByRole('heading', { name: /Fantasy Value/ })).toHaveTextContent('Last 7 Days')
    expect(screen.getByText('Last 7 Days · per game')).toBeInTheDocument()
    expect(screen.getByTestId('fantasy-rank')).toHaveTextContent('#12')
  })

  it('defaults to Full Season', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: /Fantasy Value/ })).toHaveTextContent('Full Season')
  })
})
