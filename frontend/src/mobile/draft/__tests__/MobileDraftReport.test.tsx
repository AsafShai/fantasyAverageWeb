import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import type { ScoredPick, TeamDiff } from '../../../utils/draftReport'
import type { FaReportRow } from '../../../utils/faReport'
import MobileDraftReport from '../MobileDraftReport'
import MobileFaReport from '../MobileFaReport'

vi.mock('../../flag', () => ({ useMobileRedesign: () => true }))

const pick = (p: Partial<ScoredPick> & Pick<ScoredPick, 'pick' | 'round' | 'team_id' | 'team_name' | 'player_name'>): ScoredPick => ({
  gp: 12, mpg: 31.2, totalZ: 4.1, valueRank: 3, diff: 0, badge: 'Fair', ...p,
})

const PICKS = [
  pick({ pick: 1, round: 1, team_id: 1, team_name: 'Oriel', player_name: 'Nikola Jokic', valueRank: 3, diff: -2, gp: 7 }),
  pick({ pick: 2, round: 1, team_id: 2, team_name: 'Roy', player_name: 'Victor Wembanyama', valueRank: 2, diff: 0, gp: 8 }),
  pick({ pick: 3, round: 2, team_id: 2, team_name: 'Roy', player_name: 'Kon Knueppel', valueRank: null, diff: null, gp: 1, badge: 'INJ' }),
  pick({ pick: 4, round: 2, team_id: 1, team_name: 'Oriel', player_name: 'Amen Thompson', valueRank: 119, diff: -115, gp: 9, badge: 'Bust' }),
]

const DIFFS: TeamDiff[] = [
  { team_id: 2, team_name: 'Roy', avgDiff: 0, totalDiff: 0, n: 1, total: 2, unranked: [{ player_name: 'Kon Knueppel', badge: 'INJ', gp: 1, pick: 3 }] },
  { team_id: 1, team_name: 'Oriel', avgDiff: -58.5, totalDiff: -117, n: 2, total: 2, unranked: [] },
]

function renderDraft(over: Partial<Parameters<typeof MobileDraftReport>[0]> = {}) {
  const props = {
    calcMode: 'per_game' as const,
    onCalcModeChange: vi.fn(),
    showHeat: false,
    teamColumns: [{ team_id: 1, team_name: 'Oriel' }, { team_id: 2, team_name: 'Roy' }],
    rounds: [1, 2],
    gridByRoundTeam: new Map(PICKS.map((p) => [`${p.round}-${p.team_id}`, p])),
    teamDiffs: DIFFS,
    steals: [],
    busts: [PICKS[3]],
    picks: PICKS,
    sortCol: 'pick' as const,
    sortAsc: true,
    onSort: vi.fn(),
    teamFilter: null,
    onTeamFilterChange: vi.fn(),
    ...over,
  }
  renderWithProviders(<MobileDraftReport {...props} />)
  return props
}

describe('MobileDraftReport', () => {
  it('shows every section of the desktop page', () => {
    renderDraft()
    expect(screen.getByRole('heading', { level: 1, name: '📝 Draft Report Card' })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Draft Board', 'Team Draft Value — diff vs slot', '📉 Biggest Fallers', 'All Picks'])
    expect(screen.getByText(/Value heat appears after the first 2 months/)).toBeInTheDocument()
  })

  it('board cells show pick → value · gp', () => {
    renderDraft()
    const board = screen.getByRole('table', { name: 'Draft board' })
    expect(within(board).getByText('1 → #3 · 7gp')).toBeInTheDocument()
    expect(within(board).getByText('3 → INJ 1gp')).toBeInTheDocument()
  })

  it('team rows with unranked picks expand on tap', async () => {
    renderDraft()
    const table = screen.getByRole('table', { name: 'Team draft value' })
    expect(within(table).queryByText('Not ranked (excluded from diff):')).toBeNull()
    await userEvent.click(within(table).getByText('Roy'))
    expect(within(table).getByText('Not ranked (excluded from diff):')).toBeInTheDocument()
    expect(within(table).getByText('#3 · 1gp')).toBeInTheDocument()
  })

  it('All Picks keeps every column, sorts and filters by team', async () => {
    const props = renderDraft()
    const table = screen.getByRole('table', { name: 'All picks' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Player', 'Pick ▲', 'Rd', 'Team', 'GP', 'MPG', 'zTotal', 'Value', 'Diff', 'Verdict'])
    await userEvent.click(within(table).getByRole('button', { name: 'Diff' }))
    expect(props.onSort).toHaveBeenCalledWith('diff', true)
    await userEvent.click(screen.getByRole('button', { name: 'Team: All teams' }))
    await userEvent.click(screen.getByRole('option', { name: 'Roy' }))
    expect(props.onTeamFilterChange).toHaveBeenCalledWith(2)
  })

  it('Totals / Per Game switch', async () => {
    const props = renderDraft()
    await userEvent.click(screen.getByRole('radio', { name: 'Totals' }))
    expect(props.onCalcModeChange).toHaveBeenCalledWith('totals')
  })
})

const ROWS: FaReportRow[] = [
  { player_id: 11, player_name: 'Duncan Robinson', pro_team: 'DET', fantasy_status: 'FREEAGENT', gp: 12, totalZ: 2.31, valueRank: 88, lastFaPickup: { at: '2026-10-20T12:00:00Z', kind: 'add', team_id: 7, team_name: "Roy's Rowdy Team" } },
  { player_id: null, player_name: 'DeAndre Jordan', pro_team: 'NOP', fantasy_status: 'FREEAGENT', gp: 10, totalZ: 0.5, valueRank: 190, lastFaPickup: null },
] as FaReportRow[]

describe('MobileFaReport', () => {
  it('shows the same columns, count and search as desktop', async () => {
    const onSearch = vi.fn()
    const onSort = vi.fn()
    renderWithProviders(
      <MobileFaReport calcMode="per_game" onCalcModeChange={vi.fn()} search="" onSearchChange={onSearch} activityError rows={ROWS} sortCol="valueRank" sortAsc onSort={onSort} />,
    )
    expect(screen.getByRole('heading', { level: 1, name: '🆓 FA Report' })).toBeInTheDocument()
    expect(screen.getByText('2 players')).toBeInTheDocument()
    expect(screen.getByText(/FA pickup dates and teams are unavailable/)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Undrafted free agents' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Player', 'NBA', 'Last FA pickup', 'Picked up by', 'GP', 'zTotal', 'Season rank ▲'])
    expect(within(table).getByRole('link', { name: 'Duncan Robinson' })).toHaveAttribute('href', '/?player=11')
    expect(within(table).getByText('(add)')).toBeInTheDocument()
    await userEvent.click(within(table).getByRole('button', { name: 'GP' }))
    expect(onSort).toHaveBeenCalledWith('gp')
    await userEvent.type(screen.getByRole('searchbox'), 'd')
    expect(onSearch).toHaveBeenCalledWith('d')
  })
})
