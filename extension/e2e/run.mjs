import * as esbuild from 'esbuild'
import { execSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT = path.resolve(HERE, '..', 'dist')
const OUT = path.join(HERE, 'out')
const PAGE = 'https://fantasy.espn.com/basketball/editdraftstrategy'

execSync('npm run build', { cwd: path.resolve(HERE, '..'), stdio: 'inherit' })
await mkdir(OUT, { recursive: true })
await esbuild.build({
  entryPoints: [path.join(HERE, 'mock', 'app.jsx')],
  outfile: path.join(OUT, 'app.js'),
  bundle: true,
  format: 'iife',
  jsx: 'transform',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
})
const appJs = await readFile(path.join(OUT, 'app.js'), 'utf8')
const html = '<!doctype html><html><body><div id="root"></div><script src="/__mock/app.js"></script></body></html>'

function shuffledIds(count, take, seed) {
  const ids = Array.from({ length: count }, (_, i) => 3000 + i)
  let s = seed
  for (let i = ids.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids.slice(0, take)
}

async function writeCsv(name, ids) {
  const lines = ['rank,id,name,team,positions']
  ids.forEach((id, i) => lines.push(`${i + 1},${id},Mock Player ${id - 3000},,PG`))
  const file = path.join(OUT, name)
  await writeFile(file, lines.join('\n'))
  return file
}

async function runCase({ label, query, csvIds, expectMethod }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'espn-helper-e2e-'))
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  const blocked = []
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(PAGE)) return route.fulfill({ contentType: 'text/html', body: html })
    if (url === 'https://fantasy.espn.com/__mock/app.js') return route.fulfill({ contentType: 'text/javascript', body: appJs })
    blocked.push(url)
    return route.abort()
  })
  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto(`${PAGE}?leagueId=1&${query}`)
    await page.locator('tr[data-player-row]').first().waitFor()
    const panel = page.locator('#ff-espn-helper')
    await panel.waitFor()

    const strict = await page.evaluate(() => {
      try {
        window.__mockStore.playerRankMap = {}
        return 'mutation allowed'
      } catch {
        return 'blocked'
      }
    })

    await panel.locator('input[type=file]').setInputFiles(await writeCsv(`${label}.csv`, csvIds))
    await page.locator('#ff-espn-status', { hasText: 'Ready' }).waitFor()
    const t0 = Date.now()
    await panel.locator('button.ff-apply').click()
    await page.waitForFunction(
      () => /Placed|Could not|Stopped|failed|timed out/i.test(document.getElementById('ff-espn-status')?.textContent || ''),
      null,
      { timeout: 600_000 },
    )
    const seconds = (Date.now() - t0) / 1000
    const status = await page.locator('#ff-espn-status').textContent()

    const order = await page.evaluate(() => window.__mockStore.players.slice().map((p) => p.id))
    const orderOk = csvIds.every((id, i) => order[i] === id)
    const screenIds = await page.$$eval('tr[data-player-row] input[data-idx]', (els) => els.map((e) => Number(e.getAttribute('data-idx'))))
    const screenOk = screenIds.every((id, i) => id === order[i])
    const saveOn = await page.locator('button.save-rankings-btn').isEnabled()
    await page.screenshot({ path: path.join(OUT, `${label}.png`) })

    const pass = strict === 'blocked' && orderOk && screenOk && saveOn && status.includes(expectMethod)
    console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${label}`)
    console.log(`  status:        ${status}`)
    console.log(`  time:          ${seconds.toFixed(2)}s`)
    console.log(`  strict mode:   direct mutation ${strict}`)
    console.log(`  store order:   ${orderOk ? 'matches CSV' : 'WRONG'} (${csvIds.length} players)`)
    console.log(`  screen rows:   ${screenOk ? 'match store' : 'WRONG'} (${screenIds.length} visible)`)
    console.log(`  save enabled:  ${saveOn}`)
    console.log(`  blocked reqs:  ${blocked.length}`)
    return pass
  } finally {
    await ctx.close()
    await rm(profile, { recursive: true, force: true })
  }
}

const results = [
  await runCase({
    label: 'instant-top300',
    query: 'n=400',
    csvIds: shuffledIds(400, 300, 7),
    expectMethod: 'espn-instant',
  }),
  await runCase({
    label: 'drags-top300-baseline',
    query: 'n=400&variant=nocomponent',
    csvIds: shuffledIds(400, 300, 7),
    expectMethod: 'espn-drags',
  }),
  await runCase({
    label: 'fallback-drags',
    query: 'n=60&variant=nocomponent',
    csvIds: shuffledIds(60, 25, 11),
    expectMethod: 'espn-drags',
  }),
]
process.exit(results.every(Boolean) ? 0 : 1)
