import { STORAGE_KEY, isRankingsPayload, type RankingsPayload } from './types'

export async function loadPayload(): Promise<RankingsPayload | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  const value = data[STORAGE_KEY]
  return isRankingsPayload(value) ? value : null
}

export async function savePayload(payload: RankingsPayload): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: payload })
}
