import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTradeState, type TradePreset } from '../useTradeState'

const PRESET: TradePreset = {
  teamA: { team_id: 4, team_name: 'DORELIT' },
  teamB: { team_id: 15, team_name: 'Machlins team' },
  playersA: [{ player_name: 'Aaron Gordon', player_id: 3064290 }],
  playersB: [{ player_name: 'Payton Pritchard', player_id: 4066354 }],
}

describe('useTradeState', () => {
  it('starts empty without a preset', () => {
    const { result } = renderHook(() => useTradeState())
    expect(result.current.teamA).toBeNull()
    expect(result.current.selectedPlayersA).toEqual([])
  })

  it('starts on a preset trade, and a team change still clears its players', () => {
    const { result } = renderHook(() => useTradeState(PRESET))
    expect(result.current.teamA).toEqual(PRESET.teamA)
    expect(result.current.teamB).toEqual(PRESET.teamB)
    expect(result.current.selectedPlayersA.map(p => p.player_id)).toEqual([3064290])
    expect(result.current.selectedPlayersB.map(p => p.player_id)).toEqual([4066354])
    expect(result.current.tradeMode).toBe('team')

    act(() => result.current.handleTeamAChange({ team_id: 1, team_name: 'Other' }))
    expect(result.current.selectedPlayersA).toEqual([])
    expect(result.current.selectedPlayersB).toHaveLength(1)
  })
})
