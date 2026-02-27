import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useGetTeamDetailQuery, useGetLeagueSummaryQuery } from '../store/api/fantasyApi'
import type { TimePeriod } from '../types/api'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { aggregatePlayerAverages } from '../utils/statsUtils'

const TeamDetail = () => {
  const { teamId } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('season')
  const { data: team_detail, error, isLoading } = useGetTeamDetailQuery({
    teamId: teamIdNumber,
    time_period: timePeriod
  })
  const { data: leagueSummary } = useGetLeagueSummaryQuery()
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showAverages, setShowAverages] = useState(true)
  const [includedPlayers, setIncludedPlayers] = useState<Set<string> | null>(null)

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const isPlayerIncluded = (playerName: string) =>
    includedPlayers === null || includedPlayers.has(playerName)

  const togglePlayerInclusion = (playerName: string) => {
    setIncludedPlayers(prev => {
      const allNames = team_detail?.players.map(p => p.player_name) ?? []
      const currentIncluded = prev === null ? new Set(allNames) : new Set(prev)
      if (currentIncluded.has(playerName)) {
        currentIncluded.delete(playerName)
      } else {
        currentIncluded.add(playerName)
      }
      return currentIncluded.size === allNames.length ? null : currentIncluded
    })
  }

  const toggleAllPlayers = () => {
    if (!team_detail) return
    const allIncluded = includedPlayers === null || includedPlayers.size === team_detail.players.length
    setIncludedPlayers(allIncluded ? new Set() : null)
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
    { key: 'include', label: 'Include', align: 'center', sortable: false },
    { key: 'player_name', label: 'Player', align: 'left', sortable: true },
    { key: 'positions', label: 'Position', align: 'left', sortable: true },
    { key: 'pro_team', label: 'Pro Team', align: 'left', sortable: true },
    { key: 'minutes', label: showAverages ? 'MPG' : 'Min', align: 'right', sortable: true },
    { key: 'fg_percentage', label: 'FG%', align: 'right', sortable: true },
    { key: 'ft_percentage', label: 'FT%', align: 'right', sortable: true },
    { key: 'three_pm', label: showAverages ? '3PG' : '3PM', align: 'right', sortable: true },
    { key: 'reb', label: showAverages ? 'RPG' : 'REB', align: 'right', sortable: true },
    { key: 'ast', label: showAverages ? 'APG' : 'AST', align: 'right', sortable: true },
    { key: 'stl', label: showAverages ? 'SPG' : 'STL', align: 'right', sortable: true },
    { key: 'blk', label: showAverages ? 'BPG' : 'BLK', align: 'right', sortable: true },
    { key: 'pts', label: showAverages ? 'PPG' : 'PTS', align: 'right', sortable: true },
    { key: 'gp', label: 'GP', align: 'right', sortable: true },
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
          const aStat = a.stats[sortBy as keyof typeof a.stats] ?? -1
          const bStat = b.stats[sortBy as keyof typeof b.stats] ?? -1
          const isPercentage = sortBy === 'fg_percentage' || sortBy === 'ft_percentage'

          aVal = (showAverages && sortBy !== 'gp' && !isPercentage)
            ? (a.stats.gp > 0 ? aStat / a.stats.gp : 0)
            : aStat
          bVal = (showAverages && sortBy !== 'gp' && !isPercentage)
            ? (b.stats.gp > 0 ? bStat / b.stats.gp : 0)
            : bStat
        }

        if (sortBy === 'positions') {
          return 0
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

  const calculateTeamAverage = () => {
    const includedPlayers = team_detail.players.filter(p => isPlayerIncluded(p.player_name))

    if (includedPlayers.length === 0) {
      return {
        minutes: 0,
        fg_percentage: 0,
        ft_percentage: 0,
        three_pm: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        pts: 0,
        gp: 0,
        fgm: 0,
        fga: 0,
        ftm: 0,
        fta: 0,
      }
    }

    const totals = includedPlayers.reduce((acc, player) => {
      return {
        minutes: acc.minutes + player.stats.minutes,
        three_pm: acc.three_pm + player.stats.three_pm,
        reb: acc.reb + player.stats.reb,
        ast: acc.ast + player.stats.ast,
        stl: acc.stl + player.stats.stl,
        blk: acc.blk + player.stats.blk,
        pts: acc.pts + player.stats.pts,
        gp: acc.gp + player.stats.gp,
        fgm: acc.fgm + player.stats.fgm,
        fga: acc.fga + player.stats.fga,
        ftm: acc.ftm + player.stats.ftm,
        fta: acc.fta + player.stats.fta,
      }
    }, {
      minutes: 0,
      three_pm: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      pts: 0,
      gp: 0,
      fgm: 0,
      fga: 0,
      ftm: 0,
      fta: 0,
    })

    if (showAverages) {
      return aggregatePlayerAverages(includedPlayers)
    }

    return {
      ...totals,
      fg_percentage: totals.fga > 0 ? totals.fgm / totals.fga : 0,
      ft_percentage: totals.fta > 0 ? totals.ftm / totals.fta : 0,
    }
  }

  const teamAverage = calculateTeamAverage()

  const getTimePeriodLabel = () => {
    switch (timePeriod) {
      case 'last_7': return 'Last 7'
      case 'last_15': return 'Last 15'
      case 'last_30': return 'Last 30'
      case 'season':
      default: return 'Season'
    }
  }

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
      {team_detail.slot_usage && Object.keys(team_detail.slot_usage).length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Slot Usage</h2>
            <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
              <span>*</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-200 inline-block"></span><span className="text-red-700">5%+ out of pace (above or below)</span></span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-200 inline-block"></span><span className="text-gray-600">within range</span></span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr>
                  {(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const).map(slot => (
                    <th key={slot} className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase border border-gray-200 bg-gray-50">
                      {slot}
                      {slot === 'UTIL' && <div className="text-gray-400 font-normal normal-case">per slot in ()</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const).map(slot => {
                    const usage = team_detail.slot_usage[slot]
                    if (!usage) return <td key={slot} className="px-4 py-3 text-center border border-gray-200">-</td>
                    const nbaAvg = leagueSummary?.nba_avg_pace ?? null
                    let cellClass = 'bg-gray-100 text-gray-800'
                    if (nbaAvg && nbaAvg > 0) {
                      const effective = slot === 'UTIL' ? usage.games_used / 3 : usage.games_used
                      const deviation = Math.abs((effective - nbaAvg) / nbaAvg)
                      if (deviation >= 0.05) cellClass = 'bg-red-100 text-red-800'
                      else cellClass = 'bg-gray-100 text-gray-700'
                    }
                    const perSlot = slot === 'UTIL' ? ` (${Math.round(usage.games_used / 3)}/82)` : ''
                    return (
                      <td key={slot} className={`px-4 py-3 text-center text-sm font-medium border border-gray-200 ${cellClass}`}>
                        {usage.games_used}/{usage.cap}{perSlot}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-4 gap-3">
          <h2 className="text-2xl font-bold text-gray-900">Roster</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <TimePeriodSelector
              value={timePeriod}
              onChange={setTimePeriod}
            />
            <div className="flex border border-gray-300 rounded overflow-hidden self-end sm:self-stretch">
              <button
                className={`px-3 py-1.5 sm:py-0 text-sm whitespace-nowrap transition-all duration-200 border-r border-gray-300 ${showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                onClick={() => setShowAverages(true)}
              >
                Per Game
              </button>
              <button
                className={`px-3 py-1.5 sm:py-0 text-sm whitespace-nowrap transition-all duration-200 ${!showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                onClick={() => setShowAverages(false)}
              >
                Totals
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => column.sortable !== false && handleSort(column.key)}
                    className={`px-4 py-3 text-${column.align} text-xs font-medium text-gray-500 uppercase tracking-wider ${
                      column.sortable !== false ? 'cursor-pointer hover:bg-gray-100' : ''
                    } transition-colors duration-150`}
                  >
                    {column.key === 'include' ? (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="text-xs font-medium text-gray-500 uppercase">Include</span>
                        <input
                          type="checkbox"
                          checked={includedPlayers === null || includedPlayers.size === team_detail.players.length}
                          onChange={toggleAllPlayers}
                          className="w-4 h-4 text-blue-600 cursor-pointer"
                          title="Toggle all players"
                        />
                      </div>
                    ) : (
                      <div className={`flex items-center ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : ''}`}>
                        {column.label}
                        {sortBy === column.key && (
                          <span className="ml-1">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedPlayers.map((player, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <input
                      type="checkbox"
                      checked={isPlayerIncluded(player.player_name)}
                      onChange={() => togglePlayerInclusion(player.player_name)}
                      className="w-4 h-4 text-blue-600 cursor-pointer"
                    />
                  </td>
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
              <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 border-t-2 border-blue-400 font-bold">
                <td className="px-4 py-3 whitespace-nowrap text-center">
                  <span className="text-blue-600">-</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-900">
                  {showAverages ? 'Avg' : 'Total'} ({getTimePeriodLabel()})
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">
                  {includedPlayers === null ? team_detail.players.length : includedPlayers.size} players
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.minutes, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatNumber(teamAverage.fg_percentage * 100)}%</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatNumber(teamAverage.ft_percentage * 100)}%</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.three_pm, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.reb, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.ast, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.stl, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.blk, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{formatStat(teamAverage.pts, showAverages ? 1 : teamAverage.gp)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-900">{teamAverage.gp}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default TeamDetail