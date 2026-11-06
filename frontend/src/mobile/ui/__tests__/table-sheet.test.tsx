import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet, DataTable, SelectSheet, useSheetHistory, type Column, type SortState } from '..'

interface Row { id: number; name: string; pts: number }
const ROWS: Row[] = [
  { id: 1, name: "Khachapuri's Team", pts: 65 },
  { id: 11, name: 'Trust the process', pts: 51 },
  { id: 5, name: 'Chat GPT', pts: 36 },
]
const COLS: Column<Row>[] = [
  { key: 'name', header: 'Team', pinned: true, cell: (r) => r.name },
  { key: 'pts', header: 'TOTAL', sortable: true, cell: (r) => r.pts },
]

describe('DataTable', () => {
  it('pins the first column as row headers and highlights my team', () => {
    render(<DataTable caption="Standings" columns={COLS} rows={ROWS} rowKey={(r) => String(r.id)} isHighlighted={(r) => r.id === 11} />)
    const table = screen.getByRole('table', { name: 'Standings' })
    const rowHeaders = within(table).getAllByRole('rowheader')
    expect(rowHeaders.map((h) => h.textContent)).toEqual(ROWS.map((r) => r.name))
    expect(rowHeaders[0]).toHaveClass('mr-pin')
    expect(rowHeaders[1].closest('tr')).toHaveClass('mr-me')
    expect(rowHeaders[0].closest('tr')).not.toHaveClass('mr-me')
  })

  it('sortable headers: first tap high→low, second tap flips; aria-sort follows', async () => {
    function Harness() {
      const [sort, setSort] = useState<SortState | null>(null)
      const rows = sort ? [...ROWS].sort((a, b) => (sort.dir === 'asc' ? a.pts - b.pts : b.pts - a.pts)) : ROWS
      return <DataTable caption="Standings" columns={COLS} rows={rows} rowKey={(r) => String(r.id)} sort={sort} onSortChange={setSort} />
    }
    render(<Harness />)
    const header = screen.getByRole('columnheader', { name: /TOTAL/ })
    expect(header).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Chat GPT', 'Trust the process', "Khachapuri's Team"])
  })

  it('shows the empty message', () => {
    render(<DataTable caption="Empty" columns={COLS} rows={[]} rowKey={(r) => String(r.id)} empty="No teams" />)
    expect(screen.getByText('No teams')).toBeInTheDocument()
  })

  it('row click', async () => {
    const onRowClick = vi.fn()
    render(<DataTable caption="S" columns={COLS} rows={ROWS} rowKey={(r) => String(r.id)} onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('Chat GPT'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2])
  })
})

describe('BottomSheet', () => {
  it('renders a labelled dialog, closes on scrim tap and Escape, locks scroll', async () => {
    const onClose = vi.fn()
    render(<BottomSheet open title="Filters" onClose={onClose}><p>body</p></BottomSheet>)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'Close Filters' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders nothing when closed and restores scroll', () => {
    const { rerender } = render(<BottomSheet open title="Filters" onClose={() => {}}>x</BottomSheet>)
    rerender(<BottomSheet open={false} title="Filters" onClose={() => {}}>x</BottomSheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('useSheetHistory (browser back closes the sheet first)', () => {
  function Page() {
    const sheet = useSheetHistory('filters')
    const location = useLocation()
    const navigate = useNavigate()
    return (
      <>
        <span data-testid="path">{location.pathname}</span>
        <button type="button" onClick={sheet.show}>Open</button>
        <button type="button" onClick={() => navigate(-1)}>Browser back</button>
        <BottomSheet open={sheet.open} onClose={sheet.hide} title="Filters">
          <button type="button" onClick={sheet.hide}>Show results</button>
        </BottomSheet>
      </>
    )
  }
  const app = () =>
    render(
      <MemoryRouter initialEntries={['/', '/players']} initialIndex={1}>
        <Routes>
          <Route path="*" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    )

  it('back closes the sheet and stays on the page; a second back leaves', async () => {
    app()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Browser back', hidden: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('path')).toHaveTextContent('/players')
    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/')
  })

  it('closing from the sheet pops its history entry', async () => {
    app()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('path')).toHaveTextContent('/players')
  })
})

describe('SelectSheet', () => {
  it('opens a list sheet, picks an option and closes', async () => {
    function Harness() {
      const [v, setV] = useState('all')
      return <SelectSheet label="Fantasy team" value={v} onChange={setV} options={[{ value: 'all', label: 'All teams' }, { value: '11', label: 'Trust the process' }]} />
    }
    render(<MemoryRouter><Harness /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Fantasy team: All teams' }))
    const list = screen.getByRole('listbox', { name: 'Fantasy team' })
    expect(within(list).getByRole('option', { name: 'All teams' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(list).getByRole('option', { name: 'Trust the process' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Fantasy team: Trust the process' })).toBeInTheDocument()
  })
})
