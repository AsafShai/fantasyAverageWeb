export function nextMisplacedIndex(
  currentIds: Array<string | null>,
  targetIds: Array<string | null>,
): { from: number; to: number } | null {
  for (let to = 0; to < targetIds.length; to++) {
    const want = targetIds[to]
    if (!want) continue
    if (currentIds[to] === want) continue
    const from = currentIds.indexOf(want)
    if (from >= 0 && from !== to) return { from, to }
  }
  return null
}

export function swapDidNotMove(
  prev: { from: number; to: number; key: string | null } | null,
  step: { from: number; to: number },
  key: string | null,
): boolean {
  return Boolean(prev && prev.from === step.from && prev.to === step.to && prev.key === key)
}

export function identitiesMatchOrder(currentIds: Array<string | null>, targetIds: Array<string | null>): boolean {
  const n = Math.min(currentIds.length, targetIds.length)
  if (n === 0) return false
  for (let i = 0; i < n; i++) {
    if (!targetIds[i]) continue
    if (currentIds[i] !== targetIds[i]) return false
  }
  return true
}
