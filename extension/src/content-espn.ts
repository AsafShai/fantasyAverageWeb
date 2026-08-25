import { parseRankingsCsv } from './lib/parseCsv'
import { applyRankingsToEspnPage, friendlyApplyError, snapshotReorderResult, type ReorderResult } from './lib/reorder'
import { loadPayload, savePayload } from './lib/storage'
import { APPLY_TOP_N } from './lib/match'
import { FF_MSG, STORAGE_KEY, type RankedPlayer, type RankingsPayload } from './lib/types'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  if (text) node.textContent = text
  return node
}

function summarize(payload: RankingsPayload | null): string {
  if (!payload?.players.length) return 'No rankings loaded. Use Apply on ESPN from the site, or load a CSV.'
  const n = Math.min(APPLY_TOP_N, payload.players.length)
  return `Ready: ${payload.players.length} players. Apply will place the top ${n}.`
}

function resultMessage(result: Extract<ReorderResult, { ok: true }>): string {
  if (result.stopped) {
    return `Stopped. Remaining swaps were skipped. ${result.matched} of top ${result.totalEspn} are in the expected slot. Click Save Rankings yourself to keep this order, or reload the tab to discard it.`
  }
  return `Placed ${result.matched} of top ${result.totalEspn} (${result.method}). Click Save Rankings yourself.`
}

function mountPanel() {
  if (document.getElementById('ff-espn-helper')) return

  const root = el('div', { id: 'ff-espn-helper' })
  const head = el('div', { class: 'ff-head' }, 'Pre-Draft Rankings')
  const toggle = el('button', { class: 'ff-toggle', type: 'button', 'aria-label': 'Minimize' }, '–')
  head.appendChild(toggle)
  const body = el('div', { class: 'ff-body' })
  const warn = el(
    'p',
    { class: 'ff-warn' },
    'Reorders this unsaved list only. Click Save Rankings yourself. This helper will not click it.',
  )
  const status = el('p', { class: 'ff-status', id: 'ff-espn-status' })
  const apply = el('button', { class: 'ff-apply', type: 'button' }, 'Apply order')
  const stop = el('button', { class: 'ff-stop', type: 'button' }, 'Stop')
  stop.disabled = true
  const fileLabel = el('label', { class: 'ff-file' }, 'Load CSV')
  const file = el('input', { type: 'file', accept: '.csv,text/csv' })
  fileLabel.appendChild(file)
  const extra = el('div', { id: 'ff-espn-extra' })

  body.append(warn, status, apply, stop, fileLabel, extra)
  root.append(head, body)
  document.documentElement.appendChild(root)

  toggle.addEventListener('click', () => {
    root.classList.toggle('ff-min')
    toggle.textContent = root.classList.contains('ff-min') ? '+' : '–'
  })

  let applying = false
  let applyAbort: AbortController | null = null

  const setStatus = (text: string, error = false) => {
    status.textContent = text
    status.classList.toggle('ff-error', error)
  }

  const renderUnmatched = (result: Extract<ReorderResult, { ok: true }>) => {
    extra.replaceChildren()
    if (!result.unmatchedCsv.length) return
    extra.appendChild(el('p', { class: 'ff-status' }, 'Not on this ESPN list:'))
    const list = el('ul', { class: 'ff-list' })
    for (const p of result.unmatchedCsv.slice(0, 25)) {
      list.appendChild(el('li', {}, `${p.name}${p.team ? ` (${p.team})` : ''}`))
    }
    if (result.unmatchedCsv.length > 25) {
      list.appendChild(el('li', {}, `…and ${result.unmatchedCsv.length - 25} more`))
    }
    extra.appendChild(list)
  }

  const renderExtra = (payload: RankingsPayload | null) => {
    extra.replaceChildren()
    if (!payload) return
    const missing = payload.players.filter((p) => p.espnId == null).length
    if (missing) {
      extra.appendChild(
        el('p', { class: 'ff-status' }, `${missing} exported players have no ESPN id and will match by name.`),
      )
    }
  }

  const refresh = async () => {
    const payload = await loadPayload()
    if (!applying) {
      setStatus(summarize(payload))
      renderExtra(payload)
      apply.disabled = !payload?.players.length
      stop.disabled = true
    }
  }

  const applyFromPage = (
    players: RankedPlayer[],
    onProgress: (message: string) => void,
    signal: AbortSignal,
    runId: number,
  ): Promise<ReorderResult> =>
    new Promise((resolve, reject) => {
      let settled = false
      let seenPage = false
      let quickTimer = 0
      let longTimer = 0
      let stopTimer = 0
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(quickTimer)
        window.clearTimeout(longTimer)
        window.clearTimeout(stopTimer)
        window.removeEventListener('message', onMsg)
        signal.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = () => {
        window.postMessage({ type: FF_MSG.STOP, runId }, '*')
        if (!seenPage) {
          finish(() =>
            resolve({
              ok: true,
              stopped: true,
              matched: 0,
              totalEspn: Math.min(APPLY_TOP_N, players.length),
              unmatchedCsv: [],
              unmatchedEspn: [],
              method: 'stopped',
            }),
          )
          return
        }
        stopTimer = window.setTimeout(() => {
          finish(() => resolve(snapshotReorderResult(players, true)))
        }, 8000)
      }
      const onMsg = (event: MessageEvent) => {
        if (event.source !== window) return
        const data = event.data
        if (!data || typeof data !== 'object') return
        if (data.runId != null && data.runId !== runId) return
        if (data.type === FF_MSG.READY || data.type === FF_MSG.PROGRESS) seenPage = true
        if (data.type === FF_MSG.PROGRESS && typeof data.message === 'string') onProgress(data.message)
        if (data.type === FF_MSG.RESULT && data.result) {
          finish(() => resolve(data.result as ReorderResult))
        }
      }
      window.addEventListener('message', onMsg)
      signal.addEventListener('abort', onAbort)
      if (signal.aborted) {
        onAbort()
        return
      }
      window.postMessage({ type: FF_MSG.PING, page: 'espn' }, '*')
      window.postMessage({ type: FF_MSG.RUN, players, runId }, '*')
      quickTimer = window.setTimeout(() => {
        if (!seenPage) finish(() => reject(new Error('page script missing')))
      }, 2500)
      longTimer = window.setTimeout(() => {
        finish(() => reject(new Error('timed out')))
      }, 180_000)
    })

  const applyNow = async (players: RankedPlayer[]) => {
    applyAbort?.abort()
    const abort = new AbortController()
    applyAbort = abort
    applying = true
    apply.disabled = true
    stop.disabled = false
    setStatus('Reordering ESPN’s list…')
    extra.replaceChildren()
    const onProgress = (message: string) => {
      if (!abort.signal.aborted) setStatus(message)
    }
    const runId = Date.now()
    try {
      let result: ReorderResult
      try {
        result = await applyFromPage(players, onProgress, abort.signal, runId)
      } catch (err) {
        const timedOut = err instanceof Error && err.message === 'timed out'
        if (timedOut) {
          window.postMessage({ type: FF_MSG.STOP, runId }, '*')
          result = {
            ok: false,
            error:
              'Apply timed out. Reload the Edit Draft Strategy tab and Apply again. Do not save until the order is correct.',
          }
        } else {
          result = await applyRankingsToEspnPage(players, onProgress, abort.signal)
        }
      }
      if (!result.ok) {
        setStatus(result.error, true)
        return
      }
      setStatus(resultMessage(result))
      renderUnmatched(result)
    } catch (err) {
      setStatus(friendlyApplyError(err), true)
    } finally {
      if (applyAbort === abort) applyAbort = null
      applying = false
      stop.disabled = true
      const payload = await loadPayload()
      apply.disabled = !payload?.players.length
    }
  }

  apply.addEventListener('click', async () => {
    if (applying) return
    const payload = await loadPayload()
    if (!payload?.players.length) {
      setStatus('Load rankings from the site or a CSV first.', true)
      return
    }
    await applyNow(payload.players)
  })

  stop.addEventListener('click', () => {
    if (!applying) return
    setStatus('Stopping after this swap…')
    applyAbort?.abort()
    window.postMessage({ type: FF_MSG.STOP }, '*')
  })

  file.addEventListener('change', async () => {
    if (applying) return
    const chosen = file.files?.[0]
    file.value = ''
    if (!chosen) return
    const parsed = parseRankingsCsv(await chosen.text())
    if (!parsed.ok) {
      setStatus(parsed.error, true)
      return
    }
    const payload: RankingsPayload = {
      version: 1,
      source: 'pre-draft-rankings',
      savedAt: new Date().toISOString(),
      players: parsed.players,
    }
    await savePayload(payload)
    await refresh()
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return
    void refresh()
  })

  void refresh()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPanel)
} else {
  mountPanel()
}
