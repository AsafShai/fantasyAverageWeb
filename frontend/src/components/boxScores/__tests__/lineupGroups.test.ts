import { describe, expect, it } from 'vitest'
import type { BoxPlayerLine } from '../../../types/boxScore'
import { fouledOut, lineupGroups } from '../lineupGroups'

function player(name: string, extra: Partial<BoxPlayerLine> = {}): BoxPlayerLine {
  return {
    player_id: name,
    name,
    position: 'G',
    jersey: '',
    ejected: false,
    on_court: false,
    min: '10',
    pts: '4',
    fg: '2-4',
    fg3: '0-1',
    ft: '0-0',
    reb: '1',
    ast: '1',
    tov: '0',
    stl: '0',
    blk: '0',
    oreb: '0',
    dreb: '1',
    pf: '2',
    plus_minus: '0',
    ...extra,
  }
}

const team = {
  starters: [player('Starter On', { on_court: true }), player('Starter Sat', { pf: '6' })],
  bench: [player('Bench In', { on_court: true, ejected: true }), player('Bench Sat')],
}

describe('lineupGroups', () => {
  it('keeps starters and bench once the game is over', () => {
    expect(lineupGroups(team, false).map(group => [group.label, group.players.map(p => p.name)])).toEqual([
      ['Starters', ['Starter On', 'Starter Sat']],
      ['Bench', ['Bench In', 'Bench Sat']],
    ])
  })

  it('groups a live game by who is on the floor', () => {
    expect(lineupGroups(team, true).map(group => [group.label, group.players.map(p => p.name)])).toEqual([
      ['On the court', ['Starter On', 'Bench In']],
      ['Bench', ['Starter Sat', 'Bench Sat']],
    ])
  })
})

describe('fouledOut', () => {
  it('is the sixth personal foul', () => {
    expect(fouledOut('5')).toBe(false)
    expect(fouledOut('6')).toBe(true)
    expect(fouledOut('')).toBe(false)
    expect(fouledOut('—')).toBe(false)
  })
})
