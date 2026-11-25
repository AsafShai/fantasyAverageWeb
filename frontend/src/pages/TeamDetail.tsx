import { useParams } from 'react-router'
import { useState, useMemo, useEffect } from 'react'
import React from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useGetTeamDetailQuery, useGetLeagueSummaryQuery, useGetMatchupsTodayQuery, useGetScheduleQuery, useGetTeamRosterDayQuery } from '../store/api/fantasyApi'
import type { TimePeriod, PlayerMatchup, CustomDateRange, PlayerStatKey } from '../types/api'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import DataDateBadge from '../components/DataDateBadge'
import LiveBadge from '../components/live/LiveBadge'
import { useLiveQuery } from '../hooks/useLiveQuery'
import { liveSectionNote, slotTonightNote, startersNote, tonightGp, tonightPoints } from '../utils/live'
import { aggregatePlayerAverages } from '../utils/statsUtils'
import InjuryBadge from '../components/InjuryBadge'
import SlotUsageTable from '../components/SlotUsageTable'
import PlayerNameLink from '../components/PlayerNameLink'
import RosterCoverage from '../components/RosterCoverage'
import { nameCellWrapClass, wrapFriendlyName } from '../utils/wrapName'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { TeamShareCard } from '../components/share/TeamShareCard'
import { formatAsOf } from '../components/share/shareCardFormat'
import { orderCategories } from '../utils/statOrder'
import { StatsScheduleToggle, ScheduleHorizonToggle, WeekDayHeading, WeekOpponent, type PlayerTableMode, type ScheduleHorizon } from '../components/PlayerWeekColumns'
import { RosterDayContent, RosterDayOnlyPlayedToggle, RosterDayStepper, SlotPill } from '../components/RosterDayView'
import NoSpoilersSwitch from '../components/boxScores/NoSpoilersSwitch'
import { lineupSlotOrder, rosterDayCanFilterPlayed, rosterDayNote } from '../utils/rosterDay'
import { easternToday, formatSlateDate, isBackToBackGameDay, opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays, type WeekScheduleDay } from '../utils/slateWindow'
import { rosterScheduleCellClass } from '../utils/rosterScheduleTone'
import BackToBackMark from '../components/BackToBackMark'
import { useMobileRedesign } from '../mobile/flag'
import MobileTeamDetail from '../mobile/team/MobileTeamDetail'
import { TEAM_TABS, type TeamTab } from '../mobile/team/types'
import { ManagerHintsTeamSection } from '../components/hints/ManagerHintsCard'
import { TeamScoreboard } from '../components/team/TeamScoreboard'
import '../mobile/team/team.css'

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
  // Roster table mode; Daily (roster by day) is the default.
  mode: enumParam<PlayerTableMode>(['daily', 'stats', 'schedule'], 'daily'),
  // Daily mode's day; empty = today.
  day: isoDateParam(),
  // Phone layout's tab (mobile redesign); desktop shows every section at once.
  tab: enumParam<TeamTab>(TEAM_TABS, 'stats'),
}

const TeamDetail = () => {
  const { teamId } = useParams<{ teamId: string }>()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const mobileRedesign = useMobileRedesign()
  const [urlState, setUrlState] = useUrlState(TEAM_DETAIL_URL_SCHEMA)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(urlState.period)
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(() =>
    urlState.from && urlState.to ? { start: urlState.from, end: urlState.to } : null
  )
  const { data: team_detail, error, isLoading } = useLiveQuery(useGetTeamDetailQuery, {
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
  const [tableMode, setTableMode] = useState<PlayerTableMode>(urlState.mode)
  // '' = today (kept out of the URL so a shared link always opens on the current day).
  const [rosterDate, setRosterDate] = useState<string>(urlState.day)
  const [mobileTab, setMobileTab] = useState<TeamTab>(urlState.tab)

  const isCustom = timePeriod === 'custom' && customRange !== null
  useEffect(() => {
    setUrlState({
      period: timePeriod,
      from: isCustom ? customRange.start : '',
      to: isCustom ? customRange.end : '',
      sort: sortBy ?? '',
      order: sortOrder,
      mode: tableMode,
      day: tableMode === 'daily' ? rosterDate : '',
      tab: mobileRedesign ? mobileTab : 'stats',
    })
  }, [setUrlState, timePeriod, isCustom, customRange, sortBy, sortOrder, tableMode, rosterDate, mobileRedesign, mobileTab])
  const [showAverages, setShowAverages] = usePersistedState('teamDetail.showAverages', true)
  const [rosterDayOnlyPlayed, setRosterDayOnlyPlayed] = usePersistedState('teamDetail.rosterDayOnlyPlayed', false)
  const [scheduleHorizon, setScheduleHorizon] = useState<ScheduleHorizon>(7)
  const [coverageDate, setCoverageDate] = useState<string | null>(null)
  const [, setActiveCoverageDate] = useState<string | null>(null)
  /** Which day is "in focus" in Schedule roster mode (who plays / column emphasis). */
  const [scheduleFocusDate, setScheduleFocusDate] = useState<string | null>(null)
  const showSchedule = tableMode === 'schedule'
  const showDaily = tableMode === 'daily'
  const showStats = tableMode === 'stats'
  const today = easternToday()
  const {
    currentData: rosterDay,
    isFetching: rosterDayFetching,
    error: rosterDayError,
  } = useLiveQuery(
    useGetTeamRosterDayQuery,
    { teamId: teamIdNumber, ...(rosterDate ? { date: rosterDate } : {}) },
    { skip: !showDaily || !teamIdNumber },
  )
  // Shared with Box Scores: hides results, scores and live lines in Daily.
  const [spoilerSetting, setNoSpoilers] = usePersistedState('boxScores.noSpoilers', false)
  // No spoilers only matters for today: a past day is already over, so it always shows results.
  const rosterIsToday = rosterDay ? rosterDay.is_today : !rosterDate
  const noSpoilers = spoilerSetting && rosterIsToday
  const rosterPlayedFilter = Boolean(rosterDay && rosterDayCanFilterPlayed(rosterDay, noSpoilers))
  const changeRosterDate = (date: string) => setRosterDate(date >= (rosterDay?.last_date ?? today) ? '' : date)
  const { data: schedule } = useGetScheduleQuery()
  const weekDays = useMemo(() => weekScheduleDays(easternToday(), scheduleHorizon), [scheduleHorizon])
  useEffect(() => {
    if (!showSchedule) return
    const dates = weekDays.map(d => d.date)
    if (dates.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing; syncs state to a changed input, refactor separately
    setScheduleFocusDate(prev => {
      if (prev && dates.includes(prev)) return prev
      if (coverageDate && dates.includes(coverageDate)) return coverageDate
      return dates[0]
    })
  }, [showSchedule, scheduleHorizon, weekDays, coverageDate])
  const scheduleSpotlightDate = scheduleFocusDate ?? weekDays[0]?.date ?? null
  const opponents = useMemo(
    () => (schedule ? opponentsByTeamDate(schedule) : new Map<string, string>()),
    [schedule],
  )
  const [includedPlayers, setIncludedPlayers] = useState<Set<string> | null>(null)
  const coverageSlate = showStats && coverageDate ? coverageDate.replaceAll('-', '') : undefined
  const { data: liveMatchups = [] } = useGetMatchupsTodayQuery(undefined, { skip: !!coverageSlate })
  const { currentData: datedMatchups } = useGetMatchupsTodayQuery(coverageSlate, {
    skip: !coverageSlate,
  })
  const datedMatchupReady = datedMatchups !== undefined
  const matchupMap = useMemo(() => {
    const matchupRows = coverageSlate && datedMatchupReady ? datedMatchups ?? [] : liveMatchups
    return new Map(matchupRows.map((m: PlayerMatchup) => [m.player_name, m]))
  }, [coverageSlate, datedMatchupReady, datedMatchups, liveMatchups])
  // The route keeps this page mounted when it moves to another team (the header's
  // My team link, back/forward), so the roster selection resets with the team:
  // a set of the previous roster's names would leave every new player unchecked.
  const [rosterTeamId, setRosterTeamId] = useState(teamIdNumber)
  if (rosterTeamId !== teamIdNumber) {
    setRosterTeamId(teamIdNumber)
    setIncludedPlayers(null)
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

  const scheduleSpotlightRows = useMemo(() => {
    const rosterPlayers = team_detail?.players ?? []
    if (!showSchedule || !scheduleSpotlightDate || rosterPlayers.length === 0) return []
    return [...rosterPlayers]
      .filter(p => !!weekOpponent(opponents, p.pro_team, scheduleSpotlightDate))
      .sort((a, b) => lineupSlotOrder(a.lineup_slot) - lineupSlotOrder(b.lineup_slot))
  }, [showSchedule, scheduleSpotlightDate, team_detail, opponents])

  const scheduleSummaryHeading = scheduleSpotlightDate
    ? `${formatSlateDate(scheduleSpotlightDate, { weekday: 'long', month: 'short', day: 'numeric' })}`
    : ''

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
    ...(!showSchedule ? [{ key: 'injury_status', label: 'Status', align: 'left', sortable: false }] : []),
    { key: 'positions', label: 'Position', align: 'left', sortable: true },
    { key: 'pro_team', label: 'Pro Team', align: 'left', sortable: true },
    ...(showSchedule ? [...dayColumns, { key: 'week_games', label: 'Games', align: 'center', sortable: true }] : statColumns),
    /** Matchup when not in Stats (like roster table); not on multi-day Schedule grid. */
    ...(!showSchedule && !showStats ? [{ key: 'matchup', label: 'Matchup', align: 'left', sortable: false }] : []),
  ]

  const getPositionOrder = (positions: string[]): number => {
    const positionRank = { 'PG': 1, 'SG': 2, 'SF': 3, 'PF': 4, 'C': 5 }
    const firstPos = positions[0]
    return positionRank[firstPos as keyof typeof positionRank] ?? 99
  }

  const getLineupSlotOrder = lineupSlotOrder

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

  const statsNoDataColSpan = statColumns.length

  /** ESPN lineup order (same as default URL schema). */
  const resetStatsSort = () => {
    setSortBy('lineup_slot')
    setSortOrder('asc')
  }

  const showStatsSortReset =
    showStats && !(sortBy === 'lineup_slot' && sortOrder === 'asc')

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
  const statsLive = liveSectionNote(team_detail.live, 'stats')
  const rosterSubtitle =
    tableMode === 'daily'
      ? rosterDay
        ? rosterDayNote(rosterDay, undefined, noSpoilers)
        : rosterDayFetching
          ? 'Loading day…'
          : 'Daily roster'
      : tableMode === 'stats'
        ? `${getTimePeriodLabel()} · ${showAverages ? 'Per game' : 'Totals'}`
        : `Next ${scheduleHorizon} days`

  const shareCardRender = ({ dark }: { dark: boolean }) => {
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
        live={team_detail.live}
      />
    )
  }

  const slotsLive = liveSectionNote(team_detail.live, 'slots')
  const gpTonight = tonightGp(team_detail.live, team_detail.tonight)
  const pointsTonight = tonightPoints(team_detail.live, team_detail.tonight)
  const playingNote = startersNote(team_detail.live, team_detail.tonight)
  const slotTonight = (slot: string) => slotTonightNote(team_detail.live, team_detail.tonight, slot)
  const slotUsageBase =
    typeof leagueSummary?.nba_game_days_left === 'number'
      ? `${leagueSummary.nba_game_days_left} game days left${typeof leagueSummary?.nba_avg_pace === 'number' ? ` · NBA pace ${leagueSummary.nba_avg_pace.toFixed(1)}` : ''}`
      : undefined
  const slotUsageSubtitle = slotsLive ? [slotUsageBase, slotsLive].filter(Boolean).join(' · ') : slotUsageBase
  const teamCount = leagueSummary?.total_teams ?? Math.max(...Object.values(team_detail.category_ranks), 1)

  if (mobileRedesign) {
    const awaitingCoverageMatchup = !!coverageSlate && !datedMatchupReady
    return (
      <MobileTeamDetail
        team={team_detail}
        teamCount={teamCount}
        espnUpdatedAt={leagueSummary?.espn_updated_at}
        shareCard={shareCardRender}
        perGameCategories={perGameCategories}
        categoryNames={CATEGORY_DISPLAY_NAMES}
        tab={mobileTab}
        onTab={setMobileTab}
        mode={tableMode}
        onMode={setTableMode}
        rosterDay={rosterDay}
        rosterDayFetching={rosterDayFetching}
        rosterDayError={rosterDayError}
        rosterDayDate={rosterDate || rosterDay?.date || today}
        rosterDayLast={rosterDay?.last_date ?? today}
        onRosterDate={changeRosterDate}
        rosterDayOnlyPlayed={rosterDayOnlyPlayed}
        onRosterDayOnlyPlayed={setRosterDayOnlyPlayed}
        noSpoilers={noSpoilers}
        onNoSpoilers={setNoSpoilers}
        matchups={matchupMap}
        matchupsPending={awaitingCoverageMatchup}
        timePeriod={timePeriod}
        onTimePeriod={setTimePeriod}
        customRange={customRange}
        onCustomRange={setCustomRange}
        seasonStart={leagueSummary?.season_start}
        periodLabel={getTimePeriodLabel()}
        showAverages={showAverages}
        onShowAverages={setShowAverages}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        showSortReset={showStatsSortReset}
        onResetSort={resetStatsSort}
        players={sortedPlayers}
        statColumns={statColumns}
        formatStat={formatStat}
        isIncluded={isPlayerIncluded}
        onToggleIncluded={togglePlayerInclusion}
        allIncluded={includedPlayers === null || includedPlayers.size === visiblePlayers.length}
        onToggleAll={toggleAllPlayers}
        includedCount={includedPlayers === null ? visiblePlayers.length : includedPlayers.size}
        teamAverage={teamAverage as unknown as Record<string, number>}
        weekDays={weekDays}
        horizon={scheduleHorizon}
        onHorizon={setScheduleHorizon}
        focusDate={scheduleSpotlightDate}
        onFocusDate={setScheduleFocusDate}
        opponentOn={(proTeam, date) => weekOpponent(opponents, proTeam, date)}
        isBackToBackOn={(proTeam, date) => isBackToBackGameDay(opponents, proTeam, date)}
        gamesIn={proTeam => weekGameCount(opponents, proTeam, weekDays)}
        whoPlays={scheduleSpotlightRows}
        whoPlaysHeading={scheduleSummaryHeading}
        slotMeta={slotUsageSubtitle && <span className="mr-meta">{slotUsageSubtitle}</span>}
        slotUsageNode={
          <SlotUsageTable
            embedded
            slotUsage={team_detail.slot_usage}
            avgPace={leagueSummary?.nba_avg_pace}
            gameDaysLeft={leagueSummary?.nba_game_days_left}
            gameDaysElapsed={leagueSummary?.nba_game_days_elapsed}
            tonightNote={slotTonight}
          />
        }
        coverageDate={showSchedule ? scheduleSpotlightDate : coverageDate}
        onCoverageDate={date => {
          setCoverageDate(date)
          setScheduleFocusDate(date)
        }}
      />
    )
  }
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`
  return (
    <div className="mr-root mr-page mr-tm-page mr-tm-desk">
      <TeamScoreboard
        teamId={team_detail.team.team_id}
        teamName={team_detail.team.team_name}
        rank={team_detail.ranking_stats.rank}
        totalPoints={team_detail.ranking_stats.total_points}
        gp={team_detail.raw_averages.gp}
        teamCount={teamCount}
        categories={team_detail.category_ranks}
        espnUrl={team_detail.espn_url}
        share={<ShareCardButton title={`${team_detail.team.team_name} Report`} renderCard={shareCardRender} />}
        badge={team_detail.data_date
          ? <DataDateBadge dataDate={team_detail.data_date} />
          : <LiveBadge live={team_detail.live} espnUpdatedAt={leagueSummary?.espn_updated_at} align="left" />}
        pointsTonight={pointsTonight}
        pointsDown={(team_detail.tonight?.points ?? 0) < 0}
        gpTonight={gpTonight}
        playingNote={playingNote}
        liveNote={statsLive}
      />
      <ManagerHintsTeamSection teamId={teamIdNumber} layout="desktop" teamDetail={team_detail} />
      <div className="mr-tm-context">
        <section className="mr-tm-panel mr-tm-shoot" aria-label="Team statistics">
          <h2>Shooting and averages</h2>
          <div className="mr-tm-shoot-body">
            <p className="mr-tm-subhead">Shot chart</p>
            <dl className="mr-tm-kvs" style={{ flexGrow: 8 }}>
              <div><dt>Field goals</dt><dd>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({pct(team_detail.shot_chart.fg_percentage)})</dd></div>
              <div><dt>Free throws</dt><dd>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({pct(team_detail.shot_chart.ft_percentage)})</dd></div>
              <div><dt>FGM</dt><dd>{team_detail.shot_chart.fgm}</dd></div>
              <div><dt>FGA</dt><dd>{team_detail.shot_chart.fga}</dd></div>
              <div><dt>FG%</dt><dd>{pct(team_detail.shot_chart.fg_percentage)}</dd></div>
              <div><dt>FTM</dt><dd>{team_detail.shot_chart.ftm}</dd></div>
              <div><dt>FTA</dt><dd>{team_detail.shot_chart.fta}</dd></div>
              <div><dt>FT%</dt><dd>{pct(team_detail.shot_chart.ft_percentage)}</dd></div>
            </dl>
            <p className="mr-tm-subhead">Per game</p>
            <dl className="mr-tm-kvs" style={{ flexGrow: Math.max(perGameCategories.length, 1) }}>
              {perGameCategories.map(key => (
                <div key={key}><dt>{CATEGORY_DISPLAY_NAMES[key] ?? key}</dt><dd>{(team_detail.raw_averages.stats?.[key] ?? 0).toFixed(2)}</dd></div>
              ))}
            </dl>
          </div>
        </section>
        {team_detail.slot_usage && Object.keys(team_detail.slot_usage).length > 0 && (
          <section className="mr-tm-panel" id="slot-usage" aria-label="Slot usage">
            <h2>Slot usage</h2>
            {slotUsageSubtitle && <p className="mr-meta">{slotUsageSubtitle}</p>}
            <SlotUsageTable
              embedded
              slotUsage={team_detail.slot_usage}
              avgPace={leagueSummary?.nba_avg_pace}
              gameDaysLeft={leagueSummary?.nba_game_days_left}
              gameDaysElapsed={leagueSummary?.nba_game_days_elapsed}
              tonightNote={slotTonight}
            />
          </section>
        )}
        <section className="mr-tm-panel" aria-label="Roster coverage">
          <RosterCoverage
            embedded
            players={team_detail.players ?? []}
            teamId={teamIdNumber}
            horizon={scheduleHorizon}
            onHorizonChange={setScheduleHorizon}
            externalSelectedDate={showSchedule ? scheduleSpotlightDate : null}
            onSelectDate={date => {
              setCoverageDate(date)
              setScheduleFocusDate(date)
            }}
            onActiveDate={setActiveCoverageDate}
          />
        </section>
      </div>

      <section className="mr-tm-panel mr-tm-roster" aria-label="Roster">
      <div>
        <div className="mr-tm-roster-bar">
          <div>
            <h2>Roster</h2>
            <p className="mr-meta">{rosterSubtitle}</p>
          </div>
          {!team_detail.players && (
            <p className="mr-meta">Player data unavailable</p>
          )}
          <StatsScheduleToggle mode={tableMode} onChange={setTableMode} includeDaily variant="segmented" />
        </div>
        <div className="mr-tm-roster-tools">
          {showDaily ? (
            <>
              {rosterIsToday && <NoSpoilersSwitch on={noSpoilers} onChange={setNoSpoilers} />}
              {rosterPlayedFilter && (
                <RosterDayOnlyPlayedToggle checked={rosterDayOnlyPlayed} onChange={setRosterDayOnlyPlayed} />
              )}
              <RosterDayStepper
                date={rosterDate || rosterDay?.date || today}
                firstDate={rosterDay?.first_date}
                lastDate={rosterDay?.last_date ?? today}
                note={rosterDay && !rosterDayFetching ? rosterDayNote(rosterDay, undefined, noSpoilers) : rosterDayFetching ? 'Loading this day…' : undefined}
                onChange={changeRosterDate}
              />
            </>
          ) : showStats ? (
            <>
              <div className="mr-seg mr-sm mr-fit" role="group" aria-label="Stat basis">
                <button type="button" className="mr-seg-btn" aria-pressed={showAverages} onClick={() => setShowAverages(true)}>Per Game</button>
                <button type="button" className="mr-seg-btn" aria-pressed={!showAverages} onClick={() => setShowAverages(false)}>Totals</button>
              </div>
              <TimePeriodSelector
                value={timePeriod}
                onChange={setTimePeriod}
                customRange={customRange}
                onCustomRangeChange={setCustomRange}
              />
              {showStatsSortReset && (
                <button type="button" className="mr-link" onClick={resetStatsSort}>Reset sort</button>
              )}
            </>
          ) : (
            <ScheduleHorizonToggle value={scheduleHorizon} onChange={setScheduleHorizon} variant="segmented" />
          )}
        </div>
        {showSchedule && weekDays.length > 0 && (
          <div className="mr-tm-roster-body">
            <div className="mr-tm-days">
              {weekDays.map(day => {
                const focused = day.date === scheduleSpotlightDate
                return (
                  <button
                    key={day.date}
                    type="button"
                    aria-pressed={focused}
                    onClick={() => setScheduleFocusDate(day.date)}
                    className="mr-tm-daychip"
                  >
                    <b>{day.weekday}</b>
                    <span>{day.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="mr-tm-who-card">
              <p className="mr-tm-subhead">
                Who plays{scheduleSummaryHeading ? ` · ${scheduleSummaryHeading}` : ''}?
              </p>
              {scheduleSpotlightRows.length === 0 ? (
                <p className="mr-meta">No games for your roster this day.</p>
              ) : (
                <ul className="mr-tm-who">
                  {scheduleSpotlightRows.map(p => {
                    const opp = weekOpponent(opponents, p.pro_team, scheduleSpotlightDate!)
                    const b2b = isBackToBackGameDay(opponents, p.pro_team, scheduleSpotlightDate!)
                    return (
                      <li key={p.player_id}>
                        <SlotPill slot={p.lineup_slot} />
                        <PlayerNameLink name={wrapFriendlyName(p.player_name)} playerId={p.player_id} />
                        {b2b ? <BackToBackMark /> : null}
                        <span className="mr-meta">
                          {p.pro_team}
                          {opp && (
                            <span>
                              {' '}
                              <WeekOpponent opponent={opp} />
                            </span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
        {showStats && timePeriod === 'custom' && customRange && (
          <CoverageNotice
            requestedStart={customRange.start}
            requestedEnd={customRange.end}
            actualStart={team_detail.actual_start}
            actualEnd={team_detail.actual_end}
          />
        )}
        {showDaily ? (
          rosterDayError && !rosterDayFetching ? (
            <ErrorMessage message={getErrorMessage(rosterDayError, 'Failed to load the roster for this day')} />
          ) : (
            <RosterDayContent
              day={rosterDay}
              loading={rosterDayFetching && !rosterDay}
              matchups={matchupMap}
              onlyPlayed={rosterPlayedFilter && rosterDayOnlyPlayed}
              noSpoilers={noSpoilers}
            />
          )
        ) : !team_detail.players ? (
          <div className="py-12 text-center text-gray-400 text-sm dark:text-gray-500">
            Roster data is currently unavailable. Team stats above are from the last known snapshot.
          </div>
        ) : (
        <>
        <div className="mr-tm-table-wrap">
          <table className="min-w-full border-separate border-spacing-0 [&_th]:border-b [&_td]:border-b [&_th]:border-gray-200 [&_td]:border-gray-200 dark:[&_th]:border-gray-700 dark:[&_td]:border-gray-700">
            <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    onClick={column.sortable !== false ? () => handleSort(column.key) : undefined}
                    className={`px-4 py-3 text-${column.align} text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400 ${
                      column.sortable !== false ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800' : ''
                    } transition-colors duration-150 ${
                      column.key === 'player_name' ? 'sticky left-0 z-10 border-r border-r-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900' : ''
                    } ${
                      showSchedule && column.day?.date === scheduleSpotlightDate ? 'mr-tm-spot' : ''
                    }`}
                  >
                    {column.key === 'include' ? (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="text-xs font-medium text-gray-500 uppercase">Include</span>
                        <input
                          type="checkbox"
                          checked={includedPlayers === null || includedPlayers.size === visiblePlayers.length}
                          onChange={toggleAllPlayers}
                          className="mr-tm-check"
                          title="Toggle all players"
                        />
                      </div>
                    ) : 'day' in column && column.day ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-center rounded px-1 py-0.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                        onClick={() => setScheduleFocusDate(column.day!.date)}
                      >
                        <WeekDayHeading day={column.day} />
                      </button>
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
            <tbody className="bg-white dark:bg-gray-800">
              {sortedPlayers.map((player, idx) => {
                const awaitingCoverageMatchup = !!coverageSlate && !datedMatchupReady
                const matchup = awaitingCoverageMatchup ? undefined : matchupMap.get(player.player_name)
                const noData = player.has_data === false
                return (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400 dark:text-gray-500">
                        <SlotPill slot={player.lineup_slot} />
                      </td>
                      {!showSchedule && (
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <input
                          type="checkbox"
                          checked={!noData && isPlayerIncluded(player.player_name)}
                          disabled={noData}
                          onChange={() => togglePlayerInclusion(player.player_name)}
                          className="mr-tm-check"
                          title={noData ? 'Excluded from average — no data for this range' : undefined}
                        />
                      </td>
                      )}
                      <td className={`px-4 py-3 ${nameCellWrapClass(player.player_name)} text-sm font-medium text-gray-900 sticky left-0 z-10 border-r border-r-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100`}><PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} /></td>
                      {!showSchedule && (
                        <td className="px-4 py-3 whitespace-nowrap text-sm align-top text-gray-600 dark:text-gray-300">
                          <InjuryBadge status={matchup?.injury_status} />
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{player.positions.join(', ')}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{player.pro_team}</td>
                      {showSchedule ? (
                        <>
                          {weekDays.map(day => {
                            const b2b = isBackToBackGameDay(opponents, player.pro_team, day.date)
                            return (
                            <td
                              key={day.date}
                              className={`px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900 ${rosterScheduleCellClass(day.date === scheduleSpotlightDate, b2b)}`}
                            >
                              <WeekOpponent opponent={weekOpponent(opponents, player.pro_team, day.date)} />
                            </td>
                            )
                          })}
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center font-semibold text-gray-900">
                            {weekGameCount(opponents, player.pro_team, weekDays)}
                          </td>
                        </>
                      ) : noData ? (
                        <td
                          className="px-4 py-3 text-center italic text-gray-400 dark:text-gray-500"
                          colSpan={statsNoDataColSpan}
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
                    </tr>
                  </React.Fragment>
                )
              })}
              <tr className="mr-tm-avg">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
                {!showSchedule && (
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <span className="text-blue-600 dark:text-blue-400">-</span>
                  </td>
                )}
                <td className="sticky left-0 z-10 border-r border-r-gray-200 px-4 py-3 text-sm font-bold whitespace-nowrap">
                  {showAverages ? 'Avg' : 'Total'} ({getTimePeriodLabel()})
                </td>
                {!showSchedule && (
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">—</td>
                )}
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">
                  {showSchedule || includedPlayers === null ? visiblePlayers.length : includedPlayers.size} players
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
                {showSchedule ? (
                  <>
                    {weekDays.map(day => (
                      <td key={day.date} className={`px-4 py-3 whitespace-nowrap text-sm ${day.date === scheduleSpotlightDate ? 'mr-tm-spot' : ''}`} />
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
              </tr>
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
      </section>
    </div>
  )
}

export default TeamDetail
