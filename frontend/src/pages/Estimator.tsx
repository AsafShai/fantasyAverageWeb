import { useState, useEffect } from 'react'
import { useGetEstimatorResultsQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import type { TeamRankProbability, TeamRanking, TeamPrediction } from '../types/estimator'
import { MyTeamMark } from '../components/MyTeamMark'
import { myTeamRowClass } from '../myTeam/display'
import { useMyTeam } from '../context/MyTeamContext'
import { useFollowMyTeamId } from '../hooks/useFollowMyTeam'
import { getProbColor, formatRankProbabilityPercent, expectedPlace, type HeatmapRow } from '../utils/rankProbability'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { RankProbabilityShareCard, ProjectedRankingsShareCard } from '../components/share/EstimatorShareCards'
import { formatAsOf } from '../components/share/shareCardFormat'
import { useMobileRedesign } from '../mobile/flag'
import { useUrlState, enumParam } from '../hooks/useUrlState'
import { DataTable, type Column } from '../mobile/ui'
import { EstimatorMobile, EstimatorCard, type EstimatorUrlTab } from '../mobile/pages/analytics/EstimatorMobile'

const STAT_LABELS: Record<string, string> = {
  fg_pct: 'FG%',
  ft_pct: 'FT%',
  three_pm: '3PM',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  pts: 'PTS',
}

const STAT_KEYS = ['fg_pct', 'ft_pct', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'] as const
type StatKey = typeof STAT_KEYS[number]

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function RankProbabilityHeatmap({ teams, asOf }: { teams: TeamRankProbability[]; asOf: string }) {
  const { isMyTeam, myTeamId } = useMyTeam()
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  useFollowMyTeamId(selectedTeamId, setSelectedTeamId)
  const isDark = useDarkMode()
  const mobile = useMobileRedesign()

  const teamMap = new Map<number, { team_name: string; probs: Map<number, number> }>()
  for (const row of teams) {
    if (!teamMap.has(row.team_id)) {
      teamMap.set(row.team_id, { team_name: row.team_name, probs: new Map() })
    }
    teamMap.get(row.team_id)!.probs.set(row.rank, row.prob)
  }

  const numRanks = Math.max(...teams.map(t => t.rank), 0)
  const rankCols = Array.from({ length: numRanks }, (_, i) => i + 1)

  const teamList: HeatmapRow[] = Array.from(teamMap.entries()).map(([team_id, { team_name, probs }]) => ({
    team_id,
    team_name,
    probs,
  }))

  // Ordered by expected place, not most likely place: early in the season the
  // chances are flat, and a team spread from 1st to 12th can have 1st as its
  // single likeliest place without being anywhere near the favourite.
  const sorted = [...teamList].sort((a, b) => expectedPlace(a.probs) - expectedPlace(b.probs))

  const share = sorted.length > 0 && (
    <ShareCardButton
      title="Rank Probability"
      highlightOption={myTeamId !== null}
      renderCard={({ dark, highlightMyTeam }) => (
        <RankProbabilityShareCard
          dark={dark}
          rows={sorted}
          places={rankCols}
          asOf={asOf}
          highlightTeamId={highlightMyTeam ? myTeamId : null}
        />
      )}
    />
  )

  if (mobile) {
    const columns: Column<HeatmapRow>[] = [
      {
        key: 'team',
        header: 'Team',
        pinned: true,
        cell: (t) => (
          <button
            type="button"
            className="mr-an-teambtn"
            aria-pressed={selectedTeamId === t.team_id}
            onClick={() => setSelectedTeamId(prev => prev === t.team_id ? null : t.team_id)}
          >
            <span className="mr-an-teamname">{t.team_name}</span>
            <MyTeamMark teamId={t.team_id} />
          </button>
        ),
      },
      ...rankCols.map<Column<HeatmapRow>>(r => ({
        key: String(r),
        header: r,
        align: 'center',
        className: 'mr-es-prob',
        cell: (t) => {
          const prob = t.probs.get(r) ?? 0
          const { bg, text } = getProbColor(prob, isDark)
          return <span style={{ backgroundColor: bg, color: text }}>{formatRankProbabilityPercent(prob)}</span>
        },
      })),
    ]
    return (
      <EstimatorCard
        title="Rank Probability Heatmap"
        share={share}
        explain="How likely is each team to finish in each place by end of season? Cells show percent chance (0–100%). Teams are ordered by their expected finishing place. Tap a team to spotlight it."
      >
        <DataTable
          caption="Rank Probability Heatmap"
          className="mr-es-table"
          columns={columns}
          rows={sorted}
          rowKey={(t) => String(t.team_id)}
          isHighlighted={(t) => isMyTeam(t.team_id)}
          rowClassName={(t) => (selectedTeamId === t.team_id ? 'mr-an-spot' : undefined)}
        />
      </EstimatorCard>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-semibold">Rank Probability Heatmap</h2>
        {share}
      </div>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        How likely is each team to finish in each place by end of season? Cells show percent chance (0–100%). Teams are ordered by their expected finishing place.
      </p>
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-white dark:bg-gray-800">
            <tr className="border-b border-gray-300 dark:border-gray-600">
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">Team</th>
              {rankCols.map(r => (
                <th key={r} className="px-2 py-2 text-center font-medium text-gray-700 dark:text-gray-200 min-w-14">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => {
              const isSelected = selectedTeamId === team.team_id
              return (
                <tr
                  key={team.team_id}
                  className={`transition-all duration-150 ${isSelected ? 'border-[3px] border-black dark:border-white' : ''}`}
                >
                  <td
                    className={`px-3 py-1.5 whitespace-nowrap cursor-pointer transition-colors duration-150 ${isSelected ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'} ${myTeamRowClass(isMyTeam(team.team_id))}`}
                    onClick={() => setSelectedTeamId(prev => prev === team.team_id ? null : team.team_id)}
                  >
                    {team.team_name}
                    <MyTeamMark teamId={team.team_id} />
                  </td>
                  {rankCols.map(r => {
                    const prob = team.probs.get(r) ?? 0
                    const { bg, text } = getProbColor(prob, isDark)
                    return (
                      <td
                        key={r}
                        className="px-1 py-1.5 text-center min-w-14 text-xs font-medium"
                        style={{ backgroundColor: bg, color: text }}
                      >
                        {formatRankProbabilityPercent(prob)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type RankingSortKey = 'rank' | 'total_expected_pts' | 'projected_total_gp' | `expected_pts_${typeof STAT_KEYS[number]}`

function RankingTable({ rankings, asOf }: { rankings: TeamRanking[]; asOf: string }) {
  const { isMyTeam, myTeamId } = useMyTeam()
  const [sortKey, setSortKey] = useState<RankingSortKey>('rank')
  const [sortAsc, setSortAsc] = useState(true)
  const mobile = useMobileRedesign()

  const handleSort = (key: RankingSortKey) => {
    if (key === sortKey) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'rank') }
  }

  const sorted = [...rankings].sort((a, b) => {
    const av = a[sortKey as keyof TeamRanking] as number
    const bv = b[sortKey as keyof TeamRanking] as number
    return sortAsc ? av - bv : bv - av
  })

  const share = sorted.length > 0 && (
    <ShareCardButton
      title="Projected Rankings"
      highlightOption={myTeamId !== null}
      renderCard={({ dark, highlightMyTeam }) => (
        <ProjectedRankingsShareCard
          dark={dark}
          rows={sorted}
          asOf={asOf}
          highlightTeamId={highlightMyTeam ? myTeamId : null}
        />
      )}
    />
  )

  const thClass = (key: RankingSortKey) =>
    `px-2 py-2 text-center font-medium text-xs cursor-pointer select-none whitespace-nowrap hover:text-blue-600 ${sortKey === key ? 'text-blue-600' : 'text-gray-700 dark:text-gray-200'}`

  const arrow = (key: RankingSortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  if (mobile) {
    const columns: Column<TeamRanking>[] = [
      {
        key: 'rank',
        header: '# Team',
        headerLabel: 'Rank and team',
        pinned: true,
        sortable: true,
        firstDir: 'asc',
        cell: (t) => (
          <>
            <span className="mr-es-rank">{t.rank}</span> {t.team_name}
            <MyTeamMark teamId={t.team_id} />
          </>
        ),
      },
      ...STAT_KEYS.map<Column<TeamRanking>>(k => ({
        key: `expected_pts_${k}`,
        header: STAT_LABELS[k],
        sortable: true,
        cell: (t) => (t[`expected_pts_${k}` as keyof TeamRanking] as number).toFixed(1),
      })),
      { key: 'total_expected_pts', header: 'Total', sortable: true, className: 'mr-es-total', cell: (t) => t.total_expected_pts.toFixed(1) },
      { key: 'projected_total_gp', header: 'Proj GP', sortable: true, className: 'mr-es-gp', cell: (t) => t.projected_total_gp.toFixed(0) },
    ]
    return (
      <EstimatorCard
        title="Projected Rankings"
        share={share}
        explain="Where each team is projected to finish by end of season. Tap any column to sort. Higher score in a category means a better projected finish in that stat."
      >
        <DataTable
          caption="Projected Rankings"
          className="mr-es-table"
          columns={columns}
          rows={sorted}
          rowKey={(t) => String(t.team_id)}
          sort={{ key: sortKey, dir: sortAsc ? 'asc' : 'desc' }}
          onSortChange={(st) => { setSortKey(st.key as RankingSortKey); setSortAsc(st.dir === 'asc') }}
          isHighlighted={(t) => isMyTeam(t.team_id)}
        />
      </EstimatorCard>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-semibold">Projected Rankings</h2>
        {share}
      </div>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Where each team is projected to finish by end of season. Click any column to sort. Higher score in a category means a better projected finish in that stat.
      </p>
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-20 bg-white dark:bg-gray-800">
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th onClick={() => handleSort('rank')} className={`px-3 py-2 text-left font-medium text-xs cursor-pointer select-none hover:text-blue-600 ${sortKey === 'rank' ? 'text-blue-600' : 'text-gray-700 dark:text-gray-200'}`}>#{ arrow('rank')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200 text-xs">Team</th>
              {STAT_KEYS.map(k => (
                <th key={k} onClick={() => handleSort(`expected_pts_${k}`)} className={thClass(`expected_pts_${k}`)}>
                  {STAT_LABELS[k]}{arrow(`expected_pts_${k}`)}
                </th>
              ))}
              <th onClick={() => handleSort('total_expected_pts')} className={`${thClass('total_expected_pts')} border-l-2 border-gray-300 dark:border-gray-600`}>
                Total{arrow('total_expected_pts')}
              </th>
              <th onClick={() => handleSort('projected_total_gp')} className={thClass('projected_total_gp')}>
                Proj GP{arrow('projected_total_gp')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => (
              <tr key={team.team_id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-3 py-2 font-bold">{team.rank}</td>
                <td className={`px-3 py-2 font-medium whitespace-nowrap ${myTeamRowClass(isMyTeam(team.team_id))}`}>
                  {team.team_name}
                  <MyTeamMark teamId={team.team_id} />
                </td>
                {STAT_KEYS.map(k => (
                  <td key={k} className="px-2 py-2 text-center text-xs">
                    {(team[`expected_pts_${k}` as keyof TeamRanking] as number).toFixed(1)}
                  </td>
                ))}
                <td className="px-3 py-2 text-center font-semibold border-l-2 border-gray-300 dark:border-gray-600">
                  {team.total_expected_pts.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">
                  {team.projected_total_gp.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type ProjectionSortKey = 'team_name' | 'projected_total_gp' | `estimated_final_${StatKey}`

function ProjectionSummary({ predictions }: { predictions: TeamPrediction[] }) {
  const { isMyTeam } = useMyTeam()
  const [sortKey, setSortKey] = useState<ProjectionSortKey>('team_name')
  const [sortAsc, setSortAsc] = useState(true)
  const mobile = useMobileRedesign()

  const handleSort = (key: ProjectionSortKey) => {
    if (key === sortKey) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'team_name') }
  }

  const sorted = [...predictions].sort((a, b) => {
    if (sortKey === 'team_name') return sortAsc ? a.team_name.localeCompare(b.team_name) : b.team_name.localeCompare(a.team_name)
    if (sortKey === 'projected_total_gp') return sortAsc ? a.projected_total_gp - b.projected_total_gp : b.projected_total_gp - a.projected_total_gp
    const av = a[sortKey as keyof TeamPrediction] as number
    const bv = b[sortKey as keyof TeamPrediction] as number
    return sortAsc ? av - bv : bv - av
  })

  const formatStat = (key: StatKey, value: number) => {
    if (key === 'fg_pct' || key === 'ft_pct') return value.toFixed(2) + '%'
    return value.toFixed(1)
  }

  const thClass = (key: ProjectionSortKey) =>
    `px-3 py-2 text-center font-medium text-xs cursor-pointer select-none whitespace-nowrap hover:text-blue-600 ${sortKey === key ? 'text-blue-600' : 'text-gray-700 dark:text-gray-200'}`

  const arrow = (key: ProjectionSortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  if (mobile) {
    const columns: Column<TeamPrediction>[] = [
      {
        key: 'team_name',
        header: 'Team',
        pinned: true,
        sortable: true,
        firstDir: 'asc',
        cell: (t) => (
          <>
            {t.team_name}
            <MyTeamMark teamId={t.team_id} />
          </>
        ),
      },
      ...STAT_KEYS.map<Column<TeamPrediction>>(k => ({
        key: `estimated_final_${k}`,
        header: STAT_LABELS[k],
        sortable: true,
        cell: (t) => {
          const val = t[`estimated_final_${k}` as keyof TeamPrediction] as number
          const stddev = Math.sqrt(Math.abs(t[`variance_${k}` as keyof TeamPrediction] as number))
          return (
            <>
              {formatStat(k, val)}
              <span className="mr-es-sd">+/-{formatStat(k, stddev)}</span>
            </>
          )
        },
      })),
      { key: 'projected_total_gp', header: 'Proj GP', sortable: true, className: 'mr-es-gp', cell: (t) => t.projected_total_gp.toFixed(0) },
    ]
    return (
      <EstimatorCard
        title="Season Projections"
        explain="Projected end-of-season totals per team. +/- shows standard deviation (uncertainty)."
      >
        <DataTable
          caption="Season Projections"
          className="mr-es-table"
          columns={columns}
          rows={sorted}
          rowKey={(t) => String(t.team_id)}
          sort={{ key: sortKey, dir: sortAsc ? 'asc' : 'desc' }}
          onSortChange={(st) => { setSortKey(st.key as ProjectionSortKey); setSortAsc(st.dir === 'asc') }}
          isHighlighted={(t) => isMyTeam(t.team_id)}
        />
      </EstimatorCard>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Season Projections</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Projected end-of-season totals per team. +/- shows standard deviation (uncertainty).
      </p>
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-20 bg-white dark:bg-gray-800">
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th onClick={() => handleSort('team_name')} className={`px-3 py-2 text-left font-medium text-xs cursor-pointer select-none hover:text-blue-600 ${sortKey === 'team_name' ? 'text-blue-600' : 'text-gray-700 dark:text-gray-200'}`}>
                Team{arrow('team_name')}
              </th>
              {STAT_KEYS.map(k => (
                <th key={k} onClick={() => handleSort(`estimated_final_${k}`)} className={thClass(`estimated_final_${k}`)}>
                  {STAT_LABELS[k]}{arrow(`estimated_final_${k}`)}
                </th>
              ))}
              <th onClick={() => handleSort('projected_total_gp')} className={thClass('projected_total_gp')}>
                Proj GP{arrow('projected_total_gp')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => (
              <tr key={team.team_id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className={`px-3 py-2 font-medium whitespace-nowrap ${myTeamRowClass(isMyTeam(team.team_id))}`}>
                  {team.team_name}
                  <MyTeamMark teamId={team.team_id} />
                </td>
                {STAT_KEYS.map(k => {
                  const val = team[`estimated_final_${k}` as keyof TeamPrediction] as number
                  const variance = team[`variance_${k}` as keyof TeamPrediction] as number
                  const stddev = Math.sqrt(Math.abs(variance))
                  return (
                    <td key={k} className="px-3 py-2 text-center text-xs">
                      <span className="font-medium">{formatStat(k, val)}</span>
                      <span className="text-gray-400 dark:text-gray-500 ml-0.5">+/-{formatStat(k, stddev)}</span>
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">
                  {team.projected_total_gp.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Phone layout only: one section per tab, in the URL (?tab=prob|rank|proj).
const ESTIMATOR_URL_SCHEMA = { tab: enumParam<EstimatorUrlTab>(['prob', 'rank', 'proj'], 'prob') }

const Estimator = () => {
  const { data, error, isLoading } = useGetEstimatorResultsQuery()
  const mobile = useMobileRedesign()
  const [urlState, setUrlState] = useUrlState(ESTIMATOR_URL_SCHEMA)

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'No estimator data available yet. Data is generated daily after NBA games are completed.')} />

  if (!data) return <ErrorMessage message="No estimator data available yet." />

  const asOf = formatAsOf(data.as_of_date)

  if (mobile) {
    return (
      <EstimatorMobile tab={urlState.tab} onTab={(tab) => setUrlState({ tab })}>
        {urlState.tab === 'prob' && <RankProbabilityHeatmap teams={data.rank_probabilities} asOf={asOf} />}
        {urlState.tab === 'rank' && <RankingTable rankings={data.rankings} asOf={asOf} />}
        {urlState.tab === 'proj' && <ProjectionSummary predictions={data.predictions} />}
      </EstimatorMobile>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 overflow-x-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Season Estimator</h1>
        <RankProbabilityHeatmap teams={data.rank_probabilities} asOf={asOf} />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <RankingTable rankings={data.rankings} asOf={asOf} />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <ProjectionSummary predictions={data.predictions} />
      </div>
    </div>
  )
}

export default Estimator
