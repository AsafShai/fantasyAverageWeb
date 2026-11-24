import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import BoxScorePanel from '../BoxScorePanel'
import RotationCard from '../RotationCard'
import type { GameBoxScore } from '../../../types/boxScore'
import fixture from './fixtures/boxscore-401910007.json'

const game = fixture as unknown as GameBoxScore

function phoneWidth() {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query.includes('767px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('RotationCard', () => {
  it('starts collapsed, opens on click and remembers it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RotationCard game={game} side="away" />)
    const toggle = screen.getByRole('button', { name: /Rotation/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('rotation-row')).toHaveLength(0)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('fw:box-rotation-open')).toBe('1')
    // Everyone who played: 5 starters, 7 from the bench.
    expect(screen.getAllByTestId('rotation-row')).toHaveLength(12)
    expect(screen.getByText('Starters')).toBeInTheDocument()
    expect(screen.getByText('Bench')).toBeInTheDocument()
    await user.click(toggle)
    expect(localStorage.getItem('fw:box-rotation-open')).toBeNull()
  })

  it('shows one pick\'s stints, then the time two picks shared', async () => {
    localStorage.setItem('fw:box-rotation-open', '1')
    const user = userEvent.setup()
    renderWithProviders(<RotationCard game={game} side="away" />)
    const spencer = screen.getByRole('button', { name: 'Compare Cam Spencer' })
    await user.click(spencer)
    expect(screen.getByRole('button', { name: 'Remove Cam Spencer' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Cam Spencer on the floor')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Stints' })).getAllByRole('row')).toHaveLength(7)

    await user.click(screen.getByRole('button', { name: 'Compare Jaylen Wells' }))
    const together = screen.getByTestId('rotation-together')
    expect(together).toHaveTextContent('Spencer + Wells')
    const stretches = screen.getByRole('table', { name: 'Stretches on the floor together' })
    expect(within(stretches).getAllByRole('row').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Remove Jaylen Wells from the comparison' })).toBeInTheDocument()
    expect(screen.getAllByText(/of it together/)).toHaveLength(2)

    // Hovering a bar fills the detail strip, with the shared part for a pick.
    await user.hover(screen.getAllByRole('button', { name: /^Jaylen Wells, stint 1 of 3/ })[0])
    expect(screen.getByText('Stint 1 of 3')).toBeInTheDocument()
    expect(screen.getByText(/of it with all picked players/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByTestId('rotation-together')).not.toBeInTheDocument()
  })

  it('is not rendered for a box without player ids on its plays', () => {
    const old = { ...game, plays: game.plays!.map(play => ({ ...play, athlete_ids: undefined })) }
    renderWithProviders(<RotationCard game={old} side="home" />)
    expect(screen.queryByTestId('rotation-card')).not.toBeInTheDocument()
  })

  it('stays hidden while No spoilers hides the game', () => {
    const { unmount } = renderWithProviders(<BoxScorePanel game={game} hideScores onToggleReveal={() => {}} />)
    expect(screen.queryByTestId('rotation-card')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<BoxScorePanel game={game} hideScores={false} />)
    expect(screen.getByTestId('rotation-card')).toBeInTheDocument()
  })

  it('stacks rows and zooms one quarter on a phone', async () => {
    phoneWidth()
    localStorage.setItem('fw:box-rotation-open', '1')
    const user = userEvent.setup()
    renderWithProviders(<RotationCard game={game} side="home" />)
    const zoom = screen.getByRole('group', { name: 'Zoom the timeline' })
    expect(within(zoom).getAllByRole('button').map(b => b.textContent)).toEqual(['Game', 'Q1', 'Q2', 'Q3', 'Q4'])
    const allen = screen.getByRole('button', { name: /^Compare Jarrett Allen/ })
    expect(allen).toHaveTextContent('30min')
    await user.click(allen)
    await user.click(screen.getByRole('button', { name: /^Compare Donovan Mitchell/ }))
    expect(screen.getByTestId('rotation-summary')).toHaveTextContent('Together · Allen + Mitchell')
    await user.click(within(zoom).getByRole('button', { name: 'Q2' }))
    expect(within(zoom).getByRole('button', { name: 'Q2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('rotation-together')).toHaveTextContent(/in Q2/)
    // Minutes become time in that quarter: Allen 4:46 + 3:32.
    expect(screen.getByRole('button', { name: /Remove Jarrett Allen/ })).toHaveTextContent('8:18')
    const details = screen.getByRole('button', { name: 'Details' })
    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('table', { name: 'Stretches on the floor together' })).toBeInTheDocument()
  })

  it('marks a live game: open stints, now line, future quarters disabled', () => {
    phoneWidth()
    localStorage.setItem('fw:box-rotation-open', '1')
    // Cut the game at Q3 4:12-ish: keep plays through the first row at or after it.
    const plays = game.plays!
    const cut = plays.findIndex(play => play.period === 3 && play.clock.startsWith('4:'))
    const sofar = plays.slice(0, cut + 1)
    const onCourt = new Set(['3908809', '4066328'])
    const mark = (lines: typeof game.away.starters) => lines.map(line => ({ ...line, on_court: onCourt.has(line.player_id) }))
    const live: GameBoxScore = { ...game, status: 'live', plays: sofar, home: { ...game.home, starters: mark(game.home.starters), bench: mark(game.home.bench) } }
    renderWithProviders(<RotationCard game={live} side="home" />)
    const zoom = screen.getByRole('group', { name: 'Zoom the timeline' })
    expect(within(zoom).getByRole('button', { name: 'Q3' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(zoom).getByRole('button', { name: 'Q4' })).toBeDisabled()
    expect(screen.getAllByTestId('rotation-now').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('rotation-future').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Compare Donovan Mitchell, on the court/ })).toBeInTheDocument()
  })
})
