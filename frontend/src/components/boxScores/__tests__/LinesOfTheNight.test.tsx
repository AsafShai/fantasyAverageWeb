import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import LinesOfTheNight from '../LinesOfTheNight'
import type { SlatePlayerValue } from '../../../types/boxScore'

vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('../../../config/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FF_SHARE_CARDS: true,
}))

const luka: SlatePlayerValue = {
  player_id: '3945274', name: 'Luka Doncic', position: 'G', team_abbr: 'LAL', team_logo: '',
  opponent_abbr: 'UTAH', is_home: false, game_id: '1', game_status: 'final',
  min: '38', pts: '52', reb: '8', ast: '10', stl: '2', blk: '0', tov: '4',
  fg: '17-30', fg3: '8-18', ft: '10-11', z: 2.59, fantasy_team: 'LA', fantasy_team_name: 'Lakers Fans', stats: {},
}

function rostered(index: number): SlatePlayerValue {
  return {
    ...luka,
    player_id: String(100 + index),
    name: `Rostered ${index}`,
    z: 3 - index * 0.1,
    fantasy_team: 'LA',
    fantasy_team_name: 'Lakers Fans',
  }
}

describe('LinesOfTheNight', () => {
  it('shares the image only, with no caption to send or copy', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LinesOfTheNight players={[luka]} spoilerGuard={false} dateLabel="Sunday, Oct 25" games={7} />)
    await user.click(screen.getByRole('button', { name: /Lines of the night/ }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('dialog', { name: 'Share as image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument()
  })

  it('keeps a free agent who is outside the overall top 5', async () => {
    const user = userEvent.setup()
    const freeAgent: SlatePlayerValue = {
      ...luka,
      player_id: '9',
      name: 'Waiver Wire',
      z: 0.4,
      fantasy_team: null,
      fantasy_team_name: null,
    }
    renderWithProviders(
      <LinesOfTheNight
        players={[...Array.from({ length: 6 }, (_, index) => rostered(index)), freeAgent]}
        spoilerGuard={false}
        dateLabel="Sunday, Oct 25"
        games={7}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Lines of the night/ }))
    expect(screen.queryByText('Waiver Wire')).not.toBeInTheDocument()
    expect(screen.queryByText('Rostered 5')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'FA of the night' }))
    expect(screen.getByText('Waiver Wire')).toBeInTheDocument()
    expect(screen.getByText('FA')).toBeInTheDocument()
    expect(screen.queryByText('Rostered 0')).not.toBeInTheDocument()
  })
})
