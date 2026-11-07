import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ActiveFilterChips, DataTable, FilterGroup, FilterSearchRow, FiltersSheet, PositionFilter, type Column } from '..'
import { stringParam, useUrlState } from '../../../hooks/useUrlState'

describe('FilterSearchRow', () => {
  it('types into the search and shows the active count only when filters are on', async () => {
    const onSearch = vi.fn()
    const onOpen = vi.fn()
    const { rerender } = render(<FilterSearchRow search="" onSearchChange={onSearch} activeCount={0} onOpenFilters={onOpen} />)
    const button = screen.getByRole('button', { name: 'Filters' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search players' }), 'l')
    expect(onSearch).toHaveBeenCalledWith('l')
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)

    rerender(<FilterSearchRow search="" onSearchChange={onSearch} activeCount={3} onOpenFilters={onOpen} />)
    expect(screen.getByRole('button', { name: 'Filters (3 active)' })).toBeInTheDocument()
  })
})

describe('ActiveFilterChips', () => {
  it('shows the idle defaults when nothing is active; they open the sheet', async () => {
    const onOpen = vi.fn()
    render(<ActiveFilterChips active={[]} idle={['All Teams', 'All positions']} onOpen={onOpen} />)
    const row = screen.getByRole('group', { name: 'Active filters' })
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['All Teams', 'All positions'])
    await userEvent.click(within(row).getByRole('button', { name: 'All Teams' }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('active chips clear their own filter', async () => {
    const remove = vi.fn()
    render(<ActiveFilterChips active={[{ key: 'pos', label: 'PG, SG', onRemove: remove }]} idle={['All Teams']} onOpen={vi.fn()} />)
    expect(screen.queryByText('All Teams')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter PG, SG' }))
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('PositionFilter', () => {
  it('toggles several positions on and off', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<PositionFilter options={['PG', 'SG', 'C']} selected={[]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'PG' }))
    expect(onChange).toHaveBeenLastCalledWith(['PG'])
    rerender(<PositionFilter options={['PG', 'SG', 'C']} selected={['PG']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'C' }))
    expect(onChange).toHaveBeenLastCalledWith(['PG', 'C'])
    await userEvent.click(screen.getByRole('button', { name: 'PG' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})

describe('FiltersSheet', () => {
  it('has Reset in the heading and Show results closes it', async () => {
    const onClose = vi.fn()
    const onReset = vi.fn()
    render(
      <FiltersSheet open onClose={onClose} onReset={onReset}>
        <FilterGroup label="Position" hint="none = all">
          <span>chips</span>
        </FilterGroup>
      </FiltersSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(dialog).getByRole('group', { name: 'Position' })).toHaveTextContent('Position · none = all')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('DataTable renderAfterRow', () => {
  it('renders extra content right after its row', () => {
    type R = { id: number; name: string }
    const cols: Column<R>[] = [{ key: 'name', header: 'Name', pinned: true, cell: (r) => r.name }]
    render(
      <DataTable
        caption="Players"
        columns={cols}
        rows={[{ id: 1, name: 'A' }, { id: 2, name: 'B' }]}
        rowKey={(r) => String(r.id)}
        renderAfterRow={(r) => (r.id === 1 ? <tr><td>details A</td></tr> : null)}
      />,
    )
    const rows = within(screen.getByRole('table', { name: 'Players' })).getAllByRole('row')
    expect(rows.map((r) => r.textContent)).toEqual(['Name', 'A', 'details A', 'B'])
  })
})

describe('useUrlState', () => {
  it('keeps the history entry state (an open sheet) when it rewrites the query', async () => {
    const schema = { q: stringParam() }
    function Harness() {
      const [values, set] = useUrlState(schema)
      const location = useLocation()
      return (
        <>
          <button type="button" onClick={() => set({ q: 'luka' })}>set</button>
          <output data-testid="out">{`${values.q}|${JSON.stringify(location.state)}`}</output>
        </>
      )
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/players', state: { mrSheet: 'filters' } }]}>
        <Harness />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'set' }))
    expect(screen.getByTestId('out')).toHaveTextContent('luka|{"mrSheet":"filters"}')
  })
})
