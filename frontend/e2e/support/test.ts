import { test as base, expect, type Page } from '@playwright/test'
import { mockApi } from './mockApi'

/** "Now" for every spec, so date-driven UI (slates, schedule windows) is stable. */
export const FIXED_NOW = new Date('2026-10-19T12:00:00-04:00')

export const test = base.extend<{ pageErrors: string[] }>({
  // Every spec gets the mocked API and a fixed clock; the test fails on any
  // uncaught page error.
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.clock.setFixedTime(FIXED_NOW)
      await mockApi(page)
      await use(errors)
      expect(errors, 'uncaught page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

/** Fails if the page scrolls sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(0)
}
