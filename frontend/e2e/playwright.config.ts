import { defineConfig, devices } from '@playwright/test'
import { API_BASE_URL } from './support/mockApi'

const PORT = 5174
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // iPhone 13 size and touch, run in Chromium (the device preset defaults to WebKit).
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Real env vars beat any local .env, so specs see the same build everywhere:
    // API calls go to the mocked localhost backend and seasonal/debug flags stay off.
    env: {
      VITE_API_BASE_URL: API_BASE_URL,
      VITE_FF_FEATURE_STORE: 'false',
      VITE_FF_PAST_SLATES: 'false',
      VITE_FF_PROJECTIONS: 'false',
      VITE_FF_DRAFT_REPORT: 'false',
      VITE_FF_DRAFT_PAGES: 'false',
      VITE_FF_DRAFT_STEALS_BUSTS: 'false',
      VITE_FF_SHARE_CARDS: 'true',
    },
  },
})
