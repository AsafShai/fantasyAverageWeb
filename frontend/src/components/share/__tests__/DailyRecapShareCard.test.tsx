import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DailyRecap } from '../../../utils/dailyRecap'
import { DailyRecapShareCard } from '../DailyRecapShareCard'

const line = [
  { label: 'MIN', value: '36' }, { label: 'FG', value: '12-20' }, { label: '3PT', value: '4-8' },
  { label: 'FT', value: '4-4' }, { label: 'REB', value: '8' }, { label: 'AST', value: '4' },
  { label: 'STL', value: '1' }, { label: 'BLK', value: '0' }, { label: 'TO', value: '2' }, { label: 'PTS', value: '32' },
]

const recap: DailyRecap = {
  best: { teamId: 1, name: 'Beta Squad', rank: 1, total: 92.5, gp: 8, categories: [{ category: 'PTS', points: 11 }, { category: 'REB', points: 8.5 }, { category: 'AST', points: 6 }] },
  worst: { teamId: 2, name: 'Cellar Dwellers', rank: 12, total: 18, gp: 7, categories: [{ category: 'TO', points: 1 }] },
  rise: { teamId: 1, name: 'Beta Squad', totalDelta: 4, rankDelta: 2, categories: [{ category: 'PTS', delta: 2 }, { category: 'REB', delta: -1 }] },
  fall: { teamId: 3, name: 'Sliding', totalDelta: -3.5, rankDelta: -1, categories: [{ category: 'AST', delta: -2 }] },
  lines: [{
    id: '1', name: 'Donovan Mitchell', nbaTeam: 'CLE', opponent: 'CHI', home: true,
    fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad', stats: line, z: 2.41,
  }],
  freeAgents: [{
    id: '2', name: 'Nickeil Alexander-Walker', nbaTeam: 'ATL', opponent: 'IND', home: false,
    fantasyTeam: null, fantasyTeamName: null, stats: line, z: 1.2,
  }],
  started: {
    id: '3', name: 'Cold Starter', nbaTeam: 'LAL', opponent: 'BOS', home: true,
    fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad', stats: line, z: -1.84,
  },
  benched: {
    id: '4', name: 'Sat Star', nbaTeam: 'NYK', opponent: 'MIA', home: false,
    fantasyTeam: 'XYZ', fantasyTeamName: 'Sliding', stats: line, z: 3.1,
  },
  boom: {
    shown: [{
      id: 5, name: 'Boom Guy', opponent: 'PHI', home: true, fantasyTeam: 'ABC', fantasyTeamName: 'Beta Squad',
      stats: [{ label: 'FG', value: '14-22' }, { label: 'PTS', value: '38' }], score: 3.4,
    }],
    total: 6,
    threshold: 2.1,
  },
  bust: {
    shown: [{
      id: 6, name: 'Bust Guy', opponent: 'DEN', home: false, fantasyTeam: null, fantasyTeamName: null,
      stats: [{ label: 'PTS', value: '2' }], score: -2.8,
    }],
    total: 1,
    threshold: 2.2,
  },
}

describe('DailyRecapShareCard', () => {
  it('lays the ten sections out in five rows and shows the night', () => {
    render(
      <DailyRecapShareCard
        dark={false}
        subtitle="Nov 18, 2026"
        recap={recap}
        highlight
        myTeam={{ team_id: 1, team_name: 'Beta Squad', abbrev: 'ABC' }}
      />,
    )

    const titles = [
      'Best team of the night', 'Worst team of the night',
      'Biggest rise', 'Biggest fall',
      'Lines of the night', 'FA of the night',
      'Worst starter performance', 'Best bench performance',
      'Boom', 'Bust',
    ]
    for (const title of titles) expect(screen.getByText(title)).toBeInTheDocument()
    for (const mark of ['🏆', '🥶', '📈', '📉', '🔥', '🆓', '😬', '🪑', '💥', '💩']) {
      expect(screen.getByText(mark)).toBeInTheDocument()
    }
    expect(screen.getByText('Fantasy Daily Recap')).toBeInTheDocument()
    expect(screen.getByText('Nov 18, 2026')).toBeInTheDocument()
    expect(screen.getAllByText('Beta Squad').length).toBeGreaterThan(0)
    expect(screen.getByText('92.5')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.getByText('8.5')).toBeInTheDocument()
    expect(screen.getAllByText('12-20').length).toBeGreaterThan(0)
    expect(screen.getByText('14-22')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('up 2 places')).toBeInTheDocument()
    const rise = [...document.querySelectorAll('.drc-tile')].find(tile => tile.textContent?.includes('Biggest rise'))
    const riseLine = rise?.querySelector('.drc-teamline')
    expect(riseLine?.querySelector('.drc-team')).toHaveTextContent('Beta Squad')
    expect(riseLine?.querySelector('.drc-figure')).toHaveTextContent('+4')
    expect(riseLine?.querySelector('.drc-places')).toHaveTextContent('up 2 places')
    expect(screen.getByText('−3.5')).toBeInTheDocument()
    expect(screen.getByText('down 1 place')).toBeInTheDocument()
    expect(screen.getByText('Donovan Mitchell')).toBeInTheDocument()
    expect(screen.getByText('+2.41')).toBeInTheDocument()
    expect(screen.getByText(/@ IND · FA/)).toBeInTheDocument()
    expect(screen.getByText('-1.84')).toBeInTheDocument()
    expect(screen.getByText('top 1 of 6')).toBeInTheDocument()
    expect(screen.getByText('score ≥ 2.1')).toBeInTheDocument()
    expect(screen.getByText('score ≤ −2.2')).toBeInTheDocument()
    expect(screen.getByText('+3.4')).toBeInTheDocument()

    const grid = document.querySelector('.drc-grid')
    expect(grid?.children).toHaveLength(10)
    expect(grid?.children[0]).toHaveTextContent('Best team of the night')
    expect(grid?.children[1]).toHaveTextContent('Worst team of the night')
    expect(grid?.children[8]).toHaveTextContent('Boom')
    expect(grid?.children[9]).toHaveTextContent('Bust')
    expect(grid?.children[0]).toHaveClass('drc-tile--mine')
    expect(grid?.children[2]).toHaveClass('drc-tile--mine')

    const boom = grid?.children[8]
    const bust = grid?.children[9]
    expect(boom?.querySelector('img.drc-avatar')?.getAttribute('src')).toContain('/5.png')
    expect(bust?.querySelector('img.drc-avatar')?.getAttribute('src')).toContain('/6.png')
  })
})