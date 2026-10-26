import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EspnUpdatedNote from '../EspnUpdatedNote'
import { formatEspnUpdated } from '../../utils/espnUpdated'

describe('formatEspnUpdated', () => {
  const now = new Date(2026, 9, 26, 13, 0)

  it('says today for a stamp from the same day', () => {
    expect(formatEspnUpdated(new Date(2026, 9, 26, 4, 3).toISOString(), now)).toMatch(/^today, /)
  })

  it('says yesterday for a stamp from the day before', () => {
    expect(formatEspnUpdated(new Date(2026, 9, 25, 4, 3).toISOString(), now)).toMatch(/^yesterday, /)
  })

  it('shows the date for older stamps', () => {
    const label = formatEspnUpdated(new Date(2026, 9, 22, 4, 3).toISOString(), now)
    expect(label).not.toMatch(/today|yesterday/)
    expect(label).toContain('22')
  })

  it('returns null for an unparseable stamp', () => {
    expect(formatEspnUpdated('not-a-date', now)).toBeNull()
  })
})

describe('EspnUpdatedNote', () => {
  it('renders nothing without a stamp', () => {
    const { container } = render(<EspnUpdatedNote updatedAt={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the ESPN update label', () => {
    render(<EspnUpdatedNote updatedAt="2026-10-26T08:03:07Z" />)
    expect(screen.getByText(/ESPN updated/)).toBeInTheDocument()
  })
})
