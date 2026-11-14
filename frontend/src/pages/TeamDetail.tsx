import { useParams, useNavigate } from 'react-router'
import { useState, useMemo, useEffect } from 'react'
import React from 'react'
import { usePersistedState } from '../hooks/usePersistedState'
import { useUrlState, enumParam, isoDateParam, stringParam } from '../hooks/useUrlState'
import { useGetTeamDetailQuery, useGetLeagueSummaryQuery, useGetMatchupsTodayQuery, useGetScheduleQuery, useGetTeamRosterDayQuery } from '../store/api/fantasyApi'
import type { TimePeriod, PlayerMatchup, CustomDateRange, PlayerStatKey, Player } from '../types/api'
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
import { MyTeamMark } from '../components/MyTeamMark'
import { nameCellWrapClass, wrapFriendlyName } from '../utils/wrapName'
import { ShareCardButton } from '../components/share/ShareCardButton'
import { TeamShareCard } from '../components/share/TeamShareCard'
import { formatAsOf } from '../components/share/shareCardFormat'
import { orderCategories } from '../utils/statOrder'
import { StatsScheduleToggle, ScheduleHorizonToggle, WeekDayHeading, WeekOpponent, type PlayerTableMode, type ScheduleHorizon } from '../components/PlayerWeekColumns'
import { RosterDayContent, RosterDayOnlyPlayedToggle, RosterDayStepper, SlotPill } from '../components/RosterDayView'
import NoSpoilersSwitch from '../components/boxScores/NoSpoilersSwitch'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { lineupSlotOrder, rosterDayCanFilterPlayed, rosterDayNote } from '../utils/rosterDay'
import { easternToday, formatSlateDate, isBackToBackGameDay, opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays, type WeekScheduleDay } from '../utils/slateWindow'
import { rosterScheduleCellClass, rosterScheduleMiniCellClass } from '../utils/rosterScheduleTone'
import BackToBackMark from '../components/BackToBackMark'
import { useMobileRedesign } from '../mobile/flag'
import MobileTeamDetail from '../mobile/team/MobileTeamDetail'
import { TEAM_TABS, type TeamTab } from '../mobile/team/types'
import { ManagerHintsTeamSection } from '../components/hints/ManagerHintsCard'

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
  const navigate = useNavigate()
  const teamIdNumber = teamId ? parseInt(teamId, 10) : 0
  const [urlState, setUrlState] = useUrlState(TEAM_DETAIL_URL_SCHEMA)
  const mobileRedesign = useMobileRedesign()
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
  const [sectionTeamStatsOpen, setSectionTeamStatsOpen] = usePersistedState('teamDetail.section.teamStats', true)
  const [sectionSlotUsageOpen, setSectionSlotUsageOpen] = usePersistedState('teamDetail.section.slotUsage', true)
  const [sectionCoverageOpen, setSectionCoverageOpen] = usePersistedState('teamDetail.section.coverage', false)
  const [sectionRosterOpen, setSectionRosterOpen] = usePersistedState('teamDetail.section.roster', true)
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

  const rosterPlayers = team_detail?.players ?? []
  const scheduleSpotlightRows = useMemo(() => {
    if (!showSchedule || !scheduleSpotlightDate || rosterPlayers.length === 0) return []
    return [...rosterPlayers]
      .filter(p => !!weekOpponent(opponents, p.pro_team, scheduleSpotlightDate))
      .sort((a, b) => lineupSlotOrder(a.lineup_slot) - lineupSlotOrder(b.lineup_slot))
  }, [showSchedule, scheduleSpotlightDate, rosterPlayers, opponents])

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

  const heroStatLabel = (key: string | null): string => {
    if (!key || key === 'lineup_slot') return showAverages ? 'PPG' : 'PTS'
    const c = statColumns.find(s => s.key === key)
    return c?.label ?? key
  }

  const heroStatValue = (player: Player): string => {
    const key = sortBy
    if (!key || key === 'lineup_slot' || key === 'include' || key.startsWith('day:')) {
      return formatStat(player.stats.pts, player.stats.gp)
    }
    if (key === 'player_name') return player.player_name
    if (key === 'positions') return player.positions.join(', ')
    if (key === 'pro_team') return player.pro_team
    if (key === 'week_games') return String(weekGameCount(opponents, player.pro_team, weekDays))
    const isPct = key === 'fg_percentage' || key === 'ft_percentage'
    const v = player.stats[key as PlayerStatKey] ?? 0
    return formatStat(v, player.stats.gp, isPct)
  }

  const statsLive = liveSectionNote(team_detail.live, 'stats')
  const teamStatsSubtitle = `#${team_detail.ranking_stats.rank ?? '—'} · ${team_detail.ranking_stats.total_points} pts · GP ${team_detail.raw_averages.gp}${statsLive ? ` · ${statsLive}` : ''}`
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
  const tonightTag = (text: string | null, tone: 'up' | 'down' = 'up') =>
    text ? (
      <span className={`ml-1.5 text-xs font-semibold ${tone === 'down' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`} data-testid="tonight-delta">
        {text}
      </span>
    ) : null
  const pointsTone = (team_detail.tonight?.points ?? 0) < 0 ? 'down' : 'up'
  const slotUsageBase =
    typeof leagueSummary?.nba_game_days_left === 'number'
      ? `${leagueSummary.nba_game_days_left} game days left${typeof leagueSummary?.nba_avg_pace === 'number' ? ` · NBA pace ${leagueSummary.nba_avg_pace.toFixed(1)}` : ''}`
      : undefined
  const slotUsageSubtitle = slotsLive ? [slotUsageBase, slotsLive].filter(Boolean).join(' · ') : slotUsageBase

  if (mobileRedesign) {
    const awaitingCoverageMatchup = !!coverageSlate && !datedMatchupReady
    return (
      <MobileTeamDetail
        team={team_detail}
        teamCount={leagueSummary?.total_teams ?? Math.max(...Object.values(team_detail.category_ranks), 1)}
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

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 space-y-4 sm:space-y-6 pb-4">
      {/* Mobile: compact hero */}
      <div className="sm:hidden rounded-lg bg-white p-3 shadow dark:bg-gray-800">
        <button
          type="button"
          onClick={() => navigate('/teams')}
          className="mb-2 inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Teams
        </button>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight text-gray-900 dark:text-gray-100">
              {team_detail.team.team_name}
              <MyTeamMark teamId={team_detail.team.team_id} />
            </h1>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              #{team_detail.ranking_stats.rank ?? '—'} · {team_detail.ranking_stats.total_points} pts · GP {team_detail.raw_averages.gp}
            </p>
            <div className="mt-1">
              {team_detail.data_date
                ? <DataDateBadge dataDate={team_detail.data_date} />
                : <LiveBadge live={team_detail.live} espnUpdatedAt={leagueSummary?.espn_updated_at} align="left" />}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ShareCardButton title={`${team_detail.team.team_name} Report`} renderCard={shareCardRender} />
            <a
              href={team_detail.espn_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-red-600 px-2 text-xs font-semibold text-white shadow hover:bg-red-700"
              aria-label="View on ESPN"
            >
              ESPN
            </a>
          </div>
        </div>
      </div>

      {/* Desktop: original header */}
      <div className="hidden sm:block bg-white rounded-lg shadow p-6 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => navigate('/teams')}
          className="mb-4 inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors duration-200 cursor-pointer dark:text-gray-400 dark:hover:text-gray-100"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Teams
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {team_detail.team.team_name}
              <MyTeamMark teamId={team_detail.team.team_id} />
            </h1>
            {team_detail.data_date
              ? <DataDateBadge dataDate={team_detail.data_date} />
              : <LiveBadge live={team_detail.live} espnUpdatedAt={leagueSummary?.espn_updated_at} align="left" />}
          </div>
          <div className="flex items-center gap-2">
            <ShareCardButton title={`${team_detail.team.team_name} Report`} renderCard={shareCardRender} />
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

      <ManagerHintsTeamSection teamId={teamIdNumber} layout="desktop" teamDetail={team_detail} />

      <CollapsibleSection
        id="team-stats"
        title="Team statistics"
        subtitle={teamStatsSubtitle}
        open={sectionTeamStatsOpen}
        onOpenChange={setSectionTeamStatsOpen}
        contentClassName="p-4 sm:p-6"
      >
        {/* Mobile: compact snapshot-style layout */}
        <div className="sm:hidden">
          <div className="rounded-md bg-gradient-to-r from-blue-50 to-indigo-50 p-3 dark:from-blue-950/50 dark:to-indigo-950/50">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700 dark:text-gray-300">Overall rank</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">#{team_detail.ranking_stats.rank}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-gray-700 dark:text-gray-300">Total points</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">{tonightTag(pointsTonight, pointsTone)} {team_detail.ranking_stats.total_points}</span>
            </div>
          </div>
          {playingNote && (
            <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">{playingNote}</p>
          )}
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between text-gray-800 dark:text-gray-200">
              <span>Field goals</span>
              <span>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({(team_detail.shot_chart.fg_percentage * 100).toFixed(1)}%)</span>
            </div>
            <div className="flex justify-between text-gray-800 dark:text-gray-200">
              <span>Free throws</span>
              <span>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({(team_detail.shot_chart.ft_percentage * 100).toFixed(1)}%)</span>
            </div>
          </div>
          <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Per-game</p>
            <div className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
              {perGameCategories.map(key => (
                <div className="flex justify-between" key={key}>
                  <span className="text-gray-600 dark:text-gray-400">{CATEGORY_DISPLAY_NAMES[key] ?? key}</span>
                  <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{(team_detail.raw_averages.stats?.[key] ?? 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden sm:block">
          <div className="flex items-center space-x-4 mb-6 text-gray-600 dark:text-gray-300">
            <span>Total Games Played:</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{team_detail.raw_averages.gp}{tonightTag(gpTonight)}</span>
          </div>
          {playingNote && (
            <p className="mb-6 inline-block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="starters-playing-note">
              {playingNote}
            </p>
          )}

          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Ranking summary</h3>
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border-l-4 border-blue-500 shadow-sm dark:from-blue-950/50 dark:to-indigo-950/50">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium text-gray-800 dark:text-gray-200">Overall rank</span>
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">#{team_detail.ranking_stats.rank}</span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-lg font-medium text-gray-800 dark:text-gray-200">Total points</span>
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{tonightTag(pointsTonight, pointsTone)} {team_detail.ranking_stats.total_points}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Shot chart</h3>
              <div className="space-y-3 text-gray-700 dark:text-gray-300">
                <div className="flex justify-between">
                  <span>Field goals</span>
                  <span>{team_detail.shot_chart.fgm}/{team_detail.shot_chart.fga} ({(team_detail.shot_chart.fg_percentage * 100).toFixed(2)}%)</span>
                </div>
                <div className="flex justify-between">
                  <span>Free throws</span>
                  <span>{team_detail.shot_chart.ftm}/{team_detail.shot_chart.fta} ({(team_detail.shot_chart.ft_percentage * 100).toFixed(2)}%)</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Per-game averages</h3>
              <div className="space-y-3 text-gray-700 dark:text-gray-300">
                {perGameCategories.map(key => (
                  <div className="flex justify-between" key={key}>
                    <span>{CATEGORY_DISPLAY_NAMES[key] ?? key}</span>
                    <span className="tabular-nums">{(team_detail.raw_averages.stats?.[key] ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
      {team_detail.slot_usage && Object.keys(team_detail.slot_usage).length > 0 && (
        <CollapsibleSection
          id="slot-usage"
          title="Slot usage"
          subtitle={slotUsageSubtitle}
          open={sectionSlotUsageOpen}
          onOpenChange={setSectionSlotUsageOpen}
          contentClassName="p-0"
        >
          <SlotUsageTable
            embedded
            slotUsage={team_detail.slot_usage}
            avgPace={leagueSummary?.nba_avg_pace}
            gameDaysLeft={leagueSummary?.nba_game_days_left}
            gameDaysElapsed={leagueSummary?.nba_game_days_elapsed}
            tonightNote={slotTonight}
          />
        </CollapsibleSection>
      )}
      <CollapsibleSection
        id="roster-coverage"
        title="Roster coverage"
        subtitle="Games on your roster vs. the NBA slate"
        open={sectionCoverageOpen}
        onOpenChange={setSectionCoverageOpen}
        contentClassName="p-0"
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        id="team-roster"
        title="Roster"
        subtitle={rosterSubtitle}
        open={sectionRosterOpen}
        onOpenChange={setSectionRosterOpen}
        contentClassName="p-0"
      >
      <div className="p-4 sm:p-6 dark:bg-gray-800">
        {/* Mobile: compact sticky controls — section title is in the collapsible header */}
        <div className="sticky top-0 z-30 -mx-4 mb-3 space-y-2 border-b border-gray-100 bg-white/95 px-4 py-2 backdrop-blur-md sm:hidden dark:border-gray-700 dark:bg-gray-800/95">
          <div className="flex flex-col gap-2">
            <StatsScheduleToggle mode={tableMode} onChange={setTableMode} includeDaily />
            {showSchedule && weekDays.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
                {weekDays.map(day => {
                  const focused = day.date === scheduleSpotlightDate
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setScheduleFocusDate(day.date)}
                      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left text-[11px] leading-tight transition-colors ${
                        focused
                          ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40'
                          : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/80'
                      }`}
                    >
                      <div className="font-semibold text-gray-800 dark:text-gray-200">{day.weekday}</div>
                      <div className="text-gray-500 dark:text-gray-400">{day.label}</div>
                    </button>
                  )
                })}
              </div>
            )}
            {showDaily && (
              <div className="flex w-full flex-col gap-2">
                {rosterIsToday && <NoSpoilersSwitch on={noSpoilers} onChange={setNoSpoilers} />}
                {rosterPlayedFilter && (
                  <RosterDayOnlyPlayedToggle compact checked={rosterDayOnlyPlayed} onChange={setRosterDayOnlyPlayed} />
                )}
                <RosterDayStepper
                  compact
                  date={rosterDate || rosterDay?.date || today}
                  firstDate={rosterDay?.first_date}
                  lastDate={rosterDay?.last_date ?? today}
                  note={rosterDay && !rosterDayFetching ? rosterDayNote(rosterDay, undefined, noSpoilers) : rosterDayFetching ? 'Loading this day…' : undefined}
                  onChange={changeRosterDate}
                />
              </div>
            )}
          </div>
          {showStats && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-h-[40px] min-w-0 flex-1 overflow-hidden rounded border border-gray-300 dark:border-gray-600">
                <button
                  type="button"
                  className={`flex-1 border-r border-gray-300 px-2.5 py-2 text-xs font-medium dark:border-gray-600 ${showAverages ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                  onClick={() => setShowAverages(true)}
                >
                  Per game
                </button>
                <button
                  type="button"
                  className={`flex-1 px-2.5 py-2 text-xs font-medium ${!showAverages ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                  onClick={() => setShowAverages(false)}
                >
                  Totals
                </button>
              </div>
              {showStatsSortReset && (
                <button
                  type="button"
                  className="min-h-[40px] rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200"
                  onClick={resetStatsSort}
                >
                  Reset sort
                </button>
              )}
            </div>
          )}
          {showStats && (
            <TimePeriodSelector
              value={timePeriod}
              onChange={setTimePeriod}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
            />
          )}
          {showSchedule && <ScheduleHorizonToggle value={scheduleHorizon} onChange={setScheduleHorizon} />}
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="sr-only sm:not-sr-only sm:text-xl sm:font-bold sm:text-gray-900 sm:dark:text-gray-100">Roster</h2>
          {!team_detail.players && (
            <p className="text-sm text-gray-500 italic dark:text-gray-400">Player data unavailable</p>
          )}
          <div className="hidden w-full flex-col gap-2 sm:flex sm:w-auto sm:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <div className="order-1 w-full sm:order-3 sm:w-auto">
                <StatsScheduleToggle mode={tableMode} onChange={setTableMode} includeDaily />
              </div>
              {showStats && (
                <div className="order-2 flex w-full overflow-hidden rounded border border-gray-300 sm:order-2 sm:w-auto dark:border-gray-600">
                  <button
                    type="button"
                    className={`flex-1 border-r border-gray-300 px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 sm:flex-none dark:border-gray-600 ${showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                    onClick={() => setShowAverages(true)}
                  >
                    Per Game
                  </button>
                  <button
                    type="button"
                    className={`flex-1 px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 sm:flex-none ${!showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                    onClick={() => setShowAverages(false)}
                  >
                    Totals
                  </button>
                </div>
              )}
              {showStatsSortReset && (
                <button
                  type="button"
                  className="order-4 rounded border border-gray-300 px-3 py-1.5 text-xs whitespace-nowrap text-gray-700 sm:order-2 dark:border-gray-600 dark:text-gray-200"
                  onClick={resetStatsSort}
                >
                  Reset sort
                </button>
              )}
            </div>
            {showDaily ? (
              <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
              </div>
            ) : showStats ? (
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
        {showSchedule && weekDays.length > 0 && (
          <div className="mb-4">
            <div className="mb-3 hidden flex-wrap gap-2 sm:flex">
              {weekDays.map(day => {
                const focused = day.date === scheduleSpotlightDate
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setScheduleFocusDate(day.date)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      focused
                        ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40'
                        : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800/80 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="font-semibold text-gray-800 dark:text-gray-200">{day.weekday}</div>
                    <div className="text-gray-500 dark:text-gray-400">{day.label}</div>
                  </button>
                )
              })}
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-600 dark:bg-gray-900/40 sm:mt-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Who plays{scheduleSummaryHeading ? ` · ${scheduleSummaryHeading}` : ''}?
              </p>
              {scheduleSpotlightRows.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No games for your roster this day.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {scheduleSpotlightRows.map(p => {
                    const opp = weekOpponent(opponents, p.pro_team, scheduleSpotlightDate!)
                    const b2b = isBackToBackGameDay(opponents, p.pro_team, scheduleSpotlightDate!)
                    return (
                      <li key={p.player_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <SlotPill slot={p.lineup_slot} />
                        <PlayerNameLink name={wrapFriendlyName(p.player_name)} playerId={p.player_id} />
                        {b2b ? <BackToBackMark /> : null}
                        <span className="text-gray-500 dark:text-gray-400">
                          {p.pro_team}
                          {opp && (
                            <span className="ml-1">
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
        <div className="space-y-2 sm:hidden">
          {showStats && (
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <span>Sort: tap a stat below</span>
              <div className="flex flex-wrap items-center gap-2">
                {showStatsSortReset && (
                  <button
                    type="button"
                    className="rounded border border-gray-200 px-2 py-1 text-gray-700 dark:border-gray-600 dark:text-gray-300"
                    onClick={resetStatsSort}
                  >
                    Reset sort
                  </button>
                )}
                <button
                  type="button"
                  className="rounded border border-gray-200 px-2 py-1 text-gray-700 dark:border-gray-600 dark:text-gray-300"
                  onClick={toggleAllPlayers}
                >
                  {includedPlayers === null || includedPlayers.size === visiblePlayers.length ? 'Exclude all' : 'Include all'}
                </button>
              </div>
            </div>
          )}
          {sortedPlayers.map((player, idx) => {
            const awaitingCoverageMatchup = !!coverageSlate && !datedMatchupReady
            const matchup = awaitingCoverageMatchup ? undefined : matchupMap.get(player.player_name)
            const noData = player.has_data === false
            return (
              <div
                key={idx}
                className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40"
              >
                <div className="flex items-start gap-2">
                  <div className="shrink-0 pt-0.5">
                    <SlotPill slot={player.lineup_slot} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`min-w-0 ${nameCellWrapClass(player.player_name)}`}>
                        <PlayerNameLink name={wrapFriendlyName(player.player_name)} playerId={player.player_id} />
                        <InjuryBadge status={matchup?.injury_status} />
                      </div>
                      {showStats && !noData && (
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 shrink-0 text-blue-600"
                          checked={isPlayerIncluded(player.player_name)}
                          onChange={() => togglePlayerInclusion(player.player_name)}
                          aria-label={`Include ${player.player_name} in team average`}
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {player.positions.join(', ')} · {player.pro_team}
                      {showStats && !noData && (
                        <span className="ml-1 font-medium text-gray-700 dark:text-gray-300">
                          · {heroStatLabel(sortBy)} {heroStatValue(player)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {showSchedule && (
                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
                      {weekGameCount(opponents, player.pro_team, weekDays)} games
                    </span>
                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                      {weekDays.map(day => {
                        const b2b = isBackToBackGameDay(opponents, player.pro_team, day.date)
                        return (
                        <div
                          key={day.date}
                          className={rosterScheduleMiniCellClass(day.date === scheduleSpotlightDate, b2b)}
                        >
                          <div className="font-semibold text-gray-800 dark:text-gray-200">{day.weekday}</div>
                          <div className="text-gray-500 dark:text-gray-400">{day.label}</div>
                          <div className="mt-0.5 font-medium text-gray-900 dark:text-gray-100">
                            <WeekOpponent opponent={weekOpponent(opponents, player.pro_team, day.date)} />
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {showStats && !noData && (
                  <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      {statColumns.map(col => (
                        <div key={col.key} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="shrink-0 text-left text-gray-500 dark:text-gray-400"
                            onClick={() => handleSort(col.key)}
                          >
                            {col.label}
                            {sortBy === col.key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                          </button>
                          <span className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                            {formatStat(
                              player.stats[col.key as PlayerStatKey],
                              player.stats.gp,
                              col.key === 'fg_percentage' || col.key === 'ft_percentage',
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showStats && noData && (
                  <p className="mt-2 text-xs italic text-gray-400 dark:text-gray-500">No data for this range</p>
                )}
              </div>
            )
          })}
          {showStats && (
            <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 dark:border-blue-900 dark:from-blue-950/40 dark:to-indigo-950/40">
              <p className="mb-2 text-sm font-bold text-blue-900 dark:text-blue-100">
                {showAverages ? 'Avg' : 'Total'} ({getTimePeriodLabel()}) ·{' '}
                {includedPlayers === null ? visiblePlayers.length : includedPlayers.size} players
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {statColumns.map(col => (
                  <div key={col.key} className="flex justify-between gap-2 text-blue-900 dark:text-blue-100">
                    <span className="text-blue-800/90 dark:text-blue-300/90">{col.label}</span>
                    <span className="font-bold tabular-nums">
                      {col.key === 'fg_percentage' || col.key === 'ft_percentage'
                        ? `${formatNumber((teamAverage[col.key as keyof typeof teamAverage] as number) * 100)}%`
                        : formatStat(teamAverage[col.key as keyof typeof teamAverage] as number, showAverages ? 1 : teamAverage.gp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="hidden sm:block overflow-auto max-h-[70vh] mq-scroll-container">
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
                      showSchedule && column.day?.date === scheduleSpotlightDate ? 'bg-blue-100 dark:bg-blue-950/50' : ''
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
                          className="w-4 h-4 text-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
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
              <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 font-bold dark:from-blue-950/40 dark:to-indigo-950/40 [&_td]:border-t-2 [&_td]:border-t-blue-400 [&_td]:border-b-0">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-700 dark:text-blue-300">-</td>
                {!showSchedule && (
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <span className="text-blue-600 dark:text-blue-400">-</span>
                  </td>
                )}
                <td className="sticky left-0 z-10 border-r border-r-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 text-sm font-bold whitespace-nowrap text-blue-900 dark:border-gray-700 dark:from-blue-950/50 dark:to-indigo-950/50 dark:text-blue-100">
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
                      <td key={day.date} className={`px-4 py-3 whitespace-nowrap text-sm text-blue-900 ${day.date === scheduleSpotlightDate ? 'bg-blue-100 dark:bg-blue-950/40' : ''}`} />
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
      </CollapsibleSection>
    </div>
  )
}

export default TeamDetail
