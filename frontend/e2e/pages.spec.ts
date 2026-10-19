import { test, expect, expectNoHorizontalScroll } from './support/test'

/** Every public route renders its main heading without page errors or sideways scroll. */
const PAGES: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /^Today$/ },
  { path: '/rankings', heading: /Team Rankings/ },
  { path: '/teams', heading: /^Teams$/ },
  { path: '/team/1', heading: /Fantasy One/ },
  { path: '/analytics', heading: /League Analytics/ },
  { path: '/trade', heading: /Trade Analyzer/ },
  { path: '/players', heading: /^Players$/ },
  { path: '/injuries', heading: /Injury Report/ },
  { path: '/nba-teams', heading: /NBA Teams/ },
  { path: '/schedule', heading: /Season schedule/ },
  { path: '/player-rankings', heading: /Player Rankings/ },
  { path: '/trends', heading: /Trends/ },
  { path: '/minigames', heading: /^Minigames$/ },
  { path: '/does-not-exist', heading: /404/ },
]

for (const { path, heading } of PAGES) {
  test(`${path} renders`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('main').getByRole('heading', { name: heading }).first()).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
}
