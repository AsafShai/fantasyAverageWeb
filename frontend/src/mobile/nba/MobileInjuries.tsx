import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { InjuryRecord, StoredNotification } from '../../types/injury'
import {
  fmtTimestamp, formatNotification, notificationIcon, parseGameParts, sortInjuries, useDepthChartTeamId,
  type InjurySortDir, type InjurySortKey,
} from '../../components/injuries/injuryFormat'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { MultiSelectSheet } from '../today/MultiSelectSheet'
import { Segmented, SelectSheet, StatusPill } from '../ui'
import './nba.css'

export type InjuryScope = 'all' | 'teams' | 'players'

export interface InjuryFiltersState {
  search: string
  teams: string[]
  statuses: string[]
}

const STATUSES = ['Out', 'Questionable', 'Doubtful', 'Probable', 'Available']

const SORTS: { value: InjurySortKey; label: string }[] = [
  { value: 'last_update', label: 'Last Update' },
  { value: 'gameTime', label: 'Game Time' },
  { value: 'status', label: 'Status' },
  { value: 'team', label: 'Team' },
]

interface MobileInjuriesProps {
  loading: boolean
  error: string | null
  records: InjuryRecord[]
  filteredRecords: InjuryRecord[]
  notifications: StoredNotification[]
  lastReportTime: string | null
  filters: InjuryFiltersState
  onFilters: (filters: InjuryFiltersState) => void
  teamOptions: string[]
  teamsDisabled: boolean
  teamsPlaceholder: string
  /** Scope control shows only when a team is picked ("Select my team"). */
  scopes: { id: InjuryScope; label: string; hint: string }[] | null
  scope: InjuryScope
  onScope: (scope: InjuryScope) => void
  rosterError: boolean
  teamsError: boolean
  rosterLoading: boolean
}

/**
 * Injury report on a phone (step 5): Notifications folded with their count,
 * search + last report time, whose injuries (All / My players' teams / My
 * players), status and team pickers, Sort by + direction, then one card per
 * player with the status pill and the Roster link. State stays in pages/Injuries.
 */
export default function MobileInjuries(props: MobileInjuriesProps) {
  const { loading, error, records, filteredRecords, notifications, lastReportTime, filters, onFilters, teamOptions, teamsDisabled, teamsPlaceholder, scopes, scope, onScope, rosterError, teamsError, rosterLoading } = props
  const [sortKey, setSortKey] = useState<InjurySortKey>('last_update')
  const [sortDir, setSortDir] = useState<InjurySortDir>('desc')
  const depthChartTeamId = useDepthChartTeamId()
  const sorted = useMemo(() => sortInjuries(filteredRecords, sortKey, sortDir), [filteredRecords, sortKey, sortDir])
  const hint = scopes?.find((s) => s.id === scope)?.hint

  return (
    <div className="mr-root mr-nba" data-testid="mobile-injuries">
      <div className="mr-nba-head">
        <h1 className="mr-h1">Injury Report</h1>
        <span className="mr-meta">Live NBA injury statuses - updates streamed in real-time. Times shown in your local timezone.</span>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <>
          <details className="mr-card mr-nba-notes">
            <summary>
              <span className="mr-h2">Notifications</span>
              {notifications.length > 0 && <span className="mr-count">{notifications.length}</span>}
            </summary>
            {notifications.length === 0 ? (
              <p className="mr-meta">No notifications yet</p>
            ) : (
              <ul className="mr-nba-note-list">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <span aria-hidden="true">{notificationIcon(n.type)}</span>
                    <span>
                      <span className="mr-nba-note-text">{formatNotification(n)}</span>
                      <span className="mr-meta">{fmtTimestamp(n.timestamp)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="mr-nba-row">
            <input
              type="search"
              className="mr-nba-search"
              placeholder="Search player..."
              aria-label="Search player"
              value={filters.search}
              onChange={(e) => onFilters({ ...filters, search: e.target.value })}
            />
            {lastReportTime && (
              <span className="mr-meta mr-nba-nowrap">
                Last report: {new Date(lastReportTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {scopes && (
            <div className="mr-nba-stack">
              <Segmented
                label="Whose injuries to show"
                options={scopes.map((s) => ({ value: s.id, label: s.label }))}
                value={scope}
                onChange={onScope}
                className="mr-nba-grow-0"
              />
              {hint && <span className="mr-meta">{hint}</span>}
              {rosterError && <span className="mr-meta">Could not load your roster, showing every injury.</span>}
              {teamsError && <span className="mr-meta">Could not load NBA teams, showing every injury.</span>}
              {scope !== 'all' && <span className="mr-meta">Search and filters below apply within your selection above.</span>}
            </div>
          )}

          <div className="mr-nba-row">
            <MultiSelectSheet
              id="injury-status"
              label="statuses"
              title="Statuses"
              options={STATUSES}
              selected={filters.statuses}
              onChange={(statuses) => onFilters({ ...filters, statuses })}
            />
            {teamsDisabled ? (
              <button type="button" className="mr-select" disabled title="Loading team list…">
                <span className="mr-select-label">{teamsPlaceholder}</span>
                <span className="mr-caret" aria-hidden="true">▾</span>
              </button>
            ) : (
              <MultiSelectSheet
                id="injury-team"
                label="teams"
                title="Teams"
                options={teamOptions}
                selected={filters.teams}
                onChange={(teams) => onFilters({ ...filters, teams })}
              />
            )}
          </div>

          <div className="mr-nba-row">
            <span className="mr-meta">Sort by:</span>
            <SelectSheet
              id="injury-sort"
              label="Sort by"
              options={SORTS}
              value={sortKey}
              onChange={(key) => {
                setSortKey(key)
                setSortDir(key === 'last_update' ? 'desc' : 'asc')
              }}
            />
            <button
              type="button"
              className="mr-btn mr-sm mr-nba-sq"
              aria-label="Toggle sort direction"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {rosterLoading ? (
            <p className="mr-meta">Loading your roster…</p>
          ) : records.length === 0 ? (
            <div className="mr-card mr-nba-empty">No injury data available</div>
          ) : sorted.length === 0 ? (
            <div className="mr-card mr-nba-empty">No results match your filters</div>
          ) : (
            <ul className="mr-nba-inj-list">
              {sorted.map((r, i) => {
                const { gameTime, matchup } = parseGameParts(r)
                const game = [gameTime, matchup].filter(Boolean).join(' ')
                const teamId = depthChartTeamId(r.team)
                return (
                  <li key={`${r.team}|${r.player}|${i}`} className="mr-card mr-nba-inj">
                    <div className="mr-card-head">
                      <b className="mr-nba-inj-name">{r.player}</b>
                      <StatusPill status={r.status}>{r.status}</StatusPill>
                    </div>
                    <span className="mr-meta mr-nba-inj-team">
                      {r.team}
                      {teamId && (
                        <Link to={`/nba-teams?team=${encodeURIComponent(teamId)}`} className="mr-nba-rtag" aria-label={`${r.team} roster`}>
                          Roster
                        </Link>
                      )}
                    </span>
                    {game && <span className="mr-meta">{game}</span>}
                    <div className="mr-nba-inj-foot">
                      <span>{r.injury}</span>
                      {r.last_update && <span className="mr-meta">{fmtTimestamp(r.last_update)}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {records.length > 0 && (
            <span className="mr-meta">Showing {filteredRecords.length} of {records.length} player(s)</span>
          )}
        </>
      )}
    </div>
  )
}
