import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import DeadlineCountdown from '../DeadlineCountdown'

describe('DeadlineCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when deadline is null', () => {
    const { container } = render(<DeadlineCountdown deadline={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when deadline is in the past', () => {
    const { container } = render(<DeadlineCountdown deadline="2025-01-01T00:00:00Z" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when deadline is more than 7 days away', () => {
    const { container } = render(<DeadlineCountdown deadline="2026-01-09T00:00:01Z" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders days and hours remaining when 3 days away', () => {
    render(<DeadlineCountdown deadline="2026-01-04T06:00:00Z" />)
    expect(screen.getByText('Trade Deadline')).toBeInTheDocument()
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByText('06')).toBeInTheDocument()
  })

  it('renders when just inside the 7-day window', () => {
    render(<DeadlineCountdown deadline="2026-01-07T23:59:00Z" />)
    expect(screen.getByText('Trade Deadline')).toBeInTheDocument()
  })
})
