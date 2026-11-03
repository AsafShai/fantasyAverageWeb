import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TeamRanking } from '../../../types/estimator'
import { ProjectedRankingsShareCard, RankProbabilityShareCard } from '../EstimatorShareCards'

const heatRows = [
  { team_id: 1, team_name: 'Alpha', probs: new Map([[1, 0.881], [2, 0.119]]) },
  { team_id: 2, team_name: 'Beta', probs: new Map([[1, 0.004], [2, 0.996]]) },
]

const ranking = (team_id: number, team_name: string, rank: number): TeamRanking => ({
  team_id, team_name, rank,
  total_expected_pts: 20 - rank,
  expected_pts_fg_pct: 1.25, expected_pts_ft_pct: 2, expected_pts_three_pm: 2, expected_pts_reb: 2,
  expected_pts_ast: 2, expected_pts_stl: 2, expected_pts_blk: 2, expected_pts_pts: 2,
  projected_total_gp: 817.9,
})

describe('RankProbabilityShareCard', () => {
  it('shows percents as the page does, one decimal, nothing for no chance', () => {
    render(<RankProbabilityShareCard dark={false} rows={heatRows} places={[1, 2, 3]} asOf="Nov 2" highlightTeamId={null} />)
    const [, alpha, beta] = screen.getAllByRole('row')
    expect(within(alpha).getAllByRole('cell').map(c => c.textContent)).toEqual(['Alpha', '88.1%', '11.9%', ''])
    expect(within(beta).getAllByRole('cell').map(c => c.textContent)).toEqual(['Beta', '0.4%', '99.6%', ''])
  })

  it('keeps the page order and marks my team', () => {
    render(<RankProbabilityShareCard dark rows={heatRows} places={[1, 2]} asOf="Nov 2" highlightTeamId={2} />)
    const [, alpha, beta] = screen.getAllByRole('row')
    expect(alpha).toHaveTextContent('Alpha')
    expect(beta).toHaveClass('sc-me')
    expect(screen.getByText('2 teams')).toBeInTheDocument()
  })
})

describe('ProjectedRankingsShareCard', () => {
  it('shows each team in the page order with points, total and projected games', () => {
    const rows = [ranking(2, 'Beta', 2), ranking(1, 'Alpha', 1)]
    render(<ProjectedRankingsShareCard dark={false} rows={rows} asOf="Nov 2" highlightTeamId={1} />)
    const [header, beta, alpha] = screen.getAllByRole('row')
    expect(within(header).getAllByRole('columnheader').map(c => c.textContent)).toEqual(
      ['#', 'Team', 'FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS', 'Tot', 'GP'],
    )
    expect(within(beta).getAllByRole('cell').map(c => c.textContent)).toEqual(
      ['2', 'Beta', '1.3', '2.0', '2.0', '2.0', '2.0', '2.0', '2.0', '2.0', '18.0', '818'],
    )
    expect(alpha).toHaveClass('sc-me')
  })
})
