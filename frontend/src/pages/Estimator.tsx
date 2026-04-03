import { useState, useEffect } from 'react'
import { useGetEstimatorResultsQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import type { TeamRankProbability, TeamRanking, TeamPrediction } from '../types/estimator'

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

function formatRankProbabilityPercent(prob: number): string {
  if (prob <= 0) return ''
  return `${(prob * 100).toFixed(1)}%`
}

function getProbColor(prob: number, isDark: boolean): { bg: string; text: string } {
  if (prob === 0) return { bg: isDark ? 'rgb(17,24,39)' : 'rgb(240,245,255)', text: isDark ? 'transparent' : '#aaa' }
  if (isDark) {
    // dark: dark navy (low) → bright steel blue (high), no white
    const r = Math.round(30  + prob * (56  - 30))
    const g = Math.round(50  + prob * (130 - 50))
    const b = Math.round(80  + prob * (200 - 80))
    return {
      bg: `rgb(${r},${g},${b})`,
      text: prob > 0.4 ? 'white' : '#93c5fd',
    }
  }
  const intensity = Math.round(prob * 255)
  const r = Math.round(255 - intensity * (255 - 8) / 255)
  const g = Math.round(255 - intensity * (255 - 81) / 255)
  const b = Math.round(255 - intensity * (255 - 156) / 255)
  return {
    bg: `rgb(${r},${g},${b})`,
    text: prob > 0.5 ? 'white' : prob > 0.2 ? '#1a3a5c' : '#555',
  }
}


function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function RankProbabilityHeatmap({ teams }: { teams: TeamRankProbability[] }) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const isDark = useDarkMode()

  const teamMap = new Map<number, { team_name: string; probs: Map<number, number> }>()
  for (const row of teams) {
    if (!teamMap.has(row.team_id)) {
      teamMap.set(row.team_id, { team_name: row.team_name, probs: new Map() })
    }
    teamMap.get(row.team_id)!.probs.set(row.rank, row.prob)
  }

  const numRanks = Math.max(...teams.map(t => t.rank), 0)
  const rankCols = Array.from({ length: numRanks }, (_, i) => i + 1)

  const teamList = Array.from(teamMap.entries()).map(([team_id, { team_name, probs }]) => ({
    team_id,
    team_name,
    probs,
  }))

  const sorted = [...teamList].sort((a, b) => {
    const bestA = rankCols.reduce((best, r) => (a.probs.get(r) ?? 0) > (a.probs.get(best) ?? 0) ? r : best, 1)
    const bestB = rankCols.reduce((best, r) => (b.probs.get(r) ?? 0) > (b.probs.get(best) ?? 0) ? r : best, 1)
    return bestA - bestB
  })

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Rank Probability Heatmap</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        How likely is each team to finish in each place by end of season? Cells show percent chance (0–100%). Teams are ordered by their most likely finishing position.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
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
                    className={`px-3 py-1.5 whitespace-nowrap cursor-pointer transition-colors duration-150 ${isSelected ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    onClick={() => setSelectedTeamId(prev => prev === team.team_id ? null : team.team_id)}
                  >
                    {team.team_name}
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

function RankingTable({ rankings }: { rankings: TeamRanking[] }) {
  const [sortKey, setSortKey] = useState<RankingSortKey>('rank')
  const [sortAsc, setSortAsc] = useState(true)

  const handleSort = (key: RankingSortKey) => {
    if (key === sortKey) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'rank') }
  }

  const sorted = [...rankings].sort((a, b) => {
    const av = a[sortKey as keyof TeamRanking] as number
    const bv = b[sortKey as keyof TeamRanking] as number
    return sortAsc ? av - bv : bv - av
  })

  const thClass = (key: RankingSortKey) =>
    `px-2 py-2 text-center font-medium text-xs cursor-pointer select-none whitespace-nowrap hover:text-blue-600 ${sortKey === key ? 'text-blue-600' : 'text-gray-700 dark:text-gray-200'}`

  const arrow = (key: RankingSortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Projected Rankings</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Where each team is projected to finish by end of season. Click any column to sort. Higher score in a category means a better projected finish in that stat.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
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
                <td className="px-3 py-2 font-medium whitespace-nowrap">{team.team_name}</td>
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
  const [sortKey, setSortKey] = useState<ProjectionSortKey>('team_name')
  const [sortAsc, setSortAsc] = useState(true)

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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Season Projections</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        Projected end-of-season totals per team. +/- shows standard deviation (uncertainty).
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
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
                <td className="px-3 py-2 font-medium whitespace-nowrap">{team.team_name}</td>
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

const Estimator = () => {
  const { data, error, isLoading } = useGetEstimatorResultsQuery()

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="No estimator data available yet. Data is generated daily after NBA games are completed." />

  if (!data) return <ErrorMessage message="No estimator data available yet." />

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 overflow-x-hidden">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Season Estimator</h1>
        <RankProbabilityHeatmap teams={data.rank_probabilities} />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <RankingTable rankings={data.rankings} />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 sm:p-6 overflow-hidden">
        <ProjectionSummary predictions={data.predictions} />
      </div>
    </div>
  )
}

export default Estimator
