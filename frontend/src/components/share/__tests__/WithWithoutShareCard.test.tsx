import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WithWithoutShareCard } from '../WithWithoutShareCard'
import { buildWithWithoutMessage, withoutModeLabel } from '../withWithoutMessage'
import type { TeammateRow } from '../../../utils/withWithout'

const row: TeammateRow = {
  player: {
    player_id: 1, name: 'Keyonte George', pos: 'G', two_way: false, approx: false,
    out_today: null, owner: null, lines: [],
  },
  withGroup: { games: 8, totals: {} },
  withoutGroup: { games: 6, totals: {} },
  withVals: { PTS: 18.2, 'FG%': 0.45, TO: 2.1 },
  withoutVals: { PTS: 24.5, 'FG%': 0.48, TO: 3.4 },
  deltas: { PTS: 6.3, 'FG%': 0.03, TO: 1.3 },
  zWith: 0.12,
  zWithout: 0.84,
  zDelta: 0.72,
  small: false,
}

describe('WithWithoutShareCard', () => {
  it('shows his line with them, without them, and the change', () => {
    render(
      <WithWithoutShareCard
        dark={false}
        row={row}
        columns={['PTS', 'FG%', 'TO']}
        reverse={new Set(['TO'])}
        names="Markkanen & Hayes"
        modeLabel="both sat"
        teamAbbr="UTA"
      />,
    )
    expect(screen.getByText('Keyonte George')).toBeInTheDocument()
    expect(screen.getByText('FA')).toBeInTheDocument()
    expect(document.querySelector('.share-card__avatar')).toHaveAttribute('src', expect.stringContaining('/1.png'))
    expect(screen.getByText('UTA · without Markkanen & Hayes · both sat')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'With 8' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Without 6' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Change' })).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('18.2')).toBeInTheDocument()
    expect(screen.getByText('24.5')).toBeInTheDocument()
    expect(screen.getByText('+6.3')).toBeInTheDocument()
    expect(screen.getByText('+0.72')).toBeInTheDocument()
    expect(screen.getByText('Compares the games. It doesn’t prove one player caused the change.')).toBeInTheDocument()
    expect(screen.getByText('+1.3').className).toContain('sc-bad')
    expect(screen.getByText('+6.3').className).toContain('sc-good')
  })

  it('names the sitting rule only when more than one player is out', () => {
    expect(withoutModeLabel(1, 'all')).toBeNull()
    expect(withoutModeLabel(2, 'all')).toBe('both sat')
    expect(withoutModeLabel(2, 'any')).toBe('either sat')
    expect(withoutModeLabel(3, 'all')).toBe('all sat')
    expect(withoutModeLabel(3, 'any')).toBe('any sat')
  })

  it('writes a short caption with the link', () => {
    expect(buildWithWithoutMessage('Keyonte George', 'Markkanen & Hayes', 'both sat', 0.72, 8, 6, 'https://league.example/with-without')).toBe(
      [
        '*Keyonte George* without Markkanen & Hayes (both sat)',
        'Z change +0.72 · 8 with / 6 without',
        '🔗 https://league.example/with-without',
      ].join('\n'),
    )
  })
})
