import { useState } from 'react'
import { FF_MANAGER_HINTS } from '../../config/featureFlags'
import { useMyTeam } from '../../context/useMyTeam'
import { useTeamHints, type UseTeamHintsOptions } from '../../hooks/useTeamHints'
import type { TeamHint } from '../../utils/teamHints/types'
import type { RosterDay, TeamDetail } from '../../types/api'
import { HintPlayerRow } from './HintPlayerRow'
import './hints.css'

const SEVERITY_BORDER: Record<TeamHint['severity'], string> = {
  opportunity: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  info: 'border-l-slate-400',
}

type HintsLayout = 'desktop' | 'mobile'

function HintRow({
  hint,
  onDismiss,
  layout,
}: {
  hint: TeamHint
  onDismiss?: (h: TeamHint) => void
  layout: HintsLayout
}) {
  return (
    <li
      className={`mgr-hint-row border-l-[3px] ${SEVERITY_BORDER[hint.severity]} ${layout === 'mobile' ? 'mgr-hint-row--mobile' : ''}`}
    >
      <div className="mgr-hint-row-head">
        <div className="min-w-0 flex-1">
          <p className="mgr-hint-title">{hint.title}</p>
          <p className="mgr-hint-body">{hint.body}</p>
          {hint.players && hint.players.length > 0 && (
            <ul
              className={`mgr-hint-players${layout === 'mobile' ? ' mgr-hint-players--mobile' : ''}`}
            >
              {hint.players.map((pl) => (
                <HintPlayerRow key={pl.playerId ?? pl.name} player={pl} layout={layout} />
              ))}
            </ul>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            className="mgr-hint-dismiss shrink-0"
            onClick={() => onDismiss(hint)}
            aria-label="Dismiss hint"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
    </li>
  )
}

interface ManagerHintsCardProps extends UseTeamHintsOptions {
  teamId: number
  teamName?: string | null
  className?: string
  layout?: HintsLayout
  /** Inside mobile Card — hide duplicate section title. */
  embedded?: boolean
}

export default function ManagerHintsCard({
  teamId,
  teamName,
  teamDetail,
  rosterDay,
  slateDate,
  includeSchedule = true,
  className = '',
  layout = 'desktop',
  embedded = false,
}: ManagerHintsCardProps) {
  const { isLoading, visible, hiddenCount, dismiss, teamName: loadedName, expandAll } = useTeamHints(teamId, {
    teamDetail,
    rosterDay,
    slateDate,
    includeSchedule,
  })
  const [expanded, setExpanded] = useState(false)
  const displayName = teamName ?? loadedName ?? 'your team'
  const rows = expanded ? expandAll : visible

  const sectionClass = [
    'mgr-hints-section',
    layout === 'desktop' ? 'mgr-hints-section--desktop' : 'mgr-hints-section--mobile',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const head = (
    <div className={`mgr-hints-head ${layout === 'desktop' && !embedded ? 'mgr-hints-head--desktop' : ''}`}>
      {embedded ? (
        <p className="mgr-hints-sub">
          for {displayName} · roster, ranks & tonight&apos;s slate
        </p>
      ) : (
        <>
          <h2 className="mgr-hints-title">Manager hints</h2>
          <p className="mgr-hints-sub">
            for {displayName} · roster, ranks & tonight&apos;s slate
          </p>
        </>
      )}
    </div>
  )

  if (isLoading) {
    return (
      <section className={sectionClass} aria-busy="true" aria-label="Manager hints">
        {head}
        <p className="mgr-hints-empty">Loading manager hints…</p>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className={sectionClass} aria-label="Manager hints">
        {head}
        <p className="mgr-hints-empty">No strong suggestions right now — your lineup looks reasonable.</p>
      </section>
    )
  }

  return (
    <section className={sectionClass} aria-label="Manager hints">
      {head}
      <ul className="mgr-hints-list">
        {rows.map((h) => (
          <HintRow key={h.id} hint={h} onDismiss={dismiss} layout={layout} />
        ))}
      </ul>
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more
        </button>
      )}
    </section>
  )
}

/** Team page: only for the user’s own team. */
export function ManagerHintsTeamSection({
  teamId,
  layout = 'desktop',
  teamDetail,
  rosterDay,
  slateDate,
}: {
  teamId: number
  layout?: HintsLayout
  teamDetail?: TeamDetail | null
  rosterDay?: RosterDay | null
  slateDate?: string | null
}) {
  const { myTeamId, myTeam, isMyTeam } = useMyTeam()
  if (!FF_MANAGER_HINTS || !isMyTeam(teamId)) return null
  return (
    <ManagerHintsCard
      teamId={myTeamId!}
      teamName={myTeam?.team_name}
      teamDetail={teamDetail}
      rosterDay={rosterDay}
      slateDate={slateDate}
      layout={layout}
      embedded={layout === 'mobile'}
    />
  )
}
