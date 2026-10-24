import { useParams, useNavigate } from 'react-router'
import { useState, useMemo, useEffect } from 'react'
import React from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useGetTeamDetailQuery, useGetLeagueSummaryQuery, useGetMatchupsTodayQuery, useGetScheduleQuery } from '../store/api/fantasyApi'
import type { TimePeriod, PlayerMatchup, CustomDateRange, PlayerStatKey } from '../types/api'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import DataDateBadge from '../components/DataDateBadge'
import { aggregatePlayerAverages } from '../utils/statsUtils'
import { MatchupCell, MatchupExpandRow } from '../components/MatchupDisplay'
import InjuryBadge from '../components/InjuryBadge'
import SlotUsageTable from '../components/SlotUsageTable'
import PlayerNameLink from '../components/PlayerNameLink'
import RosterCoverage from '../components/RosterCoverage'
import { MyTeamMark } from '../components/MyTeamMark'
import { nameCellWrapClass, wrapFriendlyName } from '../utils/wrapName'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { TeamShareCard } from '../components/share/TeamShareCard'
import { formatAsOf } from '../components/share/shareCardFormat'
import { orderCategories } from '../utils/statOrder'
import { StatsScheduleToggle, ScheduleHorizonToggle, WeekDayHeading, WeekOpponent, type PlayerTableMode, type ScheduleHorizon } from '../components/PlayerWeekColumns'
import { easternToday, opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays, type WeekScheduleDay } from '../utils/slateWindow'

// FG%/FT% are shown in the Shot Chart Stats block instead (fixed shooting
// stats, unrelated to the league's configured scoring categories).
const PERCENTAGE_CATEGORIES = new Set(['FG%', 'FT%'])

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  PTS: 'Points',
  REB: 'Rebounds',
  AST: 'Assists',
  STL: 'Steals',
  BLK: 'Blocks',
  '3PM': '3-Pointers',
  TO: 'Turnovers',
}

const TIME_PERIODS: readonly TimePeriod[] = ['season', 'last_7', 'last_15', 'last_30', 'custom']

const TEAM_DETAIL_URL_SCHEMA = {
  period: enumParam<TimePeriod>(TIME_PERIODS, 'season'),
  from: isoDateParam(),
  to: isoDateParam(),
  // Default to ESPN lineup order (PG, SG, SF, PF, C, G, F, UTIL, BE, IR).
  sort: stringParam('lineup_slot'),
  order: enumParam(['asc', 'desc'] as const, 'asc'),
}

const TeamDetail = () => {
  const { teamId } = useParams<{ teamId: string }>()
  const navigate = useNavigate()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const [urlState, setUrlState] = useUrlState(TEAM_DETAIL_URL_SCHEMA)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(urlState.period)
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(() =>
    urlState.from && urlState.to ? { start: urlState.from, end: urlState.to } : null
  )
  const { data: team_detail, error, isLoading } = useGetTeamDetailQuery({
    teamId: teamIdNumber,
    time_period: timePeriod,
    ...(timePeriod === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  })
  const { data: leagueSummary } = useGetLeagueSummaryQuery()

  useEffect(() => {
    if (timePeriod !== 'custom' || !customRange || !team_detail?.players) return
    const excluded = team_detail.players.filter(p => p.has_data === false)
    if (excluded.length > 0) {
      console.warn(
        `${excluded.length} players excluded (no data for ${customRange.start}–${customRange.end}):`,
        excluded.map(p => p.player_name)
      )
    }
  }, [timePeriod, customRange, team_detail])
  const [sortBy, setSortBy] = useState<string | null>(urlState.sort || null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(urlState.order)

  const isCustom = timePeriod === 'custom' && customRange !== null
  useEffect(() => {
    setUrlState({
      period: timePeriod,
      from: isCustom ? customRange.start : '',
      to: isCustom ? customRange.end : '',
      sort: sortBy ?? '',
      order: sortOrder,
    })
  }, [setUrlState, timePeriod, isCustom, customRange, sortBy, sortOrder])
  const [showAverages, setShowAverages] = usePersistedState('teamDetail.showAverages', true)
  const [tableMode, setTableMode] = useState<PlayerTableMode>('stats')
  const [scheduleHorizon, setScheduleHorizon] = useState<ScheduleHorizon>(7)
  const [coverageDate, setCoverageDate] = useState<string | null>(null)
  const [activeCoverageDate, setActiveCoverageDate] = useState<string | null>(null)
  const showSchedule = tableMode === 'schedule'
  const { data: schedule } = useGetScheduleQuery()
  const weekDays = useMemo(() => weekScheduleDays(easternToday(), scheduleHorizon), [scheduleHorizon])
  const opponents = useMemo(
    () => (schedule ? opponentsByTeamDate(schedule) : new Map<string, string>()),
    [schedule],
  )
  const [integerMode, setIntegerMode] = usePersistedState('teamDetail.integerMode', true)
  const [includedPlayers, setIncludedPlayers] = useState<Set<string> | null>(null)
  const coverageSlate = !showSchedule && coverageDate ? coverageDate.replaceAll('-', '') : undefined
  const { data: liveMatchups = [] } = useGetMatchupsTodayQuery(undefined, { skip: !!coverageSlate })
  const { currentData: datedMatchups } = useGetMatchupsTodayQuery(coverageSlate, {
    skip: !coverageSlate,
  })
  const datedMatchupReady = datedMatchups !== undefined
  const matchupMap = useMemo(() => {
    const matchupRows = coverageSlate && datedMatchupReady ? datedMatchups ?? [] : liveMatchups
    return new Map(matchupRows.map((m: PlayerMatchup) => [m.player_name, m]))
  }, [coverageSlate, datedMatchupReady, datedMatchups, liveMatchups])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const toggleExpand = (name: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

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

  const visiblePlayers = useMemo(
    () => team_detail?.players?.filter(p => p.has_data !== false) ?? [],
    [team_detail]
  )

  const togglePlayerInclusion = (playerName: string) => {
    setIncludedPlayers(prev => {
      const allNames = visiblePlayers.map(p => p.player_name)
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
    if (!visiblePlayers.length) return
    const allIncluded = includedPlayers === null || includedPlayers.size === visiblePlayers.length
    setIncludedPlayers(allIncluded ? new Set() : null)
  }

  const formatNumber = (num: number) => num.toFixed(2)

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
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load team details')} />
  if (!team_detail) return <ErrorMessage message="Team not found" />

  // This league's actual scoring categories, in order, excluding percentages
  // (shown separately in Shot Chart Stats) — sourced from the API response
  // rather than a hardcoded list.
  const perGameCategories = orderCategories(Object.keys(team_detail.category_ranks)
    .filter(key => !PERCENTAGE_CATEGORIES.has(key)))

  const statColumns = [
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
  const dayColumns = weekDays.map(day => ({
    key: `day:${day.date}`,
    label: day.weekday,
    align: 'center',
    sortable: false,
    day,
  }))
  const columns: {
    key: string
    label: string
    align: string
    sortable: boolean
    day?: WeekScheduleDay
  }[] = [
    { key: 'lineup_slot', label: 'Slot', align: 'left', sortable: true },
    ...(!showSchedule ? [{ key: 'include', label: 'Include', align: 'center', sortable: false }] : []),
    { key: 'player_name', label: 'Player', align: 'left', sortable: true },
    { key: 'positions', label: 'Position', align: 'left', sortable: true },
    { key: 'pro_team', label: 'Pro Team', align: 'left', sortable: true },
    ...(showSchedule ? [...dayColumns, { key: 'week_games', label: 'Games', align: 'center', sortable: true }] : statColumns),
    ...(!showSchedule ? [{ key: 'matchup', label: 'Matchup', align: 'left', sortable: false }] : []),
  ]

  const getPositionOrder = (positions: string[]): number => {
    const positionRank = { 'PG': 1, 'SG': 2, 'SF': 3, 'PF': 4, 'C': 5 }
    const firstPos = positions[0]
    return positionRank[firstPos as keyof typeof positionRank] ?? 99
  }

  // ESPN lineup order: starters, flex, UTIL, then bench and IR.
  const lineupSlotOrder = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'SG/SF', 'G/F', 'PF/C', 'F/C', 'UTIL', 'BE', 'IR']
  const getLineupSlotOrder = (slot?: string | null): number => {
    const idx = slot ? lineupSlotOrder.indexOf(slot) : -1
    return idx === -1 ? 99 : idx
  }

  const allPlayers = team_detail.players ?? []

  const sortedPlayers = sortBy === null
    ? allPlayers
    : [...allPlayers].sort((a, b) => {
        let aVal: string | number | null
        let bVal: string | number | null

        if (sortBy === 'player_name') {
          aVal = a.player_name
          bVal = b.player_name
        } else if (sortBy === 'lineup_slot') {
          const diff = getLineupSlotOrder(a.lineup_slot) - getLineupSlotOrder(b.lineup_slot)
          return sortOrder === 'asc' ? diff : -diff
        } else if (sortBy === 'positions') {
          const aPosOrder = getPositionOrder(a.positions)
          const bPosOrder = getPositionOrder(b.positions)
          return sortOrder === 'asc' ? aPosOrder - bPosOrder : bPosOrder - aPosOrder
        } else if (sortBy === 'pro_team') {
          aVal = a.pro_team
          bVal = b.pro_team
        } else if (sortBy === 'week_games') {
          aVal = weekGameCount(opponents, a.pro_team, weekDays)
          bVal = weekGameCount(opponents, b.pro_team, weekDays)
        } else {
          const aStat = a.stats[sortBy as PlayerStatKey] ?? -1
          const bStat = b.stats[sortBy as PlayerStatKey] ?? -1
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
    const includedPlayers = visiblePlayers.filter(p => isPlayerIncluded(p.player_name))

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
      case 'custom': return 'Custom'
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-gray-900">
              {team_detail.team.team_name}
              <MyTeamMark teamId={team_detail.team.team_id} />
            </h1>
            <DataDateBadge dataDate={team_detail.data_date} />
          </div>
          <div className="flex items-center gap-2">
            <ShareCardButton
              title={`${team_detail.team.team_name} Report`}
              renderCard={({ dark }) => {
                const points = team_detail.category_ranks
                const teamCount = leagueSummary?.total_teams ?? Math.max(...Object.values(points), 1)
                return (
                  <TeamShareCard
                    dark={dark}
                    teamName={team_detail.team.team_name}
                    rank={team_detail.ranking_stats.rank ?? 0}
                    totalPoints={team_detail.ranking_stats.total_points}
                    teamCount={teamCount}
                    categories={orderCategories(Object.keys(points)).map(category => ({
                      category,
                      points: points[category],
                      value: team_detail.ranking_stats.stats?.[category] ?? team_detail.raw_averages.stats?.[category],
                    }))}
                    gp={team_detail.raw_averages.gp}
                    asOf={formatAsOf(team_detail.data_date)}
                  />
                )
              }}
            />
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
                <span>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({(team_detail.shot_chart.fg_percentage * 100).toFixed(2)}%)</span>
              </div>
              <div className="flex justify-between">
                <span>Free Throws:</span>
                <span>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({(team_detail.shot_chart.ft_percentage * 100).toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Per-Game Averages</h2>
            <div className="space-y-3">
              {perGameCategories.map(key => (
                <div className="flex justify-between" key={key}>
                  <span>{CATEGORY_DISPLAY_NAMES[key] ?? key}:</span>
                  <span>{(team_detail.raw_averages.stats?.[key] ?? 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {team_detail.slot_usage && Object.keys(team_detail.slot_usage).length > 0 && (
        <SlotUsageTable
          slotUsage={team_detail.slot_usage}
          avgPace={leagueSummary?.nba_avg_pace}
          gameDaysLeft={leagueSummary?.nba_game_days_left}
          gameDaysElapsed={leagueSummary?.nba_game_days_elapsed}
        />
      )}
      <RosterCoverage
        players={team_detail.players ?? []}
        teamId={teamIdNumber}
        horizon={scheduleHorizon}
        onHorizonChange={setScheduleHorizon}
        onSelectDate={setCoverageDate}
        onActiveDate={setActiveCoverageDate}
      />

      <div className="bg-white rounded-lg shadow p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Roster</h2>
          {!team_detail.players && (
            <p className="text-sm text-gray-500 italic">Player data unavailable</p>
          )}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <div className="order-1 w-full sm:order-3 sm:w-auto">
                <StatsScheduleToggle mode={tableMode} onChange={setTableMode} />
              </div>
              {!showSchedule && (
                <div className="order-2 flex w-full overflow-hidden rounded border border-gray-300 sm:order-2 sm:w-auto">
                  <button
                    className={`flex-1 border-r border-gray-300 px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 sm:flex-none ${showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setShowAverages(true)}
                  >
                    Per Game
                  </button>
                  <button
                    className={`flex-1 px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 sm:flex-none ${!showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => setShowAverages(false)}
                  >
                    Totals
                  </button>
                </div>
              )}
              {!showSchedule && (
                <label className="order-3 flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none sm:order-1">
                  <input type="checkbox" checked={integerMode} onChange={(e) => setIntegerMode(e.target.checked)} />
                  Integer projections
                </label>
              )}
            </div>
            {!showSchedule ? (
              <div className="w-full sm:flex sm:justify-end">
                <TimePeriodSelector
                  value={timePeriod}
                  onChange={setTimePeriod}
                  customRange={customRange}
                  onCustomRangeChange={setCustomRange}
                />
              </div>
            ) : (
              <div className="w-full sm:flex sm:justify-end">
                <ScheduleHorizonToggle value={scheduleHorizon} onChange={setScheduleHorizon} />
              </div>
            )}
          </div>
        </div>
        {!showSchedule && timePeriod === 'custom' && customRange && (
          <CoverageNotice
            requestedStart={customRange.start}
            requestedEnd={customRange.end}
            actualStart={team_detail.actual_start}
            actualEnd={team_detail.actual_end}
          />
        )}
        {!team_detail.players ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            Roster data is currently unavailable. Team stats above are from the last known snapshot.
          </div>
        ) : (
        <div className="overflow-auto max-h-[70vh] mq-scroll-container">
          <table className="min-w-full border-separate border-spacing-0 [&_th]:border-b [&_td]:border-b [&_th]:border-gray-200 [&_td]:border-gray-200">
            <thead className="sticky top-0 z-20 bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => column.sortable !== false && handleSort(column.key)}
                    className={`px-4 py-3 text-${column.align} text-xs font-medium text-gray-500 uppercase tracking-wider ${
                      column.sortable !== false ? 'cursor-pointer hover:bg-gray-100' : ''
                    } transition-colors duration-150 ${
                      column.key === 'player_name' ? 'sticky left-0 z-10 bg-gray-50 border-r border-r-gray-200' : ''
                    } ${
                      showSchedule && column.day?.date === activeCoverageDate ? 'bg-blue-100' : ''
                    }`}
                  >
                    {column.key === 'include' ? (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="text-xs font-medium text-gray-500 uppercase">Include</span>
                        <input
                          type="checkbox"
                          checked={includedPlayers === null || includedPlayers.size === visiblePlayers.length}
                          onChange={toggleAllPlayers}
                          className="w-4 h-4 text-blue-600 cursor-pointer"
                          title="Toggle all players"
                        />
                      </div>
                    ) : 'day' in column && column.day ? (
                      <div className="flex items-center justify-center">
                        <WeekDayHeading day={column.day} />
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
            <tbody className="bg-white">
              {sortedPlayers.map((player, idx) => {
                const awaitingCoverageMatchup = !!coverageSlate && !datedMatchupReady
                const matchup = awaitingCoverageMatchup ? undefined : matchupMap.get(player.player_name)
                const coverageOpponent = coverageDate ? weekOpponent(opponents, player.pro_team, coverageDate) : undefined
                const isExpanded = expandedRows.has(player.player_name)
                const noData = player.has_data === false
                return (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">
                        {player.lineup_slot === 'IR' ? (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-200" title="Injured reserve">IR</span>
                        ) : player.lineup_slot && player.lineup_slot !== 'BE' ? (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-400/40" title="Active lineup slot">{player.lineup_slot}</span>
                        ) : (player.lineup_slot ?? '—')}
                      </td>
                      {!showSchedule && (
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <input
                          type="checkbox"
                          checked={!noData && isPlayerIncluded(player.player_name)}
                          disabled={noData}
                          onChange={() => togglePlayerInclusion(player.player_name)}
                          className="w-4 h-4 text-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          title={noData ? 'Excluded from average — no data for this range' : undefined}
                        />
                      </td>
                      )}
                      <td className={`px-4 py-3 ${nameCellWrapClass(player.player_name)} text-sm font-medium text-gray-900 sticky left-0 z-10 bg-white border-r border-r-gray-200`}><PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} /> <InjuryBadge status={matchup?.injury_status} /></td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{player.positions.join(', ')}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{player.pro_team}</td>
                      {showSchedule ? (
                        <>
                          {weekDays.map(day => (
                            <td
                              key={day.date}
                              className={`px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900 ${day.date === activeCoverageDate ? 'bg-blue-100' : ''}`}
                            >
                              <WeekOpponent opponent={weekOpponent(opponents, player.pro_team, day.date)} />
                            </td>
                          ))}
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-gray-900">
                            {weekGameCount(opponents, player.pro_team, weekDays)}
                          </td>
                        </>
                      ) : noData ? (
                        <td
                          className="px-4 py-3 text-center italic text-gray-400"
                          colSpan={10}
                          title="Not available for a custom range — try Last 7/15/30/Season"
                        >
                          No data for this range
                        </td>
                      ) : (
                        <>
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
                        </>
                      )}
                      {!showSchedule && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {awaitingCoverageMatchup ? (
                            coverageOpponent
                              ? <span className="mq-opp">vs {coverageOpponent}</span>
                              : <span className="mq-no-game">—</span>
                          ) : (
                            <MatchupCell
                              matchup={matchup}
                              isExpanded={isExpanded}
                              onToggle={() => toggleExpand(player.player_name)}
                              playerStats={player.stats}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                    {!showSchedule && isExpanded && matchup && (
                      <MatchupExpandRow matchup={matchup} colSpan={columns.length} integerMode={integerMode} onCollapse={() => toggleExpand(player.player_name)} />
                    )}
                  </React.Fragment>
                )
              })}
              <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 font-bold [&_td]:border-t-2 [&_td]:border-t-blue-400 [&_td]:border-b-0">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                {!showSchedule && (
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <span className="text-blue-600">-</span>
                  </td>
                )}
                <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-900 sticky left-0 z-10 bg-gradient-to-r from-blue-50 to-indigo-50 border-r border-r-gray-200">
                  {showAverages ? 'Avg' : 'Total'} ({getTimePeriodLabel()})
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">
                  {showSchedule || includedPlayers === null ? visiblePlayers.length : includedPlayers.size} players
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700">-</td>
                {showSchedule ? (
                  <>
                    {weekDays.map(day => (
                      <td key={day.date} className={`px-4 py-3 whitespace-nowrap text-sm text-blue-900 ${day.date === activeCoverageDate ? 'bg-blue-100' : ''}`} />
                    ))}
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-900" />
                  </>
                ) : (
                  <>
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
                  </>
                )}
                {!showSchedule && <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-900">—</td>}
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  )
}

export default TeamDetail
