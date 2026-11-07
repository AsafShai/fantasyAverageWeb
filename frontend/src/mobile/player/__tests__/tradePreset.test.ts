import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTradeState } from '../../../hooks/useTradeState'
import type { Player, Team } from '../../../types/api'
import { tradePresetForPlayer } from '../tradePreset'

const TEAMS: Team[] = [
  { team_id: 1, team_name: 'Alpha Team' },
  { team_id: 2, team_name: 'My Team' },
]
const stats = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0 }
const rostered: Player = { player_name: 'Alpha Star', player_id: 7, pro_team: 'LAL', positions: ['PG'], team_id: 1, status: 'ONTEAM', fantasy_team_name: 'Alpha Team', stats }
const free: Player = { ...rostered, player_name: 'Free Guy', player_id: 9, team_id: 0, status: 'FREEAGENT', fantasy_team_name: null }
const me = (p: Player) => ({ player_name: p.player_name, player_id: p.player_id })

describe('tradePresetForPlayer', () => {
  it('another team\'s player: My Team ⇄ his team, him on his side', () => {
    expect(tradePresetForPlayer(rostered, TEAMS, 2)).toEqual({
      mode: 'team', teamA: TEAMS[1], teamB: TEAMS[0], playersA: [], playersB: [me(rostered)],
    })
  })

  it('no My Team (or my own player): his team on side A with him picked', () => {
    const expected = { mode: 'team', teamA: TEAMS[0], teamB: null, playersA: [me(rostered)], playersB: [] }
    expect(tradePresetForPlayer(rostered, TEAMS, null)).toEqual(expected)
    expect(tradePresetForPlayer(rostered, TEAMS, 1)).toEqual(expected)
  })

  it('free agent: vs Free Agents with him picked, My Team on side A', () => {
    expect(tradePresetForPlayer(free, TEAMS, 2)).toEqual({
      mode: 'freeAgent', teamA: TEAMS[1], teamB: null, playersA: [], playersB: [], freeAgents: [me(free)],
    })
  })

  it('useTradeState starts from it', () => {
    const { result } = renderHook(() => useTradeState(tradePresetForPlayer(free, TEAMS, 2)))
    expect(result.current.tradeMode).toBe('freeAgent')
    expect(result.current.teamA).toEqual(TEAMS[1])
    expect(result.current.selectedFreeAgents.map((p) => p.player_name)).toEqual(['Free Guy'])
    const team = renderHook(() => useTradeState(tradePresetForPlayer(rostered, TEAMS, 2))).result.current
    expect(team.tradeMode).toBe('team')
    expect(team.teamB).toEqual(TEAMS[0])
    expect(team.selectedPlayersB.map((p) => p.player_name)).toEqual(['Alpha Star'])
  })
})
