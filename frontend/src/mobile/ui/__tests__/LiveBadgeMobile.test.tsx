import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveBadgeMobile } from '../LiveBadgeMobile'
import { renderWithProviders } from '../../../test/helpers'
import type { LiveBlock } from '../../../types/api'

const live: LiveBlock = { active: true, period: 24, as_of: '2026-11-13T01:42:00Z', games_total: 4, games_live: 2, games_final: 1, official_updated_at: '2026-11-12T08:15:00Z' }
const side = (a: string) => ({ team_id: a, name: a, short_name: a, abbreviation: a, logo: '', color: '', record: '', score: null, winner: false })

describe('LiveBadgeMobile', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('falls back to the ESPN updated note without a live block', () => {
    renderWithProviders(<LiveBadgeMobile live={undefined} espnUpdatedAt="2026-11-13T08:03:07Z" />)
    expect(screen.getByText(/ESPN updated/)).toBeInTheDocument()
  })

  it('reads "LIVE · 2 of 4" and "FINAL · 4 of 4"', () => {
    const { unmount } = renderWithProviders(<LiveBadgeMobile live={live} />)
    expect(screen.getByRole('button', { name: /LIVE/ })).toHaveTextContent('LIVE · 2 of 4')
    unmount()
    renderWithProviders(<LiveBadgeMobile live={{ ...live, games_live: 0, games_final: 4 }} />)
    expect(screen.getByRole('button', { name: /FINAL/ })).toHaveTextContent('FINAL · 4 of 4')
  })

  it('opens a sheet with the note and tonight\'s games on tap', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const body = (input as Request).url.includes('current-slate-date')
        ? '"2026-11-12"'
        : JSON.stringify({ date: '2026-11-12', games: [{ game_id: '1', status: 'final', status_detail: 'Final', start_time: '2026-11-13T00:00:00Z', broadcast: '', venue: '', away: side('TOR'), home: side('PHI') }] })
      return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    })
    renderWithProviders(<LiveBadgeMobile live={live} note="Averages count finished games only. 2 games still in progress." />)
    await userEvent.click(screen.getByRole('button', { name: /LIVE/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Averages count finished games only. 2 games still in progress.')).toBeInTheDocument()
    expect(await screen.findByText('TOR @ PHI')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /TOR @ PHI/ })).toHaveAttribute('href', '/box-scores?date=2026-11-12&game=1')
    expect(screen.getByText(/ESPN official: /)).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Spoiler visibility' })).toBeInTheDocument()
  })
})
