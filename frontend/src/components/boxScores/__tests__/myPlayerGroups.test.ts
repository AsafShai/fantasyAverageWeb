import { describe, expect, it } from 'vitest'
import { clusterByGame, filterMineAppearances, groupAppearances, myAppearances, myLine, playedMinutesByGame } from '../myPlayerGroups'
import type { BoxScoreGame, GameBoxScore, SlateLine, SlateValues } from '../../../types/boxScore'

const lakers: BoxScoreGame = {
  game_id: '1',
  status: 'scheduled',
  status_detail: '7:00 PM EDT',
  start_time: '2026-10-26T02:00:00Z',
  broadcast: '',
  venue: '',
  away: { team_id: '13', name: 'Lakers', short_name: 'Lakers', abbreviation: 'LAL', logo: 'lal.png', color: '', record: '', score: null, winner: false },
  home: { team_id: '26', name: 'Jazz', short_name: 'Jazz', abbreviation: 'UTAH', logo: 'uta.png', color: '', record: '', score: null, winner: false },
}

function player(name: string, pro: string, id: number) {
  return { player_name: name, pro_team: pro, positions: ['SF'], player_id: id }
}

describe('myAppearances', () => {
  it('keeps roster players whose NBA team is on the slate and maps Utah', () => {
    const rows = myAppearances(
      [player('LeBron James', 'LAL', 23), player('Lauri Markkanen', 'UTA', 24), player('Boston Guy', 'BOS', 50)],
      [lakers],
    )
    expect(rows.map(row => row.name)).toEqual(['Lauri Markkanen', 'LeBron James'])
    expect(rows[0]).toMatchObject({ teamAbbr: 'UTAH', opponentAbbr: 'LAL', isHome: true })
    expect(rows[1]).toMatchObject({ teamAbbr: 'LAL', opponentAbbr: 'UTAH', isHome: false })
  })

  it('keeps teammates under one game when another game tips at the same time', () => {
    const other = {
      ...lakers,
      game_id: '9',
      away: { ...lakers.away, abbreviation: 'MIA' },
      home: { ...lakers.home, abbreviation: 'ATL' },
    }
    const rows = myAppearances(
      [player('Onyeka Okongwu', 'ATL', 2), player('LeBron James', 'LAL', 23), player('Jalen Johnson', 'ATL', 1)],
      [lakers, other],
    )
    expect(clusterByGame(rows).map(cluster => cluster.players.map(row => row.name))).toEqual([
      ['LeBron James'],
      ['Jalen Johnson', 'Onyeka Okongwu'],
    ])
  })

  it('splits the slate into yet to play, playing, and finished', () => {
    const live = {
      ...lakers,
      game_id: '2',
      status: 'live' as const,
      start_time: '2026-10-26T01:00:00Z',
      away: { ...lakers.away, abbreviation: 'BOS', logo: '' },
      home: { ...lakers.home, abbreviation: 'NY', logo: '' },
    }
    const done = {
      ...lakers,
      game_id: '3',
      status: 'final' as const,
      start_time: '2026-10-26T00:00:00Z',
      away: { ...lakers.away, abbreviation: 'CHI', logo: '' },
      home: { ...lakers.home, abbreviation: 'MIA', logo: '' },
    }
    const rows = myAppearances(
      [player('LeBron James', 'LAL', 23), player('Boston Guy', 'BOS', 50), player('Chicago Guy', 'CHI', 7)],
      [lakers, live, done],
    )
    const groups = groupAppearances(rows)
    expect(groups.upcoming.map(row => row.name)).toEqual(['LeBron James'])
    expect(groups.live.map(row => row.name)).toEqual(['Boston Guy'])
    expect(groups.done.map(row => row.name)).toEqual(['Chicago Guy'])
  })
})

describe('playedMinutesByGame', () => {
  function line(id: string, gameId: string, min: number): SlateLine {
    return {
      player_id: id, name: id, position: 'G', team_abbr: 'LAL', team_logo: '', opponent_abbr: 'BOS',
      is_home: true, game_id: gameId, game_status: 'final', min: String(min), pts: '', reb: '', ast: '',
      stl: '', blk: '', tov: '', fg: '', fg3: '', ft: '', stats: { MIN: min }, fantasy_team: null,
      fantasy_team_name: null, lineup_slot: null, started: null,
    }
  }

  it('keeps only finished games with minutes', () => {
    const values: SlateValues = {
      date: 'x', complete: true, games_counted: 1, categories: [], reverse_categories: [],
      players: [line('1', 'g', 20), line('2', 'g', 0), line('3', 'g2', 5)],
    }
    const map = playedMinutesByGame(values)
    expect([...map.get('g')!]).toEqual(['1'])
    expect(map.get('g2')).toEqual(new Set(['3']))
  })
})

describe('filterMineAppearances', () => {
  it('drops rostered players who did not play on a final slate', () => {
    const done = {
      ...lakers,
      game_id: '3',
      status: 'final' as const,
      away: { ...lakers.away, abbreviation: 'CHI' },
      home: { ...lakers.home, abbreviation: 'MIA' },
    }
    const rows = myAppearances([player('Chicago Guy', 'CHI', 7), player('Bench Guy', 'CHI', 8)], [done])
    const filtered = filterMineAppearances(rows, new Set(), new Map([['3', new Set(['7'])]]))
    expect(filtered.map(row => row.name)).toEqual(['Chicago Guy'])
  })
})

describe('myLine', () => {
  const box = {
    away: {
      starters: [{ player_id: '1', name: 'Austin Reaves' }],
      bench: [],
      did_not_play: [{ player_id: '9', name: 'Sit Out', jersey: '0', reason: "Coach's Decision" }],
    },
    home: { starters: [], bench: [], did_not_play: [] },
  } as unknown as GameBoxScore

  it('finds a played line, a did-not-play, and anyone left off the sheet', () => {
    expect(myLine(box, '1').kind).toBe('played')
    expect(myLine(box, '9')).toEqual({ kind: 'dnp', reason: "Coach's Decision", jersey: '0' })
    expect(myLine(box, '50')).toEqual({ kind: 'out' })
  })
})
