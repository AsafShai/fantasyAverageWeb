import { describe, it, expect } from 'vitest'
import { buildScoredPicks, buildTeamGrades, topSteals, topBusts } from '../draftReport'
import type { Player, DraftPick } from '../../types/api'

function makePlayer(overrides: {
  name?: string
  pts?: number
  gp?: number
  minutes?: number
  has_data?: boolean
}): Player {
  return {
    player_name: overrides.name ?? 'Player',
    pro_team: 'LAL',
    positions: ['PG'],
    stats: {
      pts: overrides.pts ?? 20,
      reb: 5, ast: 5, stl: 1, blk: 0.5, three_pm: 2,
      fg_percentage: 0.47, ft_percentage: 0.85,
      fgm: 8, fga: 17, ftm: 4, fta: 5,
      minutes: overrides.minutes ?? 30,
      gp: overrides.gp ?? 70,
    },
    team_id: 1,
    status: 'ONTEAM',
    has_data: overrides.has_data ?? true,
  }
}

function makePick(overrides: { pick: number; player_name: string; team_id?: number; team_name?: string; round?: number }): DraftPick {
  return {
    pick: overrides.pick,
    round: overrides.round ?? 1,
    team_id: overrides.team_id ?? 1,
    team_name: overrides.team_name ?? 'Team A',
    player_name: overrides.player_name,
  }
}

// A pool of "filler" players spread evenly around the mean so a standout
// player's z-score (and thus rank/diff/badge) is predictable and stable.
function fillerPool(n: number, teamId = 2): Player[] {
  return Array.from({ length: n }, (_, i) =>
    makePlayer({ name: `Filler ${i}`, pts: 10 + (i % 5), gp: 70 })
  ).map(p => ({ ...p, team_id: teamId }))
}

describe('buildScoredPicks', () => {
  it('ranks a standout early pick as a steal when picked late', () => {
    const star = makePlayer({ name: 'Star', pts: 40, gp: 70 })
    const picks = [makePick({ pick: 150, player_name: 'Star' })]
    const [scored] = buildScoredPicks(picks, [star, ...fillerPool(30)], 'per_game')

    expect(scored.valueRank).toBe(1)
    expect(scored.diff).toBe(149)
    expect(scored.badge).toBe('Steal')
  })

  it('marks a player below the games-played floor as INJ, not ranked', () => {
    const hurt = makePlayer({ name: 'Hurt Guy', pts: 30, gp: 5 })
    const picks = [makePick({ pick: 10, player_name: 'Hurt Guy' })]
    const [scored] = buildScoredPicks(picks, [hurt, ...fillerPool(30)], 'per_game')

    expect(scored.badge).toBe('INJ')
    expect(scored.valueRank).toBeNull()
    expect(scored.gp).toBe(5)
  })

  it('marks a zero-GP player as DNP', () => {
    const dnp = makePlayer({ name: 'Zero GP', gp: 0, minutes: 0 })
    const picks = [makePick({ pick: 10, player_name: 'Zero GP' })]
    const [scored] = buildScoredPicks(picks, [dnp, ...fillerPool(30)], 'per_game')

    expect(scored.badge).toBe('DNP')
    expect(scored.valueRank).toBeNull()
  })

  it('marks a player entirely absent from the pool as DNP', () => {
    const picks = [makePick({ pick: 10, player_name: 'Never Drafted Reality' })]
    const [scored] = buildScoredPicks(picks, fillerPool(30), 'per_game')

    expect(scored.badge).toBe('DNP')
    expect(scored.gp).toBeNull()
    expect(scored.totalZ).toBeNull()
  })

  it('excludes players with has_data=false from the ranking pool', () => {
    const noData = makePlayer({ name: 'No Data', has_data: false, gp: 70 })
    const picks = [makePick({ pick: 10, player_name: 'No Data' })]
    const [scored] = buildScoredPicks(picks, [noData, ...fillerPool(30)], 'per_game')

    expect(scored.badge).toBe('DNP')
  })

  it('ranks a qualified player beyond the 300-player display cap correctly (not INJ)', () => {
    const bench = makePlayer({ name: 'Deep Bench', pts: 5, gp: 20 })
    const picks = [makePick({ pick: 300, player_name: 'Deep Bench' })]
    // 350 filler players forces computePlayerRankings' internal top-300 cap
    const [scored] = buildScoredPicks(picks, [bench, ...fillerPool(350)], 'per_game')

    expect(scored.badge).not.toBe('INJ')
    expect(scored.valueRank).not.toBeNull()
    expect(scored.gp).toBe(20)
  })
})

describe('buildTeamGrades', () => {
  it('grades absolutely on realized/expected value ratio', () => {
    // A team that beats its slots (valueRank < pick) clears 1.0 and earns an A;
    // a team that busts every slot falls well under 0.82 and earns an F. Grades
    // are absolute, so both can coexist without a forced distribution.
    const beat = [30, 40, 50].map((pick, i) => ({
      pick, round: 3, team_id: 1, team_name: 'Beat', player_name: `A${i}`,
      gp: 70, mpg: 30, totalZ: 1, valueRank: pick - 20, diff: 20, badge: 'Steal' as const,
    }))
    const missed = [30, 40, 50].map((pick, i) => ({
      pick, round: 3, team_id: 2, team_name: 'Missed', player_name: `B${i}`,
      gp: 70, mpg: 30, totalZ: -1, valueRank: pick + 120, diff: -120, badge: 'Bust' as const,
    }))
    const grades = buildTeamGrades([...beat, ...missed])

    const beatGrade = grades.find(g => g.team_name === 'Beat')!
    const missedGrade = grades.find(g => g.team_name === 'Missed')!
    expect(beatGrade.ratio).toBeGreaterThan(1)
    expect(beatGrade.grade).toBe('A')
    expect(missedGrade.ratio).toBeLessThan(0.82)
    expect(missedGrade.grade).toBe('F')
    expect(grades[0].team_name).toBe('Beat')
  })

  it('rewards the same raw diff more when it happens at an earlier pick', () => {
    const scoredPicks = [
      { pick: 50, round: 5, team_id: 1, team_name: 'Early', player_name: 'A', gp: 70, mpg: 30, totalZ: 0, valueRank: 100, diff: -50, badge: 'Bust' as const },
      { pick: 120, round: 10, team_id: 2, team_name: 'Late', player_name: 'B', gp: 70, mpg: 30, totalZ: 0, valueRank: 170, diff: -50, badge: 'Bust' as const },
    ]
    const grades = buildTeamGrades(scoredPicks)

    // Same raw -50 diff, but missing an early slot costs more value: the late
    // team's efficiency ratio is higher, so it ranks (and grades) above.
    const early = grades.find(g => g.team_name === 'Early')!
    const late = grades.find(g => g.team_name === 'Late')!
    expect(late.ratio).toBeGreaterThan(early.ratio)
    expect(grades[0].team_name).toBe('Late')
  })

  it('ignores INJ/DNP picks when grading', () => {
    const scoredPicks = [
      { pick: 10, round: 1, team_id: 1, team_name: 'T', player_name: 'Hit', gp: 70, mpg: 30, totalZ: 1, valueRank: 8, diff: 2, badge: 'Fair' as const },
      { pick: 20, round: 2, team_id: 1, team_name: 'T', player_name: 'Injured', gp: 3, mpg: 20, totalZ: 0, valueRank: null, diff: null, badge: 'INJ' as const },
    ]
    const [grade] = buildTeamGrades(scoredPicks)
    // Ratio is driven only by the one judged pick (10 -> #8), not the injury.
    const V = (r: number) => 1 / Math.pow(r + 5, 0.7)
    expect(grade.ratio).toBeCloseTo(V(8) / V(10), 5)
  })
})

describe('topSteals', () => {
  it('excludes steals below the 50 GP floor', () => {
    const scoredPicks = [
      { pick: 1, round: 1, team_id: 1, team_name: 'T', player_name: 'Low GP Steal', gp: 20, mpg: 30, totalZ: 1, valueRank: 1, diff: 50, badge: 'Steal' as const },
      { pick: 2, round: 1, team_id: 1, team_name: 'T', player_name: 'Qualified Steal', gp: 60, mpg: 30, totalZ: 1, valueRank: 2, diff: 40, badge: 'Steal' as const },
    ]
    const steals = topSteals(scoredPicks)

    expect(steals).toHaveLength(1)
    expect(steals[0].player_name).toBe('Qualified Steal')
  })

  it('weights a steal at an earlier pick above the same raw diff late', () => {
    const scoredPicks = [
      { pick: 100, round: 9, team_id: 1, team_name: 'T', player_name: 'Earlier Steal', gp: 60, mpg: 30, totalZ: 1, valueRank: 50, diff: 50, badge: 'Steal' as const },
      { pick: 170, round: 14, team_id: 1, team_name: 'T', player_name: 'Later Steal', gp: 60, mpg: 30, totalZ: 1, valueRank: 120, diff: 50, badge: 'Steal' as const },
    ]
    const steals = topSteals(scoredPicks)

    expect(steals[0].player_name).toBe('Earlier Steal')
  })
})

describe('topBusts', () => {
  it('excludes INJ and DNP entirely — an injury is not a bust', () => {
    const scoredPicks = [
      { pick: 5, round: 1, team_id: 1, team_name: 'T', player_name: 'Never Played', gp: 0, mpg: 0, totalZ: null, valueRank: null, diff: null, badge: 'DNP' as const },
      { pick: 10, round: 1, team_id: 1, team_name: 'T', player_name: 'Injured Early', gp: 3, mpg: 20, totalZ: 0.5, valueRank: null, diff: null, badge: 'INJ' as const },
      { pick: 6, round: 1, team_id: 1, team_name: 'T', player_name: 'Real Bust', gp: 70, mpg: 30, totalZ: -1, valueRank: 60, diff: -54, badge: 'Bust' as const },
    ]
    const busts = topBusts(scoredPicks)

    expect(busts.map(b => b.player_name)).toEqual(['Real Bust'])
  })

  it('weights a bust at an earlier pick worse than the same raw diff late', () => {
    const scoredPicks = [
      { pick: 50, round: 5, team_id: 1, team_name: 'T', player_name: 'Early Miss', gp: 70, mpg: 30, totalZ: -1, valueRank: 100, diff: -50, badge: 'Bust' as const },
      { pick: 120, round: 10, team_id: 1, team_name: 'T', player_name: 'Late Miss', gp: 70, mpg: 30, totalZ: -1, valueRank: 170, diff: -50, badge: 'Bust' as const },
    ]
    const busts = topBusts(scoredPicks)

    expect(busts[0].player_name).toBe('Early Miss')
  })
})
