import { describe, expect, it } from 'vitest'
import type { Player } from '../../types/api'
import type { WithWithoutEntry, WithWithoutPlayer, WithWithoutTeamSeason } from '../../types/withWithout'
import { scoreAgainstPool } from '../playerRankings'
import {
  buildZContext, formatDelta, formatGameStat, groupAsPlayer, groupLine, joinNames, missedGames, perGame, splitGames, teammateRows,
} from '../withWithout'

const FIELDS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FGM', 'FGA', 'FTM', 'FTA', 'TO', '3PA', 'OREB', 'DREB', 'PF']
const CATS = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']

/** A played game: minutes, points, then fixed filler; FG = fgm/fga. */
const g = (pts: number, fgm = 5, fga = 10): number[] => [30, pts, 5, 3, 1, 1, 2, fgm, fga, 2, 2, 1, 5, 1, 4, 2]

function player(id: number, name: string, lines: WithWithoutEntry[]): WithWithoutPlayer {
  return { player_id: id, name, pos: 'G', two_way: false, approx: false, out_today: null, owner: null, lines }
}

function season(players: WithWithoutPlayer[], n = 8): WithWithoutTeamSeason {
  return {
    team_id: 20, abbr: 'PHI', name: 'Philadelphia 76ers', season: '2026-27',
    categories: CATS, reverse_categories: [], line_fields: FIELDS,
    games: Array.from({ length: n }, (_, i) => ({ game_id: `g${i + 1}`, date: `2026-10-${21 + i}`, opp: 'BOS', home: true, result: 'W 100-90' })),
    players,
  }
}

// The example from planning: he plays 1 2 3 5 7 and sits 4 6 8.
const star = player(1, 'Joel Embiid', [g(30), g(30), g(30), 0, g(30), 0, g(30), 0])

describe('splitGames', () => {
  it('splits interleaved absences game by game', () => {
    expect(splitGames(season([star]), [star], 'all')).toEqual(
      ['with', 'with', 'with', 'without', 'with', 'without', 'with', 'without'],
    )
  })

  it('all vs any with two picked players', () => {
    const other = player(2, 'Paul George', [g(20), 0, g(20), 0, g(20), g(20), g(20), g(20)])
    const s = season([star, other])
    expect(splitGames(s, [star, other], 'all')).toEqual(
      ['with', 'unused', 'with', 'without', 'with', 'unused', 'with', 'unused'],
    )
    expect(splitGames(s, [star, other], 'any')).toEqual(
      ['with', 'without', 'with', 'without', 'with', 'without', 'with', 'without'],
    )
  })

  it('leaves out games before a picked player joined the team', () => {
    const traded = player(3, 'Late Arrival', [null, null, g(10), 0, g(10), 0, g(10), 0])
    expect(splitGames(season([traded]), [traded], 'all').slice(0, 3)).toEqual(['unused', 'unused', 'with'])
  })
})

describe('teammateRows', () => {
  it('averages each side over the games he played', () => {
    // Misses game 2 himself, so "with" is games 1 3 5 7 and "without" 4 6 8.
    const mate = player(5, 'Tyrese Maxey', [g(20), 0, g(22), g(30), g(24), g(28), g(18), g(32)])
    const s = season([star, mate])
    const kinds = splitGames(s, [star], 'all')
    const [row] = teammateRows(s, [1], kinds, ['MIN', 'PTS', 'FG%'], null)
    expect(row.withGroup.games).toBe(4)
    expect(row.withoutGroup.games).toBe(3)
    expect(row.withVals.PTS).toBe(21)
    expect(row.withoutVals.PTS).toBe(30)
    expect(row.deltas.PTS).toBe(9)
    expect(row.zDelta).toBeNull()
  })

  it('drops a teammate who sat exactly the "without" games', () => {
    const mate = player(6, 'Also Out', [g(10), g(10), g(10), 0, g(10), 0, g(10), 0])
    const s = season([star, mate])
    expect(teammateRows(s, [1], splitGames(s, [star], 'all'), ['PTS'], null)).toEqual([])
  })

  it('tags fewer than 3 "without" games as small', () => {
    const mate = player(7, 'Two Games', [g(10), g(10), g(10), g(10), g(10), g(10), g(10), 0])
    const s = season([star, mate])
    const [row] = teammateRows(s, [1], splitGames(s, [star], 'all'), ['PTS'], null)
    expect(row.withoutGroup.games).toBe(2)
    expect(row.small).toBe(true)
  })
})

describe('percentages and Z', () => {
  it('FG% is total makes over total attempts', () => {
    const group = groupLine([g(10, 1, 1), g(10, 9, 19)], FIELDS)
    expect(perGame(group, 'FG%')).toBeCloseTo(10 / 20)
  })

  it('a percentage with no attempts is missing, not 0%', () => {
    const none = groupLine([g(10, 0, 0)], FIELDS)
    expect(perGame(none, 'FG%')).toBeNaN()
    expect(formatDelta('FG%', Number.NaN)).toEqual({ text: '—', dir: 'flat' })
    expect(groupAsPlayer('X', none, CATS).stats.fg_percentage).toBe(0)
  })

  it('Z is the Player Rankings score of the per-game line', () => {
    const pool: Player[] = Array.from({ length: 40 }, (_, i) => ({
      player_name: `P${i}`, pro_team: 'X', positions: ['G'], team_id: 1, status: 'ONTEAM', has_data: true,
      stats: {
        pts: 100 + i * 20, reb: 50 + i * 3, ast: 30 + i * 2, stl: 10 + i, blk: 5 + i, fgm: 40 + i * 4, fga: 90 + i * 5,
        ftm: 20 + i, fta: 25 + i, fg_percentage: (40 + i * 4) / (90 + i * 5), ft_percentage: (20 + i) / (25 + i),
        three_pm: 10 + i, minutes: 300 + i * 10, gp: 10,
      },
    }))
    const ctx = buildZContext(pool, CATS, [])
    const group = groupLine([g(30), g(26), g(28)], FIELDS)
    const mate = player(9, 'M', [g(1), g(30), g(26), g(28)])
    const s = season([player(1, 'Out', [g(1), 0, 0, 0]), mate], 4)
    const [row] = teammateRows(s, [1], splitGames(s, [s.players[0]], 'all'), ['PTS'], ctx)
    const expected = scoreAgainstPool(groupAsPlayer('M', group, CATS), ctx.pool, 'per_game', ctx.weights, CATS, new Set())
    expect(row.zWithout).toBeCloseTo(expected)
    expect(row.zDelta).toBeCloseTo((row.zWithout ?? 0) - (row.zWith ?? 0))
  })
})

describe('helpers', () => {
  it('counts missed games only while on the team', () => {
    expect(missedGames(player(1, 'X', [null, 0, g(1), 0]))).toEqual({ missed: 2, onTeam: 3 })
  })

  it('formats deltas', () => {
    expect(formatDelta('PTS', 2.04)).toEqual({ text: '+2.0', dir: 'up' })
    expect(formatDelta('FG%', -0.023)).toEqual({ text: '−2.3', dir: 'down' })
    expect(formatDelta('REB', 0.01).dir).toBe('flat')
  })

  it('shows one game as whole numbers', () => {
    expect(formatGameStat('PTS', 18)).toBe('18')
    expect(formatGameStat('FG%', 0.6)).toBe('60.0%')
  })

  it('joins last names', () => {
    expect(joinNames(['Joel Embiid'], '&')).toBe('Embiid')
    expect(joinNames(['Joel Embiid', 'Paul George', 'Tyrese Maxey'], 'or')).toBe('Embiid, George or Maxey')
  })
})
