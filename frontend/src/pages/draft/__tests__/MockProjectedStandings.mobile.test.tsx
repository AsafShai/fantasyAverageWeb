import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdpPlayer, LastYearStats } from '../../../types/api'
import type { MockPick, MockSession, MockSessionPlayer } from '../../../utils/mockDraft'

vi.mock('../../../hooks/useIsBelowLg', () => ({ useIsBelowLg: () => true }))

import { MockProjectedStandings } from '../MockProjectedStandings'

const line = (overrides: Partial<LastYearStats> = {}): LastYearStats => ({
  gp: 70,
  fg_pct: 0.5,
  ft_pct: 0.8,
  fgm: 8,
  fga: 16,
  ftm: 4,
  fta: 5,
  ppg: 20,
  rpg: 5,
  apg: 4,
  spg: 1,
  bpg: 0.5,
  three_pm: 2,
  ...overrides,
})

const EMPTY_SITE = { adp: null, rank: null, ranking: null }

function adp(id: string, stats: LastYearStats | null): AdpPlayer {
  return {
    id,
    espn_id: 1,
    name: id,
    team: null,
    team_abbr: 'DEN',
    photo_url: null,
    positions: ['PG'],
    espn: EMPTY_SITE,
    fantrax: EMPTY_SITE,
    sleeper: EMPTY_SITE,
    yahoo: EMPTY_SITE,
    blend: 1,
    blend_rank: 1,
    spread: null,
    ranking_blend: null,
    ranking_blend_rank: null,
    ranking_spread: null,
    last_year: stats,
    projection: stats ? line({ ppg: 30, gp: 70 }) : null,
  }
}

function session(picks: MockPick[]): MockSession {
  const players: Record<string, MockSessionPlayer> = {}
  for (const pk of picks) {
    players[pk.playerId] = {
      id: pk.playerId,
      espn_id: 1,
      name: pk.playerId,
      team_abbr: 'DEN',
      positions: ['PG'],
    }
  }
  return {
    teams: 2,
    rounds: 10,
    threeRr: true,
    userTeam: 1,
    botDelaySec: 0,
    userClockSec: 60,
    defaultOrder: Object.keys(players),
    userOrder: Object.keys(players),
    players,
    picks,
    rosters: {},
  }
}

describe('MockProjectedStandings mobile', () => {
  it('keeps every control reachable and pins team plus total', () => {
    const picks: MockPick[] = [
      { pick: 1, team: 1, round: 1, pickInRound: 1, playerId: 'star' },
      { pick: 2, team: 2, round: 1, pickInRound: 2, playerId: 'role' },
    ]
    render(
      <MockProjectedStandings
        session={session(picks)}
        detailsById={
          new Map([
            ['star', adp('star', line({ ppg: 30, gp: 80 }))],
            ['role', adp('role', line({ ppg: 10, gp: 60 }))],
          ])
        }
        statsFrom="actual"
        onStatsFrom={vi.fn()}
      />,
    )

    expect(screen.getByText(/swipe for categories/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Averages' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last year' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rankings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fewer picks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More picks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '8' })).toBeNull()
    expect(screen.getByText('1. You')).toBeInTheDocument()
    expect(screen.getByText('2. T2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PTS' })).toBeInTheDocument()
  })
})
