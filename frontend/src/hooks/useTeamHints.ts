import { useCallback, useMemo } from 'react'
import {
  useGetAllPlayersQuery,
  useGetInjuryRecordsQuery,
  useGetNbaTeamsListQuery,
  useGetTeamDetailQuery,
  useGetTeamRosterDayQuery,
  useGetTodayHubQuery,
} from '../store/api/fantasyApi'
import type { RosterDay, TeamDetail } from '../types/api'
import { buildInjuryReportTeamKeys, buildInjuryStatusByPlayerName } from '../utils/playerInjury'
import { buildTeamHints } from '../utils/teamHints/buildTeamHints'
import { buildRankLookups } from '../utils/teamHints/ranks'
import type { TeamHint } from '../utils/teamHints/types'
import { usePersistedState } from './usePersistedState'

function dismissStorageKey(teamId: number, slateDate: string | null | undefined): string {
  return `managerHints.dismissed.${teamId}.${slateDate ?? 'unknown'}`
}

export interface UseTeamHintsOptions {
  /** Reuse team detail already loaded on the team page (roster slots, positions). */
  teamDetail?: TeamDetail | null
  /** When set, skips a separate today-hub fetch for roster-day date. */
  rosterDay?: RosterDay | null
  slateDate?: string | null
  includeSchedule?: boolean
}

export function useTeamHints(teamId: number | null, options?: UseTeamHintsOptions) {
  const includeSchedule = options?.includeSchedule !== false
  const teamDetailFromParent = options?.teamDetail

  const { data: teamDetailFetched, isLoading: teamLoading, isFetching: teamFetching, error: teamError } =
    useGetTeamDetailQuery({ teamId: teamId ?? 0 }, { skip: teamId == null || !!teamDetailFromParent })
  const teamDetail = teamDetailFromParent ?? teamDetailFetched

  const { data: seasonPool, isLoading: seasonLoading } = useGetAllPlayersQuery(
    { page: 1, limit: 1200, time_period: 'season' },
    { skip: teamId == null },
  )
  const { data: last15Pool, isLoading: last15Loading } = useGetAllPlayersQuery(
    { page: 1, limit: 1200, time_period: 'last_15' },
    { skip: teamId == null },
  )
  const { data: injuries, isLoading: injuriesLoading } = useGetInjuryRecordsQuery(undefined, { skip: teamId == null })
  const { data: nbaTeams } = useGetNbaTeamsListQuery(undefined, { skip: teamId == null })

  const injuryStatusByPlayerName = useMemo(
    () => buildInjuryStatusByPlayerName(injuries ?? []),
    [injuries],
  )
  const injuryReportTeamKeys = useMemo(() => buildInjuryReportTeamKeys(injuries ?? []), [injuries])

  const { data: todayHub } = useGetTodayHubQuery(undefined, {
    skip: teamId == null || !includeSchedule || options?.slateDate != null,
  })
  const slateDate = options?.slateDate ?? todayHub?.slate_date ?? null

  const { data: rosterDayFetched } = useGetTeamRosterDayQuery(
    { teamId: teamId ?? 0, ...(slateDate ? { date: slateDate } : {}) },
    {
      skip:
        teamId == null ||
        !includeSchedule ||
        !slateDate ||
        options?.rosterDay !== undefined,
    },
  )
  const rosterDay = options?.rosterDay !== undefined ? options.rosterDay : rosterDayFetched

  const [dismissedIds, setDismissedIds] = usePersistedState<string[]>(
    teamId != null ? dismissStorageKey(teamId, slateDate) : 'managerHints.dismissed.none',
    [],
  )
  const dismissedSet = useMemo(() => new Set(dismissedIds), [dismissedIds])

  const ranks = useMemo(() => {
    if (!seasonPool?.players?.length || !last15Pool?.players?.length) return null
    return buildRankLookups(seasonPool.players, last15Pool.players, seasonPool)
  }, [seasonPool, last15Pool])

  const last15GpByPlayerId = useMemo(() => {
    const map = new Map<number, number>()
    for (const p of last15Pool?.players ?? []) {
      if (p.player_id != null) map.set(p.player_id, p.stats?.gp ?? 0)
    }
    return map
  }, [last15Pool])

  const hintsResult = useMemo(() => {
    if (!teamDetail || !ranks) return null
    return buildTeamHints(
      {
        teamDetail,
        ranks,
        last15GpByPlayerId,
        rosterDay: rosterDay ?? null,
        injuryStatusByPlayerName,
        injuryReportTeamKeys,
        nbaTeams,
      },
      dismissedSet,
    )
  }, [teamDetail, ranks, last15GpByPlayerId, rosterDay, dismissedSet, injuryStatusByPlayerName, injuryReportTeamKeys, nbaTeams])

  const dismiss = useCallback(
    (hint: TeamHint) => {
      setDismissedIds((prev) => (prev.includes(hint.id) ? prev : [...prev, hint.id]))
    },
    [setDismissedIds],
  )

  const waitingOnTeam = teamId != null && !teamDetailFromParent && teamLoading
  const isLoading =
    teamId != null && (waitingOnTeam || seasonLoading || last15Loading || injuriesLoading)
  const isReady = teamId != null && !!hintsResult && !isLoading

  return {
    teamId,
    teamName: teamDetail?.team.team_name ?? null,
    isLoading,
    isFetching: teamFetching,
    isReady,
    error: teamError,
    visible: hintsResult?.visible ?? [],
    hidden: hintsResult?.hidden ?? [],
    allCount: hintsResult?.all.length ?? 0,
    dismiss,
    showMore: (hintsResult?.hidden.length ?? 0) > 0,
    hiddenCount: hintsResult?.hidden.length ?? 0,
    expandAll: hintsResult ? [...hintsResult.visible, ...hintsResult.hidden] : [],
  }
}
