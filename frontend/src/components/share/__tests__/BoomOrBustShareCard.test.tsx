import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { BoomOrBustShareCard } from '../BoomOrBustShareCard'
import { buildShareMessage } from '../boomOrBustMessage'
import type { SurpriseRow } from '../../../types/api'

const row = (over: Partial<SurpriseRow>): SurpriseRow => ({
  game_date: '2026-10-20', player_id: 1, player_name: 'Paul George', team_abbr: 'BOS', opponent_abbr: 'DET', is_home: false,
  minutes: 31, pts: 38, reb: 5, ast: 3, fg3m: 7, stl: 5, blk: 0, fgm: 12, fga: 21, ftm: 7, fta: 8,
  score: 2.64, metric_z: 0.7, metric_err: 1.6, has_estimate: true, verdict: 'good', fantasy_team: 'DOR', fantasy_team_name: "Dor's Injured Team", lineup_slot: 'SF', started: true,
  reasons: [{ stat: 'STL', value: 5, avg: 1.6, z: 1.8 }, { stat: 'PTS', value: 38, avg: 20.7, z: 1.4 }],
  ...over,
})
const boom = row({})
const bust = row({ player_id: 2, player_name: 'Jayson Tatum', score: -1.91, verdict: 'bad',
  reasons: [{ stat: 'FG_PCT', value: 0.261, avg: 0.47, z: -1.4 }] })

describe('BoomOrBustShareCard', () => {
  it('renders the page tables in one image: names, marks, shooting, score', () => {
    render(<MemoryRouter><BoomOrBustShareCard dark={false} kicker="last night" subtitle="Tuesday, Oct 20, 2026 · 3 games" booms={[boom]} busts={[bust]} rules={{ good: 'boom score ≥ 1.8', bad: 'bust score ≤ −1.8' }} /></MemoryRouter>)
    expect(screen.getByText('💥 Boom or Bust')).toBeInTheDocument()
    expect(screen.getByText('Tuesday, Oct 20, 2026 · 3 games')).toBeInTheDocument()
    expect(screen.getByText('Paul George')).toBeInTheDocument()
    expect(screen.getByText('Jayson Tatum')).toBeInTheDocument()
    expect(screen.getAllByText('@ DET')).toHaveLength(2)
    expect(screen.getAllByText(/^57%/).length).toBeGreaterThan(0)   // 12-21 FG
    expect(screen.getByText('+2.6')).toBeInTheDocument()
    expect(screen.getByText('−1.9')).toBeInTheDocument()
    expect(screen.getByText('boom score ≥ 1.8')).toBeInTheDocument()
    expect(screen.getByText('bust score ≤ −1.8')).toBeInTheDocument()
    // the marks: STL (z 1.8, strong) and PTS (z 1.4, clear) green on the boom; FG (z -1.2, extreme on the bad scale) red on the bust
    const stl = screen.getAllByText('5').find((el) => el.className.includes('bg-emerald-100'))
    expect(stl).toBeTruthy()
    expect(screen.getAllByText('38').some((el) => el.className.includes('bg-emerald-50'))).toBe(true)
    expect(screen.getAllByText(/^57%/).some((el) => el.className.includes('bg-rose-700'))).toBe(true)   // the bust row's FG mark, solid
  })

  it('shows the top five of a table and says how many there were', () => {
    const many = Array.from({ length: 8 }, (_, i) => row({ player_id: 10 + i, player_name: `Boom ${i}`, score: 2.6 - i * 0.1 }))
    render(<MemoryRouter><BoomOrBustShareCard dark={false} kicker="last night" subtitle="Oct 20, 2026 · 3 games" booms={many} busts={[bust]} rules={{ good: 'boom score ≥ 1.8', bad: 'bust score ≤ −1.8' }} /></MemoryRouter>)
    expect(screen.getByText('(top 5 of 8)')).toBeInTheDocument()
    expect(screen.getByText('Boom 4')).toBeInTheDocument()
    expect(screen.queryByText('Boom 5')).not.toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
    // no scroll box in the image: a scrollbar would be painted into the PNG
    expect(document.querySelector('.overflow-x-auto')).toBeNull()
  })

  it('carries each row\'s night for a period, with the period\'s header and rules', () => {
    const later = row({ player_id: 3, player_name: 'Late Boom', game_date: '2026-10-21', score: 2.2 })
    render(<MemoryRouter><BoomOrBustShareCard dark={false} kicker="last 7 days" subtitle="Oct 15 – Oct 21, 2026 · 7 nights · 80 games" booms={[boom, later]} busts={[bust]} rules={{ good: 'top 5% · score ≥ 1.4', bad: 'bottom 5% · score ≤ −1.2' }} showDate /></MemoryRouter>)
    expect(screen.getByText('last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Oct 15 – Oct 21, 2026 · 7 nights · 80 games')).toBeInTheDocument()
    expect(screen.getByText('top 5% · score ≥ 1.4')).toBeInTheDocument()
    expect(screen.getAllByText('Date')).toHaveLength(2)
    expect(screen.getAllByText('Oct 20').length).toBeGreaterThan(0)
    expect(screen.getByText('Oct 21')).toBeInTheDocument()
  })

  it('shows the fantasy team\'s full name, capped so a long one cannot widen the column', () => {
    const long = row({ player_id: 5, player_name: 'Long Team Guy', fantasy_team: 'AMI', fantasy_team_name: "Amihai's Awesome Team 🏆" })
    const coded = row({ player_id: 6, player_name: 'Code Only', fantasy_team: 'NEW', fantasy_team_name: null })
    render(<MemoryRouter><BoomOrBustShareCard dark={false} kicker="last night" subtitle="Oct 20, 2026 · 3 games" booms={[boom, long, coded]} busts={[]} rules={{ good: 'boom score ≥ 1.8', bad: 'bust score ≤ −1.8' }} /></MemoryRouter>)
    expect(screen.getByText("Dor's Injured Team")).toBeInTheDocument()
    const name = screen.getByText("Amihai's Awesome Team 🏆")
    expect(name.closest('[title]')).toHaveAttribute('title', "Amihai's Awesome Team 🏆 · started")
    expect(name.className).toContain('truncate')
    expect(name.className).toContain('sm:max-w-[8.5rem]')   // tighter on a phone, 8.5rem from sm up
    expect(screen.getByText('NEW')).toBeInTheDocument()   // no name known: the code
  })

  it('says so when a section is empty', () => {
    render(<MemoryRouter><BoomOrBustShareCard dark={true} kicker="last night" subtitle="Oct 20, 2026 · 1 game" booms={[]} busts={[bust]} rules={{ good: 'boom score ≥ 1.8', bad: 'bust score ≤ −1.8' }} /></MemoryRouter>)
    expect(screen.getByText('Nobody crossed the bar tonight.')).toBeInTheDocument()
    expect(screen.getByText('Oct 20, 2026 · 1 game')).toBeInTheDocument()
  })
})

describe('buildShareMessage', () => {
  it('writes four short WhatsApp-formatted lines with both lists and the link', () => {
    const msg = buildShareMessage('Oct 20, 2026', [boom], [bust], 'https://app.example/boom-or-bust')
    expect(msg.split('\n')).toEqual([
      '💥 *Boom or Bust* · Oct 20, 2026',
      '🚀 Booms: *Paul George* +2.6 (5 STL, 38 PTS) · Dor\'s Injured Team',
      '💩 Busts: *Jayson Tatum* −1.9 (26% FG%) · Dor\'s Injured Team',
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
