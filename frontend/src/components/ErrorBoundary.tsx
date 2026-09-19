import { Component, type ErrorInfo, type ReactNode } from 'react'

const CHUNK_RELOAD_KEY = 'eb-chunk-reload'

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  caughtChunkError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { caughtChunkError: false }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    if (isChunkLoadError(error)) {
      return { caughtChunkError: true }
    }
    throw error
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!isChunkLoadError(error)) return
    console.error('ErrorBoundary caught a chunk load error:', error, info)
    if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
      window.location.reload()
    }
  }

  render() {
    if (this.state.caughtChunkError) return null
    return this.props.children
  }
}

export default ErrorBoundary
