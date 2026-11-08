import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ManagerHintsCard from '../ManagerHintsCard'

vi.mock('../../../hooks/useTeamHints', () => ({
  useTeamHints: () => ({
    isLoading: false,
    visible: [
      {
        id: 'test-1',
        category: 'lineup',
        severity: 'opportunity',
        priority: 90,
        title: 'Consider starting a hot bench player',
        body: 'Player A is #40 (L15) on your bench — consider starting them.',
        players: [
          {
            playerId: 99,
            name: 'Player A',
            lineupSlot: 'BE',
            ranks: { last15: { rank: 40 } },
          },
        ],
      },
    ],
    hidden: [],
    hiddenCount: 0,
    dismiss: vi.fn(),
    teamName: 'Alpha',
    expandAll: [],
  }),
}))

describe('ManagerHintsCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders hints for a team', () => {
    render(
      <MemoryRouter>
        <ManagerHintsCard teamId={1} teamName="Alpha" />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Manager hints/)).toBeInTheDocument()
    expect(screen.getByText(/Consider starting a hot bench player/)).toBeInTheDocument()
    expect(screen.getByText('Player A')).toBeInTheDocument()
    expect(screen.getByText('#40')).toBeInTheDocument()
  })
})
