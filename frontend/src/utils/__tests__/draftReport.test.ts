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
  it('assigns A to the best average diff and F to the worst', () => {
    // Equal pick numbers across teams isolate the letter-binning logic from
    // the position-weighting behavior (covered separately below).
    const scoredPicks = [
      { pick: 100, round: 9, team_id: 1, team_name: 'Best', player_name: 'A', gp: 70, mpg: 30, totalZ: 1, valueRank: 50, diff: 50, badge: 'Steal' as const },
      { pick: 100, round: 9, team_id: 2, team_name: 'Middle', player_name: 'B', gp: 70, mpg: 30, totalZ: 0, valueRank: 100, diff: 0, badge: 'Fair' as const },
      { pick: 100, round: 9, team_id: 3, team_name: 'Worst', player_name: 'C', gp: 70, mpg: 30, totalZ: -1, valueRank: 150, diff: -50, badge: 'Bust' as const },
    ]
    const grades = buildTeamGrades(scoredPicks)

    expect(grades[0].team_name).toBe('Best')
    expect(grades[0].grade).toBe('A')
    expect(grades[2].team_name).toBe('Worst')
    expect(grades[2].grade).toBe('F')
  })

  it('weights an equal raw diff more heavily for an earlier pick than a later one', () => {
    const scoredPicks = [
      { pick: 50, round: 5, team_id: 1, team_name: 'Early', player_name: 'A', gp: 70, mpg: 30, totalZ: 0, valueRank: 100, diff: -50, badge: 'Bust' as const },
      { pick: 120, round: 10, team_id: 2, team_name: 'Late', player_name: 'B', gp: 70, mpg: 30, totalZ: 0, valueRank: 170, diff: -50, badge: 'Bust' as const },
    ]
    const grades = buildTeamGrades(scoredPicks)

    const early = grades.find(g => g.team_name === 'Early')!
    const late = grades.find(g => g.team_name === 'Late')!
    // Same raw avgDiff, but the earlier pick's grade should rank worse.
    expect(early.avgDiff).toBe(late.avgDiff)
    expect(grades[0].team_name).toBe('Late')
    expect(grades[1].team_name).toBe('Early')
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
  it('prioritizes an early INJ pick over a plain Bust', () => {
    const scoredPicks = [
      { pick: 20, round: 2, team_id: 1, team_name: 'T', player_name: 'Mild Bust', gp: 70, mpg: 30, totalZ: -1, valueRank: 30, diff: -10, badge: 'Bust' as const },
      { pick: 10, round: 1, team_id: 1, team_name: 'T', player_name: 'Injured Early', gp: 3, mpg: 20, totalZ: 0.5, valueRank: null, diff: -450, badge: 'INJ' as const },
    ]
    const busts = topBusts(scoredPicks)

    expect(busts[0].player_name).toBe('Injured Early')
  })

  it('excludes DNP entirely', () => {
    const scoredPicks = [
      { pick: 5, round: 1, team_id: 1, team_name: 'T', player_name: 'Never Played', gp: 0, mpg: 0, totalZ: null, valueRank: null, diff: -450, badge: 'DNP' as const },
      { pick: 6, round: 1, team_id: 1, team_name: 'T', player_name: 'Real Bust', gp: 70, mpg: 30, totalZ: -1, valueRank: 60, diff: -54, badge: 'Bust' as const },
    ]
    const busts = topBusts(scoredPicks)

    expect(busts.map(b => b.player_name)).not.toContain('Never Played')
    expect(busts.map(b => b.player_name)).toContain('Real Bust')
  })

  it('excludes an INJ pick made after the top-100-pick ceiling', () => {
    const scoredPicks = [
      { pick: 150, round: 13, team_id: 1, team_name: 'T', player_name: 'Late Flier', gp: 3, mpg: 20, totalZ: 0.5, valueRank: null, diff: -400, badge: 'INJ' as const },
    ]
    const busts = topBusts(scoredPicks)

    expect(busts).toHaveLength(0)
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
