import { describe, expect, it } from 'vitest'
import type { RankingStats, SurpriseRow, TeamRankChange } from '../../types/api'
import type { SlatePlayerValue } from '../../types/boxScore'
import {
  buildDailyRecap,
  dailyRecapMessage,
  pickLines,
  pickMoves,
  pickNightTeams,
  pickStartBench,
  pickSurprises,
  recapNightLabel,
} from '../dailyRecap'

const CATS = ['PTS', 'REB', 'AST', 'STL']

function team(id: number, name: string, total: number, ranks: Record<string, number>): RankingStats {
  return {
    team: { team_id: id, team_name: name },
    fg_percentage: 0, ft_percentage: 0, three_pm: 0, ast: 0, reb: 0, stl: 0, blk: 0, pts: 0,
    gp: 8, total_points: total, category_ranks: ranks,
  }
}

function move(id: number, name: string, total: number | null, rank: number | null = null): TeamRankChange {
  return { team_id: id, team_name: name, total_delta: total, rank_delta: rank, gp_delta: 1, categories: {} }
}

function player(partial: Partial<SlatePlayerValue> & Pick<SlatePlayerValue, 'name' | 'z'>): SlatePlayerValue {
  return {
    player_id: partial.player_id ?? partial.name,
    name: partial.name,
    position: 'SF',
    team_abbr: partial.team_abbr ?? 'LAL',
    team_logo: '',
    opponent_abbr: partial.opponent_abbr ?? 'BOS',
    is_home: partial.is_home ?? true,
    game_id: 'g',
    game_status: 'final',
    min: partial.min ?? '30',
    pts: partial.pts ?? '20',
    reb: partial.reb ?? '5',
    ast: partial.ast ?? '4',
    stl: partial.stl ?? '0',
    blk: partial.blk ?? '0',
    tov: '2',
    fg: '8-16',
    fg3: '2-5',
    ft: '2-2',
    stats: { MIN: 30, ...partial.stats },
    fantasy_team: 'fantasy_team' in partial ? partial.fantasy_team! : 'ABC',
    fantasy_team_name: 'fantasy_team_name' in partial ? partial.fantasy_team_name! : 'Alpha',
    lineup_slot: 'lineup_slot' in partial ? partial.lineup_slot! : 'SF',
    started: 'started' in partial ? partial.started! : true,
    z: partial.z,
  }
}

function surprise(name: string, score: number): SurpriseRow {
  return {
    game_date: '2026-11-18',
    player_id: name.length,
    player_name: name,
    team_abbr: 'LAL',
    opponent_abbr: 'BOS',
    is_home: true,
    minutes: 30,
    pts: 20, reb: 5, ast: 4, fg3m: 2, stl: 0, blk: 0, fgm: 8, fga: 16, ftm: 2, fta: 2,
    score,
    metric_z: null,
    metric_err: null,
    has_estimate: true,
    fantasy_team: 'ABC',
    lineup_slot: 'SF',
    started: true,
    reasons: [],
    verdict: score >= 0 ? 'good' : 'bad',
  }
}

describe('pickNightTeams', () => {
  const rows = [
    team(1, 'Alpha', 40, { PTS: 4, REB: 1, AST: 2, STL: 3 }),
    team(2, 'Zulu', 40, { PTS: 1, REB: 4, AST: 3, STL: 2 }),
    team(3, 'Middle', 28, { PTS: 2, REB: 2, AST: 4, STL: 1 }),
    team(4, 'Cellar', 12, { PTS: 3, REB: 3, AST: 1, STL: 4 }),
  ]

  it('takes the top and bottom Total rows, with the standings tie break', () => {
    const { best, worst } = pickNightTeams(rows, CATS)
    expect(best).toMatchObject({ name: 'Zulu', total: 40, rank: 1 })
    expect(worst).toMatchObject({ name: 'Cellar', total: 12, rank: 4 })
  })

  it('shares a place when totals tie, and lists every category in display order', () => {
    const { best, worst } = pickNightTeams(rows, CATS)
    // Zulu's category_ranks are the roto points, not the place.
    expect(best?.categories).toEqual([
      { category: 'REB', points: 4 },
      { category: 'AST', points: 3 },
      { category: 'STL', points: 2 },
      { category: 'PTS', points: 1 },
    ])
    expect(worst?.categories.map(category => category.category)).toEqual(['REB', 'AST', 'STL', 'PTS'])
    expect(worst?.categories.find(category => category.category === 'AST')).toEqual({ category: 'AST', points: 1 })
    const tied = pickNightTeams(rows.filter(row => row.total_points === 40), CATS)
    expect(tied.best?.rank).toBe(1)
    expect(tied.worst?.rank).toBe(1)
    expect(tied.worst?.name).toBe('Alpha')
  })
})

describe('pickMoves', () => {
  it('keeps the biggest gain and the biggest loss, and ignores a zero', () => {
    const { rise, fall } = pickMoves([
      move(1, 'Up a little', 4, 1),
      move(2, 'Up a lot', 4, 3),
      move(3, 'Flat', 0, 0),
      move(4, 'Down', -3, -2),
      move(5, 'Also down', -3, -1),
    ])
    expect(rise).toMatchObject({ name: 'Up a lot', totalDelta: 4, rankDelta: 3 })
    expect(fall).toMatchObject({ name: 'Down', totalDelta: -3, rankDelta: -2 })
  })

  it('is empty when nobody gained or nobody lost', () => {
    expect(pickMoves([move(1, 'Only up', 2, 1)])).toEqual({
      rise: { teamId: 1, name: 'Only up', totalDelta: 2, rankDelta: 1, categories: [] },
      fall: null,
    })
    expect(pickMoves([move(1, 'Flat', 0)])).toEqual({ rise: null, fall: null })
  })
})

describe('pickLines', () => {
  it('takes the top 3 lines and the top 3 free agents, even outside the overall top 3', () => {
    const { lines, freeAgents } = pickLines([
      player({ name: 'Fourth', z: 1, fantasy_team: null, fantasy_team_name: null }),
      player({ name: 'Star', z: 4 }),
      player({ name: 'Agent', z: 2.5, fantasy_team: null, fantasy_team_name: null }),
      player({ name: 'Second', z: 3 }),
      player({ name: 'Third', z: 2 }),
    ])
    expect(lines.map(line => line.name)).toEqual(['Star', 'Second', 'Agent'])
    expect(freeAgents.map(line => line.name)).toEqual(['Agent', 'Fourth'])
  })
})

describe('pickStartBench', () => {
  it('picks the worst starter who played and the best player who was benched', () => {
    const { started, benched } = pickStartBench([
      player({ name: 'Sat star', z: 3.2, started: false, lineup_slot: 'BN' }),
      player({ name: 'Cold start', z: -1.4, started: true }),
      player({ name: 'Fine start', z: 0.4, started: true }),
      player({ name: 'Did not play', z: -5, started: true, stats: { MIN: 0 } }),
      player({ name: 'Injured star', z: 4, started: false, lineup_slot: 'IR' }),
      player({ name: 'Unknown slot', z: 5, started: null, lineup_slot: null }),
      player({ name: 'Free agent', z: 6, fantasy_team: null, fantasy_team_name: null, started: null, lineup_slot: null }),
      player({ name: 'Other bench', z: 1.1, started: false, lineup_slot: 'BN' }),
    ])
    expect(started?.name).toBe('Cold start')
    expect(benched?.name).toBe('Sat star')
  })
})

describe('pickSurprises', () => {
  it('uses the default bars and keeps the first five', () => {
    const good = [3.4, 2.8, 2.6, 2.4, 2.2, 2.1, 1.2].map((score, i) => surprise(`Boom ${i}`, score))
    const bad = [-4, -2.2, -2.1, -1].map((score, i) => surprise(`Bust ${i}`, score))
    const { boom, bust } = pickSurprises(good, bad, { good: 2.1, bad: 2.2 })
    expect(boom.total).toBe(6)
    expect(boom.shown.map(row => row.name)).toEqual(['Boom 0', 'Boom 1', 'Boom 2', 'Boom 3', 'Boom 4'])
    expect(bust.total).toBe(2)
    expect(bust.shown.map(row => row.score)).toEqual([-4, -2.2])
    expect(boom.shown[0].stats).toEqual([
      { label: 'MIN', value: '30' },
      { label: 'FG', value: '8-16' },
      { label: 'FT', value: '2-2' },
      { label: '3PM', value: '2' },
      { label: 'REB', value: '5' },
      { label: 'AST', value: '4' },
      { label: 'STL', value: '0' },
      { label: 'BLK', value: '0' },
      { label: 'PTS', value: '20' },
    ])
  })
})

describe('recapNightLabel', () => {
  it('uses the standings night, and notes a different player night', () => {
    expect(recapNightLabel('2026-11-18', '2026-11-18', '2026-11-18')).toEqual({
      headline: 'Nov 18, 2026',
      linesNote: null,
    })
    expect(recapNightLabel('2026-11-17', '2026-11-18', '2026-11-17').linesNote).toBe('Nov 17, 2026')
    expect(recapNightLabel(null, null, null).headline).toBe('Last night')
  })
})

describe('buildDailyRecap', () => {
  it('fills every section from the four payloads', () => {
    const recap = buildDailyRecap({
      rankings: [team(1, 'Alpha', 10, { PTS: 2 }), team(2, 'Beta', 20, { PTS: 1 })],
      categories: ['PTS'],
      moves: [move(1, 'Alpha', -1, -1), move(2, 'Beta', 2, 1)],
      players: [player({ name: 'Star', z: 2 }), player({ name: 'Cold', z: -1 })],
      good: [surprise('Boom', 3)],
      bad: [surprise('Bust', -3)],
      thresholds: { good: 2.1, bad: 2.2 },
    })
    expect(recap.best?.name).toBe('Beta')
    expect(recap.worst?.name).toBe('Alpha')
    expect(recap.rise?.name).toBe('Beta')
    expect(recap.fall?.name).toBe('Alpha')
    expect(recap.lines[0].name).toBe('Star')
    expect(recap.started?.name).toBe('Cold')
    expect(recap.boom.shown[0].name).toBe('Boom')
    expect(recap.bust.shown[0].name).toBe('Bust')
  })
})

describe('dailyRecapMessage', () => {
  it('names the night and the best team', () => {
    const { best } = pickNightTeams([team(1, 'Beta', 92.5, {})], [])
    expect(dailyRecapMessage('Nov 18, 2026', best, 'https://app.example/')).toBe(
      '*Fantasy Daily Recap* · Nov 18, 2026\nBest night: *Beta* (92.5)\n🔗 https://app.example/',
    )
  })
})
