import { Fragment, useMemo } from 'react'
import { Link } from 'react-router'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { SerializedError } from '@reduxjs/toolkit'
import type { NbaTeamInfo, ScheduleTeam } from '../../types/api'
import { DEPTH_EXCLUDE_STATUSES, DEPTH_LABELS, DEPTH_MAX, useNbaDepthChart } from '../../hooks/useNbaDepthChart'
import { useGetScheduleQuery } from '../../store/api/fantasyApi'
import { METRIC_GLOSSARY } from '../../constants/metricGlossary'
import { boxScoreHref, easternToday, formatScheduleDate, monthKey, monthLabel, slateLevel, type ScheduleView } from '../../utils/teamSchedule'
import { useTeamScheduleView } from '../../hooks/useTeamScheduleView'
import { getErrorMessage } from '../../utils/errorMessage'
import { nbaTeamLogoUrl } from '../../utils/nbaImages'
import PlayerNameLink from '../../components/PlayerNameLink'
import InfoTip from '../../components/InfoTip'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { Card, Chip, ChipRow, FaMark, Segmented, SelectSheet, StatusPill, type SegmentedOption } from '../ui'
import './nba.css'

interface MobileNbaTeamsProps {
  teams: NbaTeamInfo[] | undefined
  isLoading: boolean
  error: FetchBaseQueryError | SerializedError | undefined
  selectedTeamId: string
  onSelectTeam: (teamId: string) => void
}

/**
 * NBA Teams on a phone (step 5): team picker as a bottom-sheet list, the depth
 * chart (Position × Starter…5th, pinned position column, injury pills, FA mark,
 * Exclude chips) and the team's remaining schedule. State stays in NbaTeams.
 */
export default function MobileNbaTeams({ teams, isLoading, error, selectedTeamId, onSelectTeam }: MobileNbaTeamsProps) {
  const options = useMemo(
    () => [...(teams ?? [])]
      .sort((a, b) => a.team_name.localeCompare(b.team_name))
      .map((team) => ({ value: team.team_id, label: team.team_name, image: nbaTeamLogoUrl(team.abbreviation, 64) })),
    [teams],
  )

  return (
    <div className="mr-root mr-nba" data-testid="mobile-nba-teams">
      <div className="mr-nba-head">
        <h1 className="mr-nba-title">NBA Teams</h1>
        <p className="mr-nba-lede">Select a team to explore its depth chart and schedule</p>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load teams')} />
      ) : (
        <>
          <SelectSheet
            id="nba-team"
            label="NBA team"
            options={options}
            value={selectedTeamId}
            // The list closes by stepping back over its history entry; picking after
            // that lands the ?team= replace on the page's own entry, not the sheet's.
            onChange={(teamId) => { window.setTimeout(() => onSelectTeam(teamId), 60) }}
            display={selectedTeamId ? undefined : 'Select a team...'}
            wide
          />
          {selectedTeamId && (
            <>
              <DepthChartCard key={`depth-${selectedTeamId}`} teamId={selectedTeamId} />
              <TeamScheduleCard key={`schedule-${selectedTeamId}`} teamId={selectedTeamId} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function DepthChartCard({ teamId }: { teamId: string }) {
  const { data, isLoading, error, freeAgentIds, excludedStatuses, toggleStatus, removeDuplicates, setRemoveDuplicates, positions } = useNbaDepthChart(teamId)
  const anyFa = positions.some((pos) => pos.players.some((p) => freeAgentIds.has(p.id)))

  return (
    <Card aria-labelledby="nba-depth-chart-heading">
      <h2 id="nba-depth-chart-heading" className="mr-h2 mr-nba-anchor">Depth chart</h2>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load depth chart')} />
      ) : data ? (
        <>
          <div className="mr-nba-team">
            {data.team_logo && <img src={data.team_logo} alt={data.team_name} className="mr-nba-logo" />}
            <div className="mr-nba-team-name">
              <b>{data.team_name}</b>
              <span className="mr-meta">{data.record}</span>
            </div>
          </div>
          <div className="mr-nba-exclude">
            <span className="mr-meta">Exclude:</span>
            <ChipRow label="Exclude">
              {DEPTH_EXCLUDE_STATUSES.map((status) => (
                <Chip key={status} selected={excludedStatuses.has(status)} onClick={() => toggleStatus(status)}>
                  {status}
                </Chip>
              ))}
              <Chip selected={removeDuplicates} onClick={() => setRemoveDuplicates(!removeDuplicates)}>
                Duplicates
              </Chip>
            </ChipRow>
          </div>
          <div className="mr-tw">
            <table className="mr-t mr-nba-depth" aria-label="Depth chart">
              <thead>
                <tr>
                  <th scope="col" className="mr-pin mr-l"><span className="mr-th-label">POSITION</span></th>
                  {DEPTH_LABELS.map((label) => (
                    <th key={label} scope="col" className="mr-l"><span className="mr-th-label">{label.toUpperCase()}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.abbreviation}>
                    <th scope="row" className="mr-pin mr-l mr-nba-pos">{pos.display_name}</th>
                    {Array.from({ length: DEPTH_MAX }, (_, i) => {
                      const player = pos.players[i]
                      return (
                        <td key={i} className="mr-l">
                          {player ? (
                            <span className="mr-nba-depth-cell">
                              {freeAgentIds.has(player.id) && <FaMark />}
                              <PlayerNameLink name={player.display_name} playerId={player.id} />
                              {player.injury && <StatusPill status={player.injury.status}>{player.injury.status}</StatusPill>}
                            </span>
                          ) : (
                            <span className="mr-nba-faint">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anyFa && (
            <span className="mr-meta"><FaMark /> = not on any fantasy roster</span>
          )}
        </>
      ) : null}
    </Card>
  )
}

function Kpi({ label, value, metric }: { label: string; value: number | string; metric?: keyof typeof METRIC_GLOSSARY }) {
  const info = metric ? METRIC_GLOSSARY[metric] : null
  return (
    <div className="mr-nba-tile">
      <span className="mr-nba-tile-label">{label}{info && <InfoTip title={info.title} body={info.body} />}</span>
      <span className="mr-nba-tile-value">{value}</span>
    </div>
  )
}

function TeamScheduleCard({ teamId }: { teamId: string }) {
  const { data, isLoading, error } = useGetScheduleQuery()
  const team = data?.teams.find((item) => item.team_id === Number(teamId))

  return (
    <Card aria-labelledby="nba-team-schedule-heading">
      <h2 id="nba-team-schedule-heading" className="mr-h2">{team ? `${team.team_name} schedule` : 'Schedule'}</h2>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load team schedule')} />
      ) : !team ? (
        <p className="mr-meta">Select a team to view its schedule.</p>
      ) : (
        <TeamScheduleBody team={team} />
      )}
    </Card>
  )
}

const SCHEDULE_VIEWS: SegmentedOption<ScheduleView>[] = [
  { value: 'results', label: 'Results' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All' },
]

function TeamScheduleBody({ team }: { team: ScheduleTeam }) {
  const [s, scrollRef] = useTeamScheduleView(team)
  const { view, shown, todayIndex } = s
  const showToday = view === 'all' && todayIndex > 0 && todayIndex < shown.length
  const heads = view === 'results' ? ['RESULT', ''] : view === 'upcoming' ? ['REST DAYS', 'SLATE SIZE'] : ['RESULT · REST', 'SLATE']
  const empty = view === 'results' ? 'No games played yet.' : view === 'upcoming' ? 'No games left this season.' : 'No games published yet.'
  return (
    <>
      <p className="mr-meta">{s.record ? `${s.record.record} · ` : ''}{s.played} played, {s.left} left</p>
      <Segmented
        label="Show games"
        options={SCHEDULE_VIEWS.map((o) => ({ ...o, label: `${o.label} ${s.counts[o.value]}` }))}
        value={view}
        onChange={s.setView}
      />
      {team.total_games < 82 && view !== 'results' && (
        <div className="mr-nba-info">
          <b>{team.total_games} games are published.</b> Two Cup knockout slots are held for mid-December and will be added when scheduled.
        </div>
      )}
      <div className="mr-nba-tiles">
        {view === 'upcoming' && (
          <>
            <Kpi label="Games left" value={s.left} metric="scheduleLeft" />
            <Kpi label="Back-to-backs left" value={s.b2bLeft} metric="scheduleB2BLeft" />
            <Kpi label="High-volume left" value={s.highVolumeLeft} metric="scheduleHighVolumeLeft" />
          </>
        )}
        {view === 'results' && (
          <>
            <Kpi label="Record" value={s.record?.record ?? '—'} />
            <Kpi label="Home" value={s.record?.home ?? '—'} />
            <Kpi label="Away" value={s.record?.away ?? '—'} />
          </>
        )}
        {view === 'all' && (
          <>
            <Kpi label="Record" value={s.record?.record ?? '—'} />
            <Kpi label="Games left" value={s.left} metric="scheduleLeft" />
            <Kpi label="Back-to-backs left" value={s.b2bLeft} metric="scheduleB2BLeft" />
          </>
        )}
      </div>
      {s.resultsFailed && view !== 'upcoming' && <p className="mr-meta">Scores could not be loaded; box score links still work.</p>}
      <div ref={scrollRef} className="mr-tw mr-nba-scroll" data-testid="team-schedule-scroll">
        <table className="mr-t" aria-label="Team schedule">
          <thead>
            <tr>
              <th scope="col" className="mr-l"><span className="mr-th-label">DATE</span></th>
              <th scope="col" className="mr-l"><span className="mr-th-label">OPPONENT</span></th>
              <th scope="col"><span className="mr-th-label">{heads[0]}</span></th>
              <th scope="col">{heads[1] ? <span className="mr-th-label">{heads[1]}</span> : <span className="sr-only">Box score</span>}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={4} className="mr-empty">{empty}</td></tr>
            )}
            {shown.map((row, index) => {
              const { game, result } = row
              const previous = shown[index - 1]
              const showMonth = !previous || monthKey(previous.game.date) !== monthKey(game.date)
              const level = slateLevel(game)
              const date = formatScheduleDate(game.date, { weekday: 'short', month: 'short', day: 'numeric' })
              return (
                <Fragment key={game.game_id}>
                  {showToday && index === todayIndex && (
                    <tr className="mr-nba-today" data-testid="schedule-today">
                      <th colSpan={4} scope="colgroup" className="mr-l">Today · {formatScheduleDate(easternToday(), { month: 'short', day: 'numeric' })}</th>
                    </tr>
                  )}
                  {showMonth && (
                    <tr className="mr-nba-month">
                      <th colSpan={4} scope="colgroup" className="mr-l">{monthLabel(game.date)}</th>
                    </tr>
                  )}
                  <tr data-row-index={index}>
                    <td className="mr-l">{date}</td>
                    <td className="mr-l">
                      <span className="mr-nba-opp">
                        <span className="mr-nba-vs">{game.is_home ? 'vs' : '@'}</span>
                        <img src={nbaTeamLogoUrl(game.opponent_abbreviation, 64)} alt="" width={20} height={20} loading="lazy" className="mr-nba-opp-logo" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                        {game.opponent_abbreviation}
                      </span>
                    </td>
                    {row.played ? (
                      <>
                        <td>
                          {result ? (
                            <span className="mr-nba-result">
                              <span className={result.won ? 'mr-nba-wl mr-nba-w' : 'mr-nba-wl mr-nba-l'}>{result.won ? 'W' : 'L'}</span>
                              {result.team_score}-{result.opponent_score}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <Link
                            to={boxScoreHref(game)}
                            className="mr-nba-boxlink"
                            aria-label={`Box score: ${result ? `${result.won ? 'Win' : 'Loss'} ${result.team_score}-${result.opponent_score} ` : ''}${game.is_home ? 'vs' : 'at'} ${game.opponent}, ${formatScheduleDate(game.date, { month: 'short', day: 'numeric' })}`}
                          >
                            Box<span aria-hidden="true"> ›</span>
                          </Link>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={game.rest_days === 0 ? 'mr-nba-b2b' : undefined}>
                          {game.rest_days === null ? '—' : game.rest_days === 0 ? '0 · B2B' : `${game.rest_days}d`}
                        </td>
                        <td className={level ? `mr-nba-slate-${level}` : undefined}>{game.slate_size}</td>
                      </>
                    )}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
