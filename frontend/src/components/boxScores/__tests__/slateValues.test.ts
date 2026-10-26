import { describe, expect, it } from 'vitest'
import { slatePlayerValues } from '../slateValues'
import type { SlateLine, SlateValues } from '../../../types/boxScore'

function line(id: string, stats: Record<string, number>): SlateLine {
  return {
    player_id: id, name: `P${id}`, position: 'G', team_abbr: 'LAL', team_logo: '', opponent_abbr: 'UTAH',
    is_home: false, game_id: '1', game_status: 'final', min: String(stats.MIN), pts: '', reb: '', ast: '',
    stl: '', blk: '', tov: '', fg: '', fg3: '', ft: '', stats, fantasy_team: null, fantasy_team_name: null,
  }
}

function slate(players: SlateLine[], categories = ['PTS'], reverse: string[] = []): SlateValues {
  return { date: '2026-10-25', complete: true, games_counted: 1, categories, reverse_categories: reverse, players }
}

describe('slatePlayerValues', () => {
  it('gives the Player Rankings value of the night, highest first', () => {
    const out = slatePlayerValues(slate([line('a', { MIN: 20, PTS: 10 }), line('b', { MIN: 30, PTS: 30 })]))
    expect(out.map(p => [p.player_id, p.z])).toEqual([['b', 1], ['a', -1]])
  })

  it('scores a 0-minute line against the pool without joining it', () => {
    const played = [line('a', { MIN: 20, PTS: 10 }), line('b', { MIN: 30, PTS: 30 })]
    const out = slatePlayerValues(slate([...played, line('c', { MIN: 0, PTS: 0 })]))
    expect(out.find(p => p.player_id === 'b')!.z).toBe(1)
    expect(out.find(p => p.player_id === 'c')!.z).toBe(-2)   // (0 - 20) / 10
  })

  it('negates reverse categories and weights FG% by attempts', () => {
    const careful = line('a', { MIN: 30, TO: 0, 'FG%': 0.5, FGM: 10, FGA: 20 })
    const sloppy = line('b', { MIN: 30, TO: 6, 'FG%': 0.2, FGM: 2, FGA: 10 })
    const out = slatePlayerValues(slate([sloppy, careful], ['TO', 'FG%'], ['TO']))
    expect(out[0].player_id).toBe('a')
    expect(out[0].z).toBeCloseTo(1)
  })
})
