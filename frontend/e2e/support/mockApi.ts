import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url))

/** Backend base URL the e2e build is pointed at (see playwright.config.ts). */
export const API_BASE_URL = 'http://localhost:8000/api'

/** Loads `e2e/fixtures/<name>.json`. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(`${fixturesDir}${name}.json`, 'utf8')) as T
}

export type MockResponse = unknown | ((route: Route) => Promise<void> | void)

/**
 * API path (after `/api`) → response. Matching is by exact path or `prefix*`.
 * Anything not listed answers 404 so pages show their empty/error states.
 */
export const DEFAULT_API: Record<string, () => MockResponse> = {
  '/league/summary': () => fixture('league-summary'),
  '/league/today': () => fixture('today-hub'),
  '/rankings': () => fixture('rankings'),
  '/analytics/heatmap': () => fixture('heatmap'),
  '/players': () => fixture('players'),
  '/teams/': () => fixture('teams'),
  '/teams/1': () => fixture('team-detail'),
  '/nba/schedule': () => fixture('schedule'),
  '/matchups/upcoming-dates': () => fixture('upcoming-dates'),
  '/matchups/current-slate-date': () => fixture('current-slate-date'),
  '/matchups/dates': () => [],
  '/matchups/today': () => fixture('matchups'),
}

function matches(pattern: string, path: string) {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern
}

/**
 * Serves every request to the backend (API_BASE_URL) from fixtures.
 * `overrides` take precedence over DEFAULT_API; pass `null` to force a 404.
 * Returns the list of API paths the page requested that had no mock.
 */
export async function mockApi(page: Page, overrides: Record<string, MockResponse | null> = {}) {
  const unmocked: string[] = []
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(new URL(API_BASE_URL).pathname.length)
    const key =
      Object.keys(overrides).find((p) => matches(p, path)) ??
      Object.keys(DEFAULT_API).find((p) => matches(p, path))
    const body = key === undefined ? undefined : key in overrides ? overrides[key] : DEFAULT_API[key]()
    if (typeof body === 'function') return body(route)
    if (body === undefined || body === null) {
      unmocked.push(path)
      return route.fulfill({ status: 404, json: { detail: 'Not found' } })
    }
    return route.fulfill({ status: 200, json: body })
  })
  return { unmocked }
}
