import { VISIBLE_HINT_CAP } from './thresholds'
import type { TeamHint, TeamHintsInput } from './types'
import { detectLineupHints } from './detectors/lineup'
import { detectRosterHints } from './detectors/roster'
import { detectScheduleHints } from './detectors/schedule'

function dedupeHints(hints: TeamHint[]): TeamHint[] {
  const seen = new Set<string>()
  const out: TeamHint[] = []
  for (const h of hints.sort((a, b) => b.priority - a.priority)) {
    if (seen.has(h.id)) continue
    seen.add(h.id)
    out.push(h)
  }
  return out
}

export function buildTeamHints(input: TeamHintsInput, dismissedIds: Set<string> = new Set()): {
  visible: TeamHint[]
  hidden: TeamHint[]
  all: TeamHint[]
} {
  const raw = [
    ...detectLineupHints(input),
    ...detectScheduleHints(input),
    ...detectRosterHints(input),
  ]

  const all = dedupeHints(raw).filter((h) => !dismissedIds.has(h.id))
  const visible = all.slice(0, VISIBLE_HINT_CAP)
  const hidden = all.slice(VISIBLE_HINT_CAP)
  return { visible, hidden, all }
}
