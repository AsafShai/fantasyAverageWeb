import { parseRankingsCsv } from './lib/parseCsv'
import { loadPayload, savePayload } from './lib/storage'
import type { RankingsPayload } from './lib/types'

function summarize(payload: RankingsPayload | null): string {
  if (!payload?.players.length) return 'No rankings loaded yet.'
  const withId = payload.players.filter((p) => p.espnId != null).length
  const when = payload.savedAt ? new Date(payload.savedAt).toLocaleString() : ''
  return `Loaded ${payload.players.length} players (${withId} with ESPN ids)${when ? ` · ${when}` : ''}.`
}

async function refresh() {
  const status = document.getElementById('status')
  if (!status) return
  try {
    status.textContent = summarize(await loadPayload())
  } catch {
    status.textContent = 'Could not read saved rankings.'
  }
}

document.getElementById('csv')?.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const status = document.getElementById('status')
  if (!file || !status) return
  const text = await file.text()
  const parsed = parseRankingsCsv(text)
  if (!parsed.ok) {
    status.classList.add('error')
    status.textContent = parsed.error
    input.value = ''
    return
  }
  const payload: RankingsPayload = {
    version: 1,
    source: 'pre-draft-rankings',
    savedAt: new Date().toISOString(),
    players: parsed.players,
  }
  await savePayload(payload)
  status.classList.remove('error')
  status.textContent = summarize(payload)
  input.value = ''
})

void refresh()
