import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SlotUsageTable from '../SlotUsageTable'

describe('SlotUsageTable', () => {
  it('renders a row for each lineup slot', () => {
    const slotUsage = {
      PG: { games_used: 10, cap: 82, remaining: 72 },
    }
    render(
      <SlotUsageTable
        slotUsage={slotUsage}
        avgPace={100}
        gameDaysLeft={50}
        gameDaysElapsed={30}
      />,
    )
    expect(screen.getByRole('heading', { name: /slot usage/i })).toBeInTheDocument()
    expect(screen.getByText('PG')).toBeInTheDocument()
    expect(screen.getByText('SG')).toBeInTheDocument()
  })
})
