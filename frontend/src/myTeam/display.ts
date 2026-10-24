// My Team display helpers, kept out of MyTeamMark.tsx so that file only
// exports components (React Fast Refresh needs that).

export function myTeamRowClass(active: boolean): string {
  return active ? 'shadow-[inset_4px_0_0_0_#2563eb]' : ''
}

export function leadWithMyTeam<T extends { team_id: number }>(items: T[], myTeamId: number | null): T[] {
  if (myTeamId == null) return items
  const mine: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (item.team_id === myTeamId) mine.push(item)
    else rest.push(item)
  }
  return mine.length === 0 ? items : [...mine, ...rest]
}

export function fantasyTeamOptionLabel(name: string, isMine: boolean): string {
  return isMine ? `${name} (My Team)` : name
}
