import type { ReactNode } from 'react'
import type {
  CustomDateRange,
  Player,
  PlayerMatchup,
  RosterDay,
  TeamDetail,
  TimePeriod,
} from '../../types/api'
import type { PlayerTableMode, ScheduleHorizon } from '../../components/PlayerWeekColumns'
import type { WeekScheduleDay } from '../../utils/slateWindow'

export type TeamTab = 'stats' | 'roster' | 'slots'
export const TEAM_TABS: readonly TeamTab[] = ['stats', 'roster', 'slots']

export interface StatColumn {
  key: string
  label: string
}

export type TeamAverage = Record<string, number>

/**
 * Everything the phone Team page needs from TeamDetail. TeamDetail keeps all
 * state (URL params, queries, sorting, Include checkboxes), so desktop and
 * phone show the same data and share links work across both.
 */
export interface MobileTeamDetailProps {
  team: TeamDetail
  teamCount: number
  espnUpdatedAt?: string | null
  shareCard: (options: { dark: boolean }) => ReactNode
  perGameCategories: string[]
  categoryNames: Record<string, string>

  tab: TeamTab
  onTab: (tab: TeamTab) => void
  mode: PlayerTableMode
  onMode: (mode: PlayerTableMode) => void

  // Daily
  rosterDay: RosterDay | undefined
  rosterDayFetching: boolean
  rosterDayError: unknown
  rosterDayDate: string
  rosterDayLast: string
  onRosterDate: (date: string) => void
  rosterDayOnlyPlayed: boolean
  onRosterDayOnlyPlayed: (value: boolean) => void
  /** Matchups by player name (today's, or the coverage day's in Stats mode). */
  matchups: Map<string, PlayerMatchup>
  /** True while the coverage day's matchups are still loading (Stats mode). */
  matchupsPending: boolean

  // Stats
  timePeriod: TimePeriod
  onTimePeriod: (period: TimePeriod) => void
  customRange: CustomDateRange | null
  onCustomRange: (range: CustomDateRange | null) => void
  seasonStart?: string
  periodLabel: string
  showAverages: boolean
  onShowAverages: (value: boolean) => void
  sortBy: string | null
  sortOrder: 'asc' | 'desc'
  onSort: (key: string) => void
  showSortReset: boolean
  onResetSort: () => void
  players: Player[]
  statColumns: StatColumn[]
  formatStat: (value: number, gp: number, isPercentage?: boolean) => string
  isIncluded: (name: string) => boolean
  onToggleIncluded: (name: string) => void
  allIncluded: boolean
  onToggleAll: () => void
  includedCount: number
  teamAverage: TeamAverage

  // Schedule
  weekDays: WeekScheduleDay[]
  horizon: ScheduleHorizon
  onHorizon: (horizon: ScheduleHorizon) => void
  focusDate: string | null
  onFocusDate: (date: string) => void
  opponentOn: (proTeam: string, date: string) => string | undefined
  isBackToBackOn: (proTeam: string, date: string) => boolean
  gamesIn: (proTeam: string) => number
  whoPlays: Player[]
  whoPlaysHeading: string

  // Slots & coverage
  slotUsageNode: ReactNode
  slotMeta: ReactNode
  coverageDate: string | null
  onCoverageDate: (date: string) => void
}
