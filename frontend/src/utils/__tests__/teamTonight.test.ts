import { describe, expect, it } from 'vitest'
import type { LiveBlock, TeamTonight } from '../../types/api'
import { slotTonightNote, startersNote, tonightGp, tonightPoints } from '../live'

const LIVE: LiveBlock = { active: true, period: 24, as_of: null, games_total: 4, games_live: 2, games_final: 1, official_updated_at: null }
const FINAL: LiveBlock = { ...LIVE, games_live: 0, games_final: 4 }
const T: TeamTonight = { gp: 2, points: -3, slots: { SF: 1, F: 1 }, starters_live: 2 }

describe('team page tonight markers', () => {
  it('GP and points added tonight, only while live or final-pending', () => {
    expect(tonightGp(FINAL, T)).toBe('+2 tonight')
    expect(tonightPoints(FINAL, T)).toBe('▼3 tonight')
    expect(tonightPoints(LIVE, { ...T, points: 1.5 })).toBe('▲1.5 tonight')
    expect(tonightGp(LIVE, { ...T, gp: 0 })).toBeNull()
    expect(tonightPoints(LIVE, { ...T, points: 0 })).toBeNull()
    expect(tonightGp(undefined, T)).toBeNull()
    expect(tonightGp({ ...LIVE, active: false }, T)).toBeNull()
    expect(tonightGp(LIVE, undefined)).toBeNull()
  })

  it('slot rows read "+N live" during games and "+N tonight" once final', () => {
    expect(slotTonightNote(LIVE, T, 'SF')).toBe('+1 live')
    expect(slotTonightNote(FINAL, T, 'F')).toBe('+1 tonight')
    expect(slotTonightNote(LIVE, T, 'PG')).toBeNull()
    expect(slotTonightNote(undefined, T, 'SF')).toBeNull()
  })

  it('the starters note shows only while starters are on court', () => {
    expect(startersNote(LIVE, T)).toBe(
      '2 starters are playing now. Averages and ranks below update when their game goes final; tonight’s stats so far are in the roster table.',
    )
    expect(startersNote(LIVE, { ...T, starters_live: 1 })).toMatch(/^1 starter is playing now\. Averages and ranks below update when his game goes final;/)
    expect(startersNote(LIVE, { ...T, starters_live: 0 })).toBeNull()
    expect(startersNote(FINAL, T)).toBeNull()
  })
})
