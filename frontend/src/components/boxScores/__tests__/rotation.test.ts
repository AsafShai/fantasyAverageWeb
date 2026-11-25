import { describe, expect, it } from 'vitest'
import type { BoxPlay, BoxPlayerLine, BoxTeamBox, GameBoxScore } from '../../../types/boxScore'
import {
  buildRotation,
  clockLabel,
  clockSeconds,
  gameTime,
  intersect,
  mmss,
  periodAt,
  rangeLabel,
  rebuiltMinutes,
  spanPlusMinus,
  together,
  totalPlusMinus,
  type PlayerRotation,
  type Rotation,
  type Span,
} from '../rotation'
import game007 from './fixtures/boxscore-401910007.json'
import game005 from './fixtures/boxscore-401910005.json'

// ── synthetic games ──

const line = (id: string, extra: Partial<BoxPlayerLine> = {}): BoxPlayerLine => ({
  player_id: id, name: `Player ${id}`, jersey: id, position: 'G', ejected: false, on_court: false, min: '', usg: '',
  pts: '', fg: '', fg3: '', ft: '', reb: '', ast: '', tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '',
  ...extra,
})

function team(teamId: string, starters: string[], bench: string[], onCourt: string[] = []): BoxTeamBox {
  const mk = (id: string) => line(id, { on_court: onCourt.includes(id) })
  return {
    team_id: teamId, name: teamId, short_name: teamId, abbreviation: teamId, logo: '', color: '1D428A', record: '', score: 0, winner: false,
    linescores: [], starters: starters.map(mk), bench: bench.map(mk), did_not_play: [],
    totals: { min: '', usg: '', pts: '', fg: '', fg3: '', ft: '', reb: '', ast: '', tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '' },
    shooting: { fg_pct: '', fg3_pct: '', ft_pct: '', points_in_paint: '', fast_break_points: '', turnover_points: '', largest_lead: '' },
  }
}

let seq = 0
function play(period: number, clock: string, kind: BoxPlay['kind'], ids: string[], score: [number, number] = [0, 0], text = ''): BoxPlay {
  seq += 1
  return {
    id: String(seq), period, clock, text: text || (kind === 'sub' ? `${ids[0]} enters the game for ${ids[1]}` : `${kind} ${ids.join(' ')}`),
    team_id: 'A', scoring: kind === 'score', points: 0, away_score: score[0], home_score: score[1], kind, athlete_ids: ids,
  }
}
const sub = (period: number, clock: string, inId: string, outId: string, score: [number, number] = [0, 0]) => play(period, clock, 'sub', [inId, outId], score)
const touch = (period: number, clock: string, ids: string[], score: [number, number] = [0, 0], text = '') => play(period, clock, 'play', ids, score, text)
const end = (period: number, score: [number, number] = [0, 0]) => play(period, '0:00', 'period', [], score, 'End of period')

const AWAY = ['a1', 'a2', 'a3', 'a4', 'a5']
const HOME = ['h1', 'h2', 'h3', 'h4', 'h5']

function synthetic(plays: BoxPlay[], opts: { awayBench?: string[]; live?: boolean; onCourt?: string[]; periods?: string[] } = {}): GameBoxScore {
  return {
    game_id: 'g', status: opts.live ? 'live' : 'final', status_detail: '', start_time: '', broadcast: '', venue: '',
    periods: opts.periods ?? ['1', '2', '3', '4'],
    away: team('A', AWAY, opts.awayBench ?? ['a6', 'a7'], opts.onCourt),
    home: team('H', HOME, [], opts.onCourt),
    plays,
  }
}

/** Every regulation period starts with both fives touching the ball. */
function quarters(count = 4, extra: (period: number) => BoxPlay[] = () => []): BoxPlay[] {
  const out: BoxPlay[] = []
  for (let p = 1; p <= count; p++) {
    out.push(touch(p, p <= 4 ? '11:50' : '4:50', [...AWAY, ...HOME]))
    out.push(...extra(p))
    out.push(end(p))
  }
  return out
}

const byId = (rotation: Rotation, id: string): PlayerRotation | undefined =>
  [...rotation.away.players, ...rotation.home.players].find(player => player.id === id)
const ranges = (player: PlayerRotation | undefined) => (player?.stints ?? []).map(span => [span.start, span.end])

function onFloorAt(players: PlayerRotation[], t: number): string[] {
  return players.filter(player => player.stints.some(span => span.start <= t && t < span.end)).map(player => player.id)
}

describe('clock helpers', () => {
  it('reads clocks and turns them into game time', () => {
    expect(clockSeconds('12:00')).toBe(720)
    expect(clockSeconds('5:14')).toBe(314)
    expect(clockSeconds('0:42.8')).toBeCloseTo(42.8)
    expect(gameTime(1, '12:00')).toBe(0)
    expect(gameTime(2, '5:14')).toBe(720 + 406)
    expect(gameTime(4, '0:00')).toBe(2880)
    expect(gameTime(5, '5:00')).toBe(2880)
    expect(gameTime(6, '2:30')).toBe(2880 + 300 + 150)
  })

  it('labels game times by period, an end on a break belongs to the period it closes', () => {
    expect(clockLabel(0)).toBe('Q1 12:00')
    expect(clockLabel(1228)).toBe('Q2 3:32')
    expect(clockLabel(720, true)).toBe('Q1 0:00')
    expect(clockLabel(720)).toBe('Q2 12:00')
    expect(clockLabel(2880, true)).toBe('Q4 0:00')
    expect(clockLabel(2880)).toBe('OT 5:00')
    expect(clockLabel(3180 + 60)).toBe('2OT 4:00')
    expect(periodAt(3179)).toBe(5)
    expect(mmss(1434.8 - 1440 + 10.2)).toBe('0:05')
  })

  it('writes ranges inside one period, across a break and while running', () => {
    expect(rangeLabel({ start: 1228, end: 1434.8, open: false })).toBe('Q2 3:32 → 0:05')
    expect(rangeLabel({ start: 1126, end: 1788, open: false })).toBe('Q2 5:14 → Q3 6:12')
    expect(rangeLabel({ start: 1908, end: 2000, open: true })).toBe('Q3 4:12 → now')
  })
})

describe('buildRotation', () => {
  it('opens with the starters and walks the subs', () => {
    const plays = quarters(4, p => (p === 1 ? [sub(1, '6:00', 'a6', 'a1', [10, 8]), sub(1, '2:00', 'a1', 'a6', [20, 20])] : []))
    const rotation = buildRotation(synthetic(plays))!
    expect(rotation.periods).toBe(4)
    expect(rotation.total).toBe(2880)
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 360], [600, 2880]])
    expect(ranges(byId(rotation, 'a6'))).toEqual([[360, 600]])
    expect(byId(rotation, 'a7')).toBeUndefined()
    expect(rotation.away.players.map(player => player.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
    expect(byId(rotation, 'a6')!.starter).toBe(false)
  })

  it('infers who started a later period from each player\'s first row in it', () => {
    const plays = [
      touch(1, '11:50', [...AWAY, ...HOME]),
      end(1),
      // a6 starts Q2 for a1: his first row is a shot, a1 never appears.
      touch(2, '11:30', ['a6', 'a2', 'a3', 'a4', 'a5', ...HOME]),
      // a1 comes back by sub: entering is not starting.
      sub(2, '6:00', 'a1', 'a6'),
      end(2),
      ...[3, 4].flatMap(p => [touch(p, '11:50', [...AWAY, ...HOME]), end(p)]),
    ]
    const rotation = buildRotation(synthetic(plays))!
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 720], [1080, 2880]])
    expect(ranges(byId(rotation, 'a6'))).toEqual([[720, 1080]])
  })

  it('handles opening subs logged after the jump ball (overtime)', () => {
    const plays = [
      ...quarters(4),
      // The tip names a6, who only enters through the sub logged after it.
      touch(5, '5:00', ['a6', 'h1'], [100, 100], 'a6 vs. h1 (jump ball)'),
      sub(5, '5:00', 'a6', 'a1', [100, 100]),
      touch(5, '4:30', ['a2', 'a3', 'a4', 'a5', ...HOME], [100, 100]),
      end(5, [105, 103]),
    ]
    const rotation = buildRotation(synthetic(plays, { periods: ['1', '2', '3', '4', 'OT'] }))!
    expect(rotation.periods).toBe(5)
    expect(rotation.total).toBe(3180)
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 2880]])
    expect(ranges(byId(rotation, 'a6'))).toEqual([[2880, 3180]])
    expect(onFloorAt(rotation.away.players, 3000)).toHaveLength(5)
  })

  it('ignores a repeated enters for a player already on the floor', () => {
    const plays = quarters(4, p => (p === 1 ? [
      sub(1, '6:00', 'a6', 'a1'),
      sub(1, '4:00', 'a6', 'a1'), // logged twice
      sub(1, '2:00', 'a1', 'a6'),
    ] : []))
    const rotation = buildRotation(synthetic(plays))!
    expect(ranges(byId(rotation, 'a6'))).toEqual([[360, 600]])
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 360], [600, 2880]])
  })

  it('merges back-to-back stints and drops stints under a second', () => {
    const plays = quarters(4, p => (p === 1 ? [
      sub(1, '6:00', 'a6', 'a1'),
      sub(1, '5:59.5', 'a1', 'a6'), // a6 on for half a second
      sub(1, '3:00', 'a7', 'a2'),
      sub(1, '3:00', 'a2', 'a7'), // same-clock swap
    ] : []))
    const rotation = buildRotation(synthetic(plays))!
    expect(byId(rotation, 'a6')).toBeUndefined()
    expect(byId(rotation, 'a7')).toBeUndefined()
    expect(ranges(byId(rotation, 'a2'))).toEqual([[0, 2880]])
    // a1 spans the quarter breaks as one stint, short gap kept.
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 360], [360.5, 2880]])
  })

  it('takes +/- at each sub, carrying free throws to the five on the floor at the foul', () => {
    const plays = [
      touch(1, '11:50', [...AWAY, ...HOME]),
      touch(1, '6:00', ['h1'], [10, 10], 'h1 shooting foul'),
      sub(1, '6:00', 'a6', 'a1', [10, 10]),
      play(1, '6:00', 'score', ['a2'], [11, 10], 'a2 makes free throw 1 of 2'),
      play(1, '6:00', 'score', ['a2'], [12, 10], 'a2 makes free throw 2 of 2'),
      touch(1, '6:00', ['h2'], [12, 10], 'h2 personal foul'),
      play(1, '6:00', 'score', ['a6'], [13, 10], 'a6 makes free throw 1 of 1'),
      end(1, [20, 30]),
      ...[2, 3, 4].flatMap(p => [touch(p, '11:50', ['a6', 'a2', 'a3', 'a4', 'a5', ...HOME], [20, 30]), end(p, [20, 30])]),
    ]
    const rotation = buildRotation(synthetic(plays))!
    const a1 = byId(rotation, 'a1')!
    const a6 = byId(rotation, 'a6')!
    expect(a1.stints[0].endScore).toEqual([12, 10])
    expect(spanPlusMinus('away', a1.stints[0])).toBe(2)
    expect(a6.stints[0].startScore).toEqual([12, 10])
    expect(totalPlusMinus('away', a6.stints)).toBe(-12)
    expect(totalPlusMinus('home', byId(rotation, 'h1')!.stints)).toBe(10)
  })

  it('rebuilds a live period from the on-court five, open stints ending at the latest play', () => {
    const plays = [
      ...quarters(2),
      // Q3 starts with a1..a5; a1 has not touched the ball yet.
      touch(3, '11:40', ['a2', 'a3', 'a4', 'a5', ...HOME], [50, 50]),
      sub(3, '8:00', 'a6', 'a2', [55, 52]),
      touch(3, '7:00', ['a3'], [57, 52]),
    ]
    const game = synthetic(plays, { live: true, onCourt: ['a1', 'a6', 'a3', 'a4', 'a5', ...HOME], periods: ['1', '2', '3'] })
    const rotation = buildRotation(game)!
    expect(rotation.live).toBe(true)
    expect(rotation.periods).toBe(4)
    expect(rotation.now).toBe(1440 + 300)
    const a1 = byId(rotation, 'a1')!
    expect(ranges(a1)).toEqual([[0, 1740]])
    expect(a1.stints[0].open).toBe(true)
    expect(ranges(byId(rotation, 'a2'))).toEqual([[0, 1680]])
    expect(byId(rotation, 'a2')!.stints[0].open).toBe(false)
    expect(ranges(byId(rotation, 'a6'))).toEqual([[1680, 1740]])
    expect(onFloorAt(rotation.away.players, 1700)).toHaveLength(5)
  })

  it('undoes live subs newest first, skipping opening subs and repeated enters', () => {
    const plays = [
      ...quarters(2),
      sub(3, '12:00', 'a7', 'a5'), // opening sub
      sub(3, '9:00', 'a6', 'a1'),
      sub(3, '8:00', 'a6', 'a1'), // repeated
      touch(3, '7:00', ['a3']),
    ]
    const onCourt = ['a6', 'a2', 'a3', 'a4', 'a7', ...HOME]
    const rotation = buildRotation(synthetic(plays, { live: true, onCourt, periods: ['1', '2', '3'] }))!
    expect(ranges(byId(rotation, 'a1'))).toEqual([[0, 1620]])
    expect(ranges(byId(rotation, 'a5'))).toEqual([[0, 1440]])
    expect(ranges(byId(rotation, 'a7'))).toEqual([[1440, 1740]])
    expect(ranges(byId(rotation, 'a6'))).toEqual([[1620, 1740]])
  })

  it('returns null without usable plays', () => {
    expect(buildRotation(synthetic([]))).toBeNull()
    const old = quarters(4, p => (p === 1 ? [sub(1, '6:00', 'a6', 'a1')] : [])).map(row => ({ ...row, athlete_ids: undefined }))
    expect(buildRotation(synthetic(old as BoxPlay[]))).toBeNull()
    const noPlays = synthetic([])
    delete noPlays.plays
    expect(buildRotation(noPlays)).toBeNull()
  })
})

describe('intersect / together', () => {
  const span = (start: number, end: number, startScore: [number, number], endScore: [number, number], open = false): Span => ({ start, end, startScore, endScore, open })

  it('keeps the score at the edges of each shared piece', () => {
    const a = [span(0, 600, [0, 0], [20, 15]), span(900, 1400, [25, 22], [40, 40])]
    const b = [span(300, 1000, [8, 6], [30, 25])]
    const shared = intersect(a, b)
    expect(shared.map(x => [x.start, x.end])).toEqual([[300, 600], [900, 1000]])
    expect(shared[0].startScore).toEqual([8, 6])
    expect(shared[0].endScore).toEqual([20, 15])
    expect(shared[1].startScore).toEqual([25, 22])
    expect(shared[1].endScore).toEqual([30, 25])
    expect(spanPlusMinus('away', shared[0])).toBe(3)
  })

  it('is empty when they never overlap', () => {
    expect(intersect([span(0, 100, [0, 0], [0, 0])], [span(100, 200, [0, 0], [0, 0])])).toEqual([])
    expect(together([])).toEqual([])
  })

  it('is open only when every span is still running', () => {
    const shared = intersect([span(0, 500, [0, 0], [9, 9], true)], [span(100, 500, [1, 1], [9, 9], true)])
    expect(shared[0].open).toBe(true)
    expect(intersect([span(0, 500, [0, 0], [9, 9], true)], [span(100, 400, [1, 1], [5, 5])])[0].open).toBe(false)
  })

  it('gives lineup minutes for five players', () => {
    const rotation = buildRotation(game007 as unknown as GameBoxScore)!
    const starters = rotation.away.players.filter(player => player.starter)
    expect(starters).toHaveLength(5)
    const lineup = together(starters.map(player => player.stints))
    expect(lineup[0].start).toBe(0)
    // Every second of a five-man stretch has exactly those five on the floor.
    for (const piece of lineup) {
      const mid = (piece.start + piece.end) / 2
      expect(onFloorAt(rotation.away.players, mid).sort()).toEqual(starters.map(player => player.id).sort())
    }
    const pairs = together(starters.slice(0, 2).map(player => player.stints))
    const total = (list: Span[]) => list.reduce((sum, x) => sum + x.end - x.start, 0)
    expect(total(pairs)).toBeGreaterThanOrEqual(total(lineup))
  })
})

describe('real games', () => {
  const games = { '401910007': game007, '401910005 (overtime, opening subs after the tip)': game005 } as unknown as Record<string, GameBoxScore>

  for (const [name, game] of Object.entries(games)) {
    it(`${name}: every player's rebuilt minutes are within 1 of the box MIN`, () => {
      const rotation = buildRotation(game)!
      expect(rotation).not.toBeNull()
      for (const side of ['away', 'home'] as const) {
        const played = [...game[side].starters, ...game[side].bench].filter(line => Number(line.min) > 0)
        // Everyone with minutes has a row (a few seconds can show as MIN 0).
        const rows = rotation[side].players.map(player => player.id)
        expect(rows).toEqual(expect.arrayContaining(played.map(line => line.player_id)))
        for (const player of rotation[side].players) {
          expect(Math.abs(rebuiltMinutes(player) - Number(player.player.min)), player.player.name).toBeLessThanOrEqual(1)
        }
      }
    })

    it(`${name}: five on the floor for each team (but for sub-second gaps)`, () => {
      const rotation = buildRotation(game)!
      for (const side of ['away', 'home'] as const) {
        let off = 0
        for (let t = 0.25; t < rotation.total; t += 0.5) {
          if (onFloorAt(rotation[side].players, t).length !== 5) off += 0.5
        }
        expect(off).toBeLessThanOrEqual(2)
      }
    })

    it(`${name}: a live replay at each play matches the final rotation so far`, () => {
      const final = buildRotation(game)!
      const plays = game.plays!
      let checked = 0
      for (let k = 20; k < plays.length - 1; k += 7) {
        const latest = plays[k]
        if (plays[k + 1].clock === latest.clock && plays[k + 1].period === latest.period) continue
        if (latest.kind === 'period') continue
        const now = gameTime(latest.period, latest.clock)
        const onCourt = new Set([...final.away.players, ...final.home.players].filter(player => player.stints.some(span => span.start <= now && now < span.end)).map(player => player.id))
        const mark = (t: BoxTeamBox): BoxTeamBox => ({
          ...t,
          starters: t.starters.map(l => ({ ...l, on_court: onCourt.has(l.player_id) })),
          bench: t.bench.map(l => ({ ...l, on_court: onCourt.has(l.player_id) })),
        })
        const liveGame: GameBoxScore = { ...game, status: 'live', away: mark(game.away), home: mark(game.home), plays: plays.slice(0, k + 1) }
        const live = buildRotation(liveGame)!
        expect(live.now).toBe(now)
        for (const player of [...final.away.players, ...final.home.players]) {
          const sofar = player.stints.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, now) - span.start), 0)
          const rebuilt = byId(live, player.id)?.stints.reduce((sum, span) => sum + span.end - span.start, 0) ?? 0
          expect(Math.abs(rebuilt - sofar), `${player.player.name} at ${clockLabel(now)}`).toBeLessThanOrEqual(1)
        }
        checked += 1
      }
      expect(checked).toBeGreaterThan(10)
    })
  }
})
