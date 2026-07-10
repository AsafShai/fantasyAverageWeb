import { screen } from '@testing-library/react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DateRangePicker from '../DateRangePicker'

const SEASON_START = '2025-10-22'
const TODAY = '2026-07-10'

describe('DateRangePicker', () => {
  it('disables Apply until both dates are set', async () => {
    const onApply = vi.fn()
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={onApply} />)

    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/start date/i), '2026-01-05')
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
  })

  it('shows an error when start is before season start', async () => {
    const onApply = vi.fn()
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={onApply} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/start date/i), '2025-10-01')
    await user.type(screen.getByLabelText(/end date/i), '2025-11-01')

    expect(screen.getByText(/cannot be before season start/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows an error when start >= end', async () => {
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={vi.fn()} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/start date/i), '2026-02-10')
    await user.type(screen.getByLabelText(/end date/i), '2026-01-05')

    expect(screen.getByText(/before end date/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
  })

  it('calls onApply with the range once valid', async () => {
    const onApply = vi.fn()
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={onApply} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/start date/i), '2026-01-05')
    await user.type(screen.getByLabelText(/end date/i), '2026-02-10')
    expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledWith({ start: '2026-01-05', end: '2026-02-10' })
  })

  it('Clear resets both fields', async () => {
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={vi.fn()} initialStart="2026-01-05" initialEnd="2026-02-10" />)
    const user = userEvent.setup()

    expect(screen.getByLabelText(/start date/i)).toHaveValue('2026-01-05')
    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(screen.getByLabelText(/start date/i)).toHaveValue('')
    expect(screen.getByLabelText(/end date/i)).toHaveValue('')
  })

  it('shows the season start / today hint text', () => {
    render(<DateRangePicker seasonStart={SEASON_START} today={TODAY} onApply={vi.fn()} />)
    expect(screen.getByText(new RegExp(SEASON_START))).toBeInTheDocument()
    expect(screen.getByText(/both required/i)).toBeInTheDocument()
  })
})
