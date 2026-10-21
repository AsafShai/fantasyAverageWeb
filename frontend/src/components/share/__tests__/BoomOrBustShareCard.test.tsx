import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoomOrBustShareCard } from '../BoomOrBustShareCard'
import { buildShareMessage, shortName, topReason } from '../boomOrBustMessage'
import type { SurpriseRow } from '../../../types/api'

const row = (over: Partial<SurpriseRow>): SurpriseRow => ({
  player_id: 1, player_name: 'Paul George', team_abbr: 'BOS', opponent_abbr: 'DET', is_home: false,
  minutes: 31, pts: 38, reb: 5, ast: 3, fg3m: 7, stl: 5, blk: 0, fgm: 12, fga: 21, ftm: 7, fta: 8,
  score: 2.64, metric_z: 0.7, metric_err: 1.6, has_estimate: true, verdict: 'good',
  reasons: [{ stat: 'STL', value: 5, avg: 1.6, z: 1.8 }, { stat: 'PTS', value: 38, avg: 20.7, z: 1.4 }],
  ...over,
})
const boom = row({})
const bust = row({ player_id: 2, player_name: 'Jayson Tatum', score: -1.91, verdict: 'bad',
  reasons: [{ stat: 'FG_PCT', value: 0.261, avg: 0.47, z: -1.2 }] })

describe('BoomOrBustShareCard', () => {
  it('shows both sections with the line, the driver and the score', () => {
    render(<BoomOrBustShareCard dark={false} dateLabel="Tuesday, Oct 20, 2026" games={3} booms={[boom]} busts={[bust]} thresholds={{ good: 1.8, bad: 1.8 }} />)
    expect(screen.getByText('💥 Boom or Bust')).toBeInTheDocument()
    expect(screen.getByText('Tuesday, Oct 20, 2026 · 3 games')).toBeInTheDocument()
    expect(screen.getByText('Paul George')).toBeInTheDocument()
    expect(screen.getAllByText('BOS @ DET')).toHaveLength(2)
    expect(screen.getByText('+2.6')).toBeInTheDocument()
    expect(screen.getAllByText('57%')).toHaveLength(2)        // 12-21 FG, both rows share the fixture line
    expect(screen.getAllByText('12-21')).toHaveLength(2)
    expect(screen.getAllByText('88%')).toHaveLength(2)        // 7-8 FT
    expect(document.querySelectorAll('img.share-card__avatar')).toHaveLength(2)
    expect(document.querySelector('img.share-card__avatar')?.getAttribute('src')).toContain('/i/headshots/nba/players/full/1.png')
    expect(screen.getByText('Jayson Tatum')).toBeInTheDocument()
    expect(screen.getByText('−1.9')).toBeInTheDocument()
    expect(screen.getByText('score ≥ 1.8')).toBeInTheDocument()
    expect(screen.getByText('score ≤ −1.8')).toBeInTheDocument()
  })

  it('says so when a section is empty', () => {
    render(<BoomOrBustShareCard dark={true} dateLabel="Oct 20, 2026" games={1} booms={[]} busts={[bust]} thresholds={{ good: 1.8, bad: 1.8 }} />)
    expect(screen.getByText('Nobody crossed the bar')).toBeInTheDocument()
    expect(screen.getByText('Oct 20, 2026 · 1 game')).toBeInTheDocument()
  })

  it('shortName keeps short names and initials long ones', () => {
    expect(shortName('Paul George')).toBe('Paul George')
    expect(shortName('Baylor Scheierman')).toBe('B. Scheierman')
    expect(shortName('Ron Harper Jr.')).toBe('Ron Harper Jr.')
    expect(shortName('Giannis Antetokounmpo')).toBe('G. Antetokounmpo')
    expect(shortName('Shai Gilgeous-Alexander')).toBe('Gilgeous-Alexander')
  })

  it('topReason reads the first driver', () => {
    expect(topReason(boom)).toBe('5 STL (avg 1.6)')
    expect(topReason(row({ reasons: [] }))).toBeNull()
  })
})

describe('buildShareMessage', () => {
  it('writes four short WhatsApp-formatted lines with both lists and the link', () => {
    const msg = buildShareMessage('Oct 20, 2026', [boom], [bust], 'https://app.example/boom-or-bust')
    expect(msg.split('\n')).toEqual([
      '💥 *Boom or Bust* · Oct 20, 2026',
      '🚀 Booms: *Paul George* +2.6 (5 STL, 38 PTS)',
      '💩 Busts: *Jayson Tatum* −1.9 (26% FG%)',
      '🔗 https://app.example/boom-or-bust',
    ])
  })

  it('caps the names and marks an empty list', () => {
    const many = Array.from({ length: 7 }, (_, i) => row({ player_id: 10 + i, player_name: `P${i}` }))
    const msg = buildShareMessage('Oct 20, 2026', many, [], 'u')
    expect(msg).toContain('+2 more')
    expect(msg).toContain('💩 Busts: _nobody_')
  })
})
