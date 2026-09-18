import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../ErrorBoundary'

function ChunkBomb(): ReactElement {
  throw new Error('Failed to fetch dynamically imported module: /foo.js')
}

function NonChunkBomb(): ReactElement {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sessionStorage.clear()
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('reloads once on a chunk-load error and sets the session guard flag', () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    })

    render(
      <ErrorBoundary>
        <ChunkBomb />
      </ErrorBoundary>,
    )

    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('eb-chunk-reload')).toBe('1')
  })

  it('does not reload again on a second chunk-load error once the guard flag is set', () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    })
    sessionStorage.setItem('eb-chunk-reload', '1')

    render(
      <ErrorBoundary>
        <ChunkBomb />
      </ErrorBoundary>,
    )

    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('rethrows non-chunk errors and renders nothing of its own', () => {
    expect(() =>
      render(
        <ErrorBoundary>
          <NonChunkBomb />
        </ErrorBoundary>,
      ),
    ).toThrow('boom')

    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })
})
