import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import { MyTeamProvider } from '../../context/MyTeamContext'
import fixture from '../../test/fixtures/leagueActivity2026.json'
import LeagueActivity from '../LeagueActivity'

// The fixture is the backend's own output for the trimmed real 2025-26 data:
// the 2026-03-17 trade between teams 1 and 8 (ASAF and DOR).

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/league/activity')) return Response.json(fixture)
      if (url.includes('/teams/')) {
        return Response.json(fixture.teams.map(t => ({ team_id: t.team_id, team_name: t.name })))
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

function renderPage(route = '/activity') {
  return renderWithProviders(
    <MyTeamProvider>
      <LeagueActivity />
    </MyTeamProvider>,
    { route },
  )
}

describe('League Activity page', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('fw:myTeam.id', '1')
    stubApi()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists every move with counts and highlights my team', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(new RegExp(`^${fixture.moves.length} moves`))).toBeInTheDocument())
    expect(screen.getByText(/1 trades/)).toBeInTheDocument()

    const tradeRow = screen.getByText('ASAF ⇄ DOR').closest('li') as HTMLElement
    await waitFor(() => expect(tradeRow).toHaveAttribute('data-mine', 'true'))
    expect(within(tradeRow).getByText(/got Bam Adebayo, John Collins/)).toBeInTheDocument()
  })

  it('filters the feed by type', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText(new RegExp(`^${fixture.moves.length} moves`))).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Type'), 'trade')
    expect(screen.getAllByRole('listitem').filter(li => li.textContent?.includes('⇄'))).toHaveLength(1)
    expect(screen.queryByText(/^Added$/)).not.toBeInTheDocument()
  })

  it('shows what each side got, with GP, and lets me leave a player out', async () => {
    const user = userEvent.setup()
    renderPage('/activity?tab=trades')
    await waitFor(() => expect(screen.getByText("Asaf's Astounding Team received")).toBeInTheDocument())

    const gpRow = () => screen.getByRole('cell', { name: 'GP' }).closest('tr') as HTMLElement
    const [asafGp, dorGp] = within(gpRow()).getAllByRole('cell').filter((_, i) => i === 1 || i === 3)
    const collins = fixture.trades[0].sides[0].received.find(p => p.name === 'John Collins')!
    const adebayo = fixture.trades[0].sides[0].received.find(p => p.name === 'Bam Adebayo')!
    expect(asafGp).toHaveTextContent(String(collins.games_played + adebayo.games_played))
    expect(dorGp).toHaveTextContent(String(fixture.trades[0].sides[1].received[0].games_played))

    await user.click(screen.getByLabelText('Count', { selector: `#count-${fixture.trades[0].id}-${collins.player_id}` }))
    expect(screen.getByText(/Your view: 1 change from the default/)).toBeInTheDocument()
    expect(within(gpRow()).getAllByRole('cell')[1]).toHaveTextContent(String(adebayo.games_played))
    expect(JSON.parse(localStorage.getItem('fw:activity.tradeOverrides') ?? '{}')).toEqual({
      [`${fixture.trades[0].id}:${collins.player_id}`]: false,
    })

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByText(/Your view:/)).not.toBeInTheDocument()
  })

  it('leaves the open-spot pickup out until I tick it', async () => {
    const user = userEvent.setup()
    renderPage('/activity?tab=trades')
    await waitFor(() => expect(screen.getByText(/Open roster spot:/)).toBeInTheDocument())

    const spot = fixture.trades[0].open_roster_spot!
    const box = screen.getByLabelText('Count', { selector: `#count-${fixture.trades[0].id}-open_spot` })
    expect(box).not.toBeChecked()
    const dorGp = () => within(screen.getByRole('cell', { name: 'GP' }).closest('tr') as HTMLElement).getAllByRole('cell')[3]
    const before = Number(dorGp().textContent)
    await user.click(box)
    expect(Number(dorGp().textContent)).toBe(before + spot.stint.games_played)
  })

  it('switches between totals and per-game and remembers the choice', async () => {
    const user = userEvent.setup()
    renderPage('/activity?tab=trades')
    await waitFor(() => expect(screen.getByText('What each side got')).toBeInTheDocument())

    const ptsCell = () => within(screen.getByRole('cell', { name: 'PTS' }).closest('tr') as HTMLElement).getAllByRole('cell')[3]
    const mobley = fixture.trades[0].sides[1].received[0]
    expect(ptsCell()).toHaveTextContent(String(Math.round(mobley.totals.PTS)))

    await user.click(screen.getAllByRole('button', { name: 'Per Game' })[0])
    expect(ptsCell()).toHaveTextContent((mobley.totals.PTS / mobley.games_played).toFixed(1))
    expect(localStorage.getItem('fw:activity.statMode')).toBe('"per_game"')
  })

  it('opens the trade tree for one side', async () => {
    const user = userEvent.setup()
    renderPage('/activity?tab=trades')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tree for ASAF' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Tree for ASAF' }))
    expect(screen.getByRole('heading', { name: /ASAF ⇄ DOR · Mar 17/ })).toBeInTheDocument()
    expect(screen.getByText('Sent to DOR').nextElementSibling).toHaveTextContent('Evan Mobley')
    expect(screen.getByText('Got from DOR').nextElementSibling).toHaveTextContent('Bam Adebayo, John Collins')
    expect(screen.getByText(/2 players · 18 GP for ASAF/)).toBeInTheDocument()
    expect(screen.getByText('On ASAF at season end')).toBeInTheDocument()
    expect(screen.getByText(/DOR picked him up Mar 30/)).toBeInTheDocument()
  })

  it('lists released players who played elsewhere', async () => {
    renderPage('/activity?tab=released')
    await waitFor(() => expect(screen.getByText('Released players who played elsewhere')).toBeInTheDocument())
    // Each released player is both a phone card and a desktop table row; CSS shows one.
    const links = screen.getAllByRole('link', { name: 'John Collins' })
    const card = links.map(l => l.closest('li')).find(li => li && /Released by ASAF/.test(li.textContent ?? ''))
    expect(card).toHaveTextContent(/Released by ASAF.*picked up by DOR/)
    const row = links.map(l => l.closest('tr')).find(tr => tr && within(tr).queryByText(/^ASAF/)) as HTMLElement
    expect(within(row).getByText(/^DOR/)).toBeInTheDocument()
  })

  it('shows an error when the activity cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Failed to load league activity|down/)).toBeInTheDocument())
  })
})
