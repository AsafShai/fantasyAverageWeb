import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import TimePeriodSelector from '../TimePeriodSelector'

vi.mock('../../config/featureFlags', () => ({ FF_CUSTOM_RANGE: true }))

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('TimePeriodSelector', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          total_teams: 12,
          total_games_played: 100,
          category_leaders: {},
          league_averages: {},
          last_updated: '2026-07-01',
          season_start: '2025-10-22',
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the 4 preset chips plus a Custom chip when the flag is on', () => {
    renderWithProviders(<TimePeriodSelector value="season" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /full season/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /last 7 days/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /custom/i })).toBeInTheDocument()
  })

  it('does not render the Custom chip when allowCustom is false', () => {
    renderWithProviders(<TimePeriodSelector value="season" onChange={vi.fn()} allowCustom={false} />)
    expect(screen.queryByRole('button', { name: /custom/i })).not.toBeInTheDocument()
  })

  it('clicking a preset chip fires onChange with that period', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<TimePeriodSelector value="season" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /last 15 days/i }))
    expect(onChange).toHaveBeenCalledWith('last_15')
  })

  it('clicking Custom opens the date range panel', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TimePeriodSelector value="season" onChange={vi.fn()} />)
    expect(screen.queryByLabelText(/start date/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /custom/i }))
    await waitFor(() => expect(screen.getByLabelText(/start date/i)).toBeInTheDocument())
  })

  it('applying a valid range calls onChange("custom") and onCustomRangeChange with the range', async () => {
    const onChange = vi.fn()
    const onCustomRangeChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <TimePeriodSelector value="season" onChange={onChange} onCustomRangeChange={onCustomRangeChange} />,
    )

    await user.click(screen.getByRole('button', { name: /custom/i }))
    await waitFor(() => expect(screen.getByLabelText(/start date/i)).toBeInTheDocument())

    await user.type(screen.getByLabelText(/start date/i), '2026-01-05')
    await user.type(screen.getByLabelText(/end date/i), '2026-02-10')
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(onCustomRangeChange).toHaveBeenCalledWith({ start: '2026-01-05', end: '2026-02-10' })
    expect(onChange).toHaveBeenCalledWith('custom')
  })

  it('shows a removable range chip once custom is active, and clearing it restores the previous period', async () => {
    const onChange = vi.fn()
    const onCustomRangeChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <TimePeriodSelector
        value="last_7"
        onChange={onChange}
        customRange={null}
        onCustomRangeChange={onCustomRangeChange}
      />,
    )

    // simulate parent applying a custom range (value becomes 'custom')
    rerender(
      <TimePeriodSelector
        value="custom"
        onChange={onChange}
        customRange={{ start: '2026-01-05', end: '2026-02-10' }}
        onCustomRangeChange={onCustomRangeChange}
      />,
    )

    const clearBtn = await screen.findByRole('button', { name: /clear custom range/i })
    await user.click(clearBtn)

    expect(onCustomRangeChange).toHaveBeenCalledWith(null)
    expect(onChange).toHaveBeenCalledWith('last_7')
  })
})
