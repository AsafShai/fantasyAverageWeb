import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Chip, ChipSelect, Delta, MinutesStepper, MoveKindPill, Segmented, SlotPill, StatusPill } from '..'

describe('Segmented', () => {
  function Harness() {
    const [v, setV] = useState<'pg' | 'tot'>('pg')
    return <Segmented label="Values" options={[{ value: 'pg', label: 'Per Game' }, { value: 'tot', label: 'Totals' }]} value={v} onChange={setV} />
  }

  it('marks the selected option and switches on click', async () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Values' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Per Game' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Totals' }))
    expect(screen.getByRole('radio', { name: 'Totals' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Per Game' })).toHaveAttribute('aria-checked', 'false')
  })

  it('moves with arrow keys like native radios', async () => {
    render(<Harness />)
    screen.getByRole('radio', { name: 'Per Game' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Totals' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Totals' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Per Game' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Chips', () => {
  it('ChipSelect picks one period', async () => {
    const onChange = vi.fn()
    render(<ChipSelect label="Period" value="season" onChange={onChange} options={[{ value: 'season', label: 'Season' }, { value: '30', label: 'Last 30' }]} />)
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Season' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Last 30' }))
    expect(onChange).toHaveBeenCalledWith('30')
  })

  it('removable chip shows a ×', () => {
    render(<Chip selected removable>Out</Chip>)
    expect(screen.getByRole('button', { name: /Out/ })).toHaveTextContent('Out×')
  })
})

describe('Pills', () => {
  it('maps injury statuses to their colors, case-insensitively', () => {
    const { container } = render(
      <>
        <StatusPill status="Out" />
        <StatusPill status="DOUBTFUL" />
        <StatusPill status="questionable" />
        <StatusPill status="Probable" />
        <StatusPill status="Available" />
        <StatusPill status="Day-To-Day" />
        <StatusPill status="Something new" />
      </>,
    )
    const pills = [...container.querySelectorAll('.mr-pill')]
    expect(pills.map((p) => p.className.split(' ').pop())).toEqual([
      'mr-pill-out', 'mr-pill-doubt', 'mr-pill-quest', 'mr-pill-prob', 'mr-pill-avail', 'mr-pill-quest', 'mr-pill-bench',
    ])
    expect(pills.map((p) => p.textContent)).toEqual(['Out', 'Doubtful', 'Questionable', 'Probable', 'Available', 'Day-to-day', 'Something new'])
  })

  it('slot pills: starters green, BE as Bench grey, IR orange', () => {
    render(<><SlotPill slot="PG" /><SlotPill slot="BE" /><SlotPill slot="IR" /></>)
    expect(screen.getByText('PG')).toHaveClass('mr-pill-starter')
    expect(screen.getByText('Bench')).toHaveClass('mr-pill-bench')
    expect(screen.getByText('IR')).toHaveClass('mr-pill-ir')
  })

  it('move kinds', () => {
    render(<><MoveKindPill kind="added" /><MoveKindPill kind="waiver" /><MoveKindPill kind="trade" /><MoveKindPill kind="dropped" /></>)
    expect(screen.getByText('Added')).toHaveClass('mr-pill-added')
    expect(screen.getByText('Waiver claim')).toHaveClass('mr-pill-waiver')
    expect(screen.getByText('Trade')).toHaveClass('mr-pill-trade')
    expect(screen.getByText('Dropped')).toHaveClass('mr-pill-dropped')
  })
})

describe('Delta', () => {
  it('rank: ▲ green up, ▼ red down, nothing for 0', () => {
    const { container, rerender } = render(<Delta value={3} />)
    expect(container.textContent).toBe('▲3')
    expect(container.firstChild).toHaveClass('mr-delta-up')
    rerender(<Delta value={-6} />)
    expect(container.textContent).toBe('▼6')
    expect(container.firstChild).toHaveClass('mr-delta-down')
    rerender(<Delta value={0} />)
    expect(container.textContent).toBe('')
  })

  it('total: grey – for no change; gp: grey +n', () => {
    const { container, rerender } = render(<Delta value={0} kind="total" />)
    expect(container.textContent).toBe('–')
    expect(container.firstChild).toHaveClass('mr-delta-same')
    rerender(<Delta value={2} kind="gp" />)
    expect(container.textContent).toBe('+2')
    expect(container.firstChild).toHaveClass('mr-delta-gp')
  })

  it('renders nothing for missing values', () => {
    const { container } = render(<Delta value={null} kind="total" />)
    expect(container.textContent).toBe('')
  })
})

describe('MinutesStepper', () => {
  function Harness({ start = 31, onChange = () => {} }: { start?: number; onChange?: (n: number) => void }) {
    const [m, setM] = useState(start)
    return <MinutesStepper value={m} defaultValue={31} max={48} playerName="Donovan Mitchell" onChange={(n) => { setM(n); onChange(n) }} />
  }

  it('steps by one minute and resets to the model minutes', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const reset = screen.getByRole('button', { name: 'Reset to default minutes for Donovan Mitchell' })
    expect(reset).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'More minutes for Donovan Mitchell' }))
    await userEvent.click(screen.getByRole('button', { name: 'More minutes for Donovan Mitchell' }))
    expect(screen.getByRole('status')).toHaveTextContent('33 min')
    await userEvent.click(screen.getByRole('button', { name: 'Fewer minutes for Donovan Mitchell' }))
    expect(screen.getByRole('status')).toHaveTextContent('32 min')
    expect(reset).toBeEnabled()
    await userEvent.click(reset)
    expect(screen.getByRole('status')).toHaveTextContent('31 min')
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([32, 33, 32, 31])
  })

  it('stops at the bounds', () => {
    render(<Harness start={48} />)
    expect(screen.getByRole('button', { name: /More minutes/ })).toBeDisabled()
  })
})
