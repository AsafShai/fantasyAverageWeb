import type { ReactNode } from 'react'
import { useMyTeam } from '../context/MyTeamContext'

export function MyTeamMark({ teamId }: { teamId: number | null | undefined }) {
  const { isMyTeam } = useMyTeam()
  if (!isMyTeam(teamId)) return null
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full bg-blue-600 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-white">
      My Team
    </span>
  )
}

export function MyTeamName({
  teamId,
  children,
}: {
  teamId: number
  children: ReactNode
}) {
  return (
    <span className="inline-flex min-w-0 items-center">
      {children}
      <MyTeamMark teamId={teamId} />
    </span>
  )
}
