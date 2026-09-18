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

  it('renders days and hours remaining for a future deadline', () => {
    render(<DeadlineCountdown deadline="2026-01-03T06:00:00Z" />)
    expect(screen.getByText('Trade Deadline')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
    expect(screen.getByText('06')).toBeInTheDocument()
  })
})
