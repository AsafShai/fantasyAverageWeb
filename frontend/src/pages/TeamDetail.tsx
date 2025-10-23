import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useGetTeamDetailQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

const TeamDetail = () => {
  const { teamId } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const { data: team_detail, error, isLoading } = useGetTeamDetailQuery(teamIdNumber)
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showAverages, setShowAverages] = useState(true)

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const formatNumber = (num: number) => {
    const rounded = Math.round(num * 10000) / 10000
    if (rounded === Math.round(rounded * 10) / 10) {
      return rounded.toFixed(1)
    }
    return rounded.toString()
  }

  const formatStat = (value: number, gp: number, isPercentage: boolean = false) => {
    if (isPercentage) {
      return formatNumber(value * 100) + '%'
    }
    if (showAverages) {
      return gp > 0 ? formatNumber(value / gp) : '0.0'
    }
    return formatNumber(value)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message="Failed to load team details" />
  if (!team_detail) return <ErrorMessage message="Team not found" />

  const columns = [
    { key: 'player_name', label: 'Player', align: 'left' },
    { key: 'positions', label: 'Position', align: 'left' },
    { key: 'pro_team', label: 'Pro Team', align: 'left' },
    { key: 'minutes', label: showAverages ? 'MPG' : 'Min', align: 'right' },
    { key: 'fg_percentage', label: 'FG%', align: 'right' },
    { key: 'ft_percentage', label: 'FT%', align: 'right' },
    { key: 'three_pm', label: showAverages ? '3PG' : '3PM', align: 'right' },
    { key: 'reb', label: showAverages ? 'RPG' : 'REB', align: 'right' },
    { key: 'ast', label: showAverages ? 'APG' : 'AST', align: 'right' },
    { key: 'stl', label: showAverages ? 'SPG' : 'STL', align: 'right' },
    { key: 'blk', label: showAverages ? 'BPG' : 'BLK', align: 'right' },
    { key: 'pts', label: showAverages ? 'PPG' : 'PTS', align: 'right' },
    { key: 'gp', label: 'GP', align: 'right' },
  ]

  const getPositionOrder = (positions: string[]): number => {
    const positionRank = { 'PG': 1, 'SG': 2, 'SF': 3, 'PF': 4, 'C': 5 }
    const firstPos = positions[0]
    return positionRank[firstPos as keyof typeof positionRank] ?? 99
  }

  const sortedPlayers = sortBy === null 
    ? team_detail.players 
    : [...team_detail.players].sort((a, b) => {
        let aVal: string | number | null
        let bVal: string | number | null

        if (sortBy === 'player_name') {
          aVal = a.player_name
          bVal = b.player_name
        } else if (sortBy === 'positions') {
          const aPosOrder = getPositionOrder(a.positions)
          const bPosOrder = getPositionOrder(b.positions)
          return sortOrder === 'asc' ? aPosOrder - bPosOrder : bPosOrder - aPosOrder
        } else if (sortBy === 'pro_team') {
          aVal = a.pro_team
          bVal = b.pro_team
        } else {
          aVal = a.stats[sortBy as keyof typeof a.stats] ?? -1
          bVal = b.stats[sortBy as keyof typeof b.stats] ?? -1
        }

        if (sortBy === 'positions') {
          return 0 // Already handled above
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal)
        }

        const aNum = aVal as number
        const bNum = bVal as number
        return sortOrder === 'asc' ? aNum - bNum : bNum - aNum
      })

  return (
    <div className="max-w-7xl mx-auto px-4 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <button
          onClick={() => navigate('/teams')}
          className="mb-4 inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors duration-200 cursor-pointer"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Teams
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{team_detail.team.team_name}</h1>
          <a
            href={team_detail.espn_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white font-medium rounded-lg shadow hover:from-red-700 hover:to-red-800 transition-all duration-200"
          >
            View on ESPN
            <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>


      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Team Statistics</h2>
        <div className="flex items-center space-x-4 mb-6">
          <span className="text-gray-600">Total Games Played:</span>
          <span className="font-semibold">{team_detail.raw_averages.gp}</span>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-4">Ranking Summary (Averages)</h2>
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border-l-4 border-blue-500 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-lg font-medium">Overall Rank:</span>
              <span className="text-2xl font-bold text-blue-600">#{team_detail.ranking_stats.rank}</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-lg font-medium">Total Points:</span>
              <span className="text-2xl font-bold text-blue-600">{team_detail.ranking_stats.total_points}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Shot Chart Stats</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Field Goals:</span>
                <span>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({(team_detail.shot_chart.fg_percentage * 100).toFixed(4)}%)</span>
              </div>
              <div className="flex justify-between">
                <span>Free Throws:</span>
                <span>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({(team_detail.shot_chart.ft_percentage * 100).toFixed(4)}%)</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Per-Game Averages</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Points:</span>
                <span>{team_detail.raw_averages.pts.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Rebounds:</span>
                <span>{team_detail.raw_averages.reb.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Assists:</span>
                <span>{team_detail.raw_averages.ast.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Steals:</span>
                <span>{team_detail.raw_averages.stl.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Blocks:</span>
                <span>{team_detail.raw_averages.blk.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>3-Pointers:</span>
                <span>{team_detail.raw_averages.three_pm.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Roster</h2>
          <div className="stats-toggle">
            <button
              className={showAverages ? 'active' : ''}
              onClick={() => setShowAverages(true)}
            >
              Per Game
            </button>
            <button
              className={!showAverages ? 'active' : ''}
              onClick={() => setShowAverages(false)}
            >
              Totals
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => handleSort(column.key)}
                    className={`px-4 py-3 text-${column.align} text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors duration-150`}
                  >
                    <div className={`flex items-center ${column.align === 'right' ? 'justify-end' : ''}`}>
                      {column.label}
                      {sortBy === column.key && (
                        <span className="ml-1">
                          {sortOrder === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedPlayers.map((player, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{player.player_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{player.positions.join(', ')}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{player.pro_team}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.minutes, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.fg_percentage, player.stats.gp, true)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.ft_percentage, player.stats.gp, true)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.three_pm, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.reb, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.ast, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.stl, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.blk, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{formatStat(player.stats.pts, player.stats.gp)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">{player.stats.gp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default TeamDetail