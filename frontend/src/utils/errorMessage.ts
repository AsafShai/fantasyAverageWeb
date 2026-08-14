import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { SerializedError } from '@reduxjs/toolkit'

type ApiError = FetchBaseQueryError | SerializedError | unknown

const isFetchBaseQueryError = (error: ApiError): error is FetchBaseQueryError =>
  typeof error === 'object' && error !== null && 'status' in error

const extractDetail = (error: FetchBaseQueryError): string | undefined => {
  const data = error.data
  if (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string') {
    return (data as { detail: string }).detail
  }
  return undefined
}

/**
 * Backend distinguishes 503 (no data yet, e.g. season hasn't started / league
 * not synced) from 404/500 — surface that instead of always showing the same
 * generic fallback string regardless of what actually happened.
 */
export const getErrorMessage = (error: ApiError, fallback: string): string => {
  if (!isFetchBaseQueryError(error)) return fallback

  if (error.status === 503) {
    return extractDetail(error) ?? 'No data available yet for this league/season.'
  }
  if (error.status === 404) {
    return extractDetail(error) ?? fallback
  }
  return fallback
}
