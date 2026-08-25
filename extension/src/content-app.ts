import { FF_MSG, type RankingsPayload, isRankingsPayload } from './lib/types'
import { savePayload } from './lib/storage'

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === FF_MSG.PING) {
    window.postMessage({ type: FF_MSG.PONG }, '*')
    return
  }
  if (data.type === FF_MSG.APPLY && isRankingsPayload(data.payload)) {
    const payload = data.payload as RankingsPayload
    void savePayload(payload)
      .then(() => {
        window.postMessage({ type: FF_MSG.STORED, count: payload.players.length }, '*')
      })
      .catch(() => {
        /* quota / private mode — site ping will time out */
      })
  }
})
