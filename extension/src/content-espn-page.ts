import { applyRankingsToEspnPage, friendlyApplyError } from './lib/reorder'
import { FF_MSG, type RankedPlayer } from './lib/types'

let runAbort: AbortController | null = null
let activeRunId: unknown = null

function postResult(runId: unknown, result: unknown) {
  if (activeRunId !== runId) return
  window.postMessage({ type: FF_MSG.RESULT, runId, result }, '*')
}

window.postMessage({ type: FF_MSG.READY }, '*')

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === FF_MSG.PING && data.page === 'espn') {
    window.postMessage({ type: FF_MSG.READY }, '*')
    return
  }
  if (data.type === FF_MSG.STOP) {
    runAbort?.abort()
    return
  }
  if (data.type !== FF_MSG.RUN) return
  const players = data.players as RankedPlayer[]
  if (!Array.isArray(players)) return
  runAbort?.abort()
  const runId = data.runId ?? Date.now()
  activeRunId = runId
  const abort = new AbortController()
  runAbort = abort
  void applyRankingsToEspnPage(
    players,
    (message) => {
      if (activeRunId !== runId) return
      window.postMessage({ type: FF_MSG.PROGRESS, runId, message }, '*')
    },
    abort.signal,
  )
    .then((result) => {
      postResult(runId, result)
    })
    .catch((err: unknown) => {
      postResult(runId, { ok: false, error: friendlyApplyError(err) })
    })
})
