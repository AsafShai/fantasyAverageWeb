import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useMyTeam } from '../../context/MyTeamContext'
import {
  useGetAllPlayersQuery, useGetTeamsListQuery, useGetWithWithoutTeamQuery, useGetWithWithoutTeamsQuery,
} from '../../store/api/fantasyApi'
import { tradeLinkForPlayer } from '../../mobile/player/tradePreset'
import { orderCategories } from '../../utils/statOrder'
import { getErrorMessage } from '../../utils/errorMessage'
import type { Player } from '../../types/api'
import type { WithWithoutPlayer } from '../../types/withWithout'
import {
  MAX_PICKS, buildZContext, joinNames, missedGames, splitGames, teammateRows,
  type GameKind, type MatchMode, type TeammateRow,
} from '../../utils/withWithout'

export type CellMode = 'delta' | 'with' | 'without'
/** 'z' or a column (MIN / a category). */
export type SortKey = string
export type RowView = 'none' | 'log' | 'profile' | 'trade'

export interface PickOption {
  player: WithWithoutPlayer
  missed: number
  onTeam: number
  picked: boolean
  disabled: boolean
}

export interface GameSplit {
  kinds: GameKind[]
  counts: { with: number; without: number; unused: number }
  /** "games where Embiid & George both played" etc. */
  withDesc: string
  withoutDesc: string
  unusedDesc: string
  sentence: string
}

/** The page's state and everything derived from it; the desktop and phone
 * layouts only render it. */
export function useWithWithout() {
  const navigate = useNavigate()
  const { myTeamId } = useMyTeam()
  const teamsQuery = useGetWithWithoutTeamsQuery()
  const [savedTeam, setSavedTeam] = usePersistedState<number | null>('withWithout.team', null)
  const [injOnly, setInjOnly] = useState(false)
  const [pickedIds, setPickedIds] = useState<number[]>([])
  const [mode, setMode] = useState<MatchMode>('all')
  const [faOnly, setFaOnly] = useState(false)
  const [cellMode, setCellMode] = useState<CellMode>('delta')
  const [sort, setSort] = useState<SortKey>('z')
  const [openId, setOpenId] = useState<number | null>(null)
  const [rowView, setRowView] = useState<RowView>('none')

  const nbaTeams = useMemo(() => teamsQuery.data?.teams ?? [], [teamsQuery.data])
  const teamId = savedTeam ?? nbaTeams.find(t => t.has_out_today)?.team_id ?? nbaTeams[0]?.team_id ?? null
  const teamOptions = useMemo(
    () => nbaTeams.filter(t => !injOnly || t.has_out_today || t.team_id === teamId),
    [nbaTeams, injOnly, teamId],
  )

  const seasonQuery = useGetWithWithoutTeamQuery(teamId ?? 0, { skip: teamId == null })
  const season = seasonQuery.data && seasonQuery.data.team_id === teamId ? seasonQuery.data : undefined

  // Z is scored against the Player Rankings pool at its defaults (same request
  // as that page, so the cache is shared).
  const playersQuery = useGetAllPlayersQuery({ limit: 1200, time_period: 'season' })
  const { data: fantasyTeams = [] } = useGetTeamsListQuery()
  const zContext = useMemo(() => {
    const players = playersQuery.data?.players
    if (!players || !season) return null
    return buildZContext(players, season.categories, season.reverse_categories)
  }, [playersQuery.data, season])

  const columns = useMemo(() => (season ? ['MIN', ...orderCategories(season.categories)] : []), [season])
  const reverse = useMemo(() => new Set(season?.reverse_categories ?? []), [season])

  const picked = useMemo(
    () => (season ? pickedIds.map(id => season.players.find(p => p.player_id === id)).filter((p): p is WithWithoutPlayer => !!p) : []),
    [season, pickedIds],
  )
  const effectiveMode: MatchMode = picked.length > 1 ? mode : 'all'

  const pickOptions: PickOption[] = useMemo(() => {
    if (!season) return []
    const full = picked.length >= MAX_PICKS
    return season.players
      .map(player => {
        const { missed, onTeam } = missedGames(player)
        const isPicked = pickedIds.includes(player.player_id)
        return { player, missed, onTeam, picked: isPicked, disabled: !isPicked && (full || missed === 0) }
      })
      .sort((a, b) => b.missed - a.missed || a.player.name.localeCompare(b.player.name))
  }, [season, picked.length, pickedIds])

  const split: GameSplit | null = useMemo(() => {
    if (!season || picked.length === 0) return null
    const kinds = splitGames(season, picked, effectiveMode)
    const counts = {
      with: kinds.filter(k => k === 'with').length,
      without: kinds.filter(k => k === 'without').length,
      unused: kinds.filter(k => k === 'unused').length,
    }
    const names = picked.map(p => p.name)
    const multi = picked.length > 1
    const both = picked.length === 2 ? 'both' : 'all'
    const withDesc = multi ? `${joinNames(names, '&')} ${both} played` : `${joinNames(names, '&')} played`
    const withoutDesc = !multi
      ? `${joinNames(names, '&')} sat`
      : effectiveMode === 'all' ? `${joinNames(names, '&')} ${both} sat` : `${joinNames(names, 'or')} sat (at least one)`
    const unusedDesc = picked.some(p => p.lines.some(e => e === null))
      ? 'Only some of them sat, or a picked player wasn’t on the team yet'
      : !multi ? 'Every game counts with one player picked'
        : effectiveMode === 'all' ? 'Only some of them sat, so the game is neither' : 'Never happens in “Any of them sat” mode'
    const sentence = `Every number in the table compares two groups of ${season.abbr} games: the ${counts.without} where ${withoutDesc.replace(' (at least one)', '')}, and the ${counts.with} where ${multi ? `${both} played` : 'he played'}.` +
      (counts.unused ? ` The other ${counts.unused} ${counts.unused === 1 ? 'is' : 'are'} not used.` : '')
    return { kinds, counts, withDesc, withoutDesc, unusedDesc, sentence }
  }, [season, picked, effectiveMode])

  const rows: TeammateRow[] = useMemo(() => {
    if (!season || !split) return []
    let out = teammateRows(season, pickedIds, split.kinds, columns, zContext)
    if (faOnly) out = out.filter(r => r.player.owner === null)
    const key = (r: TeammateRow) => {
      if (sort === 'z') return r.zDelta ?? -Infinity
      const d = r.deltas[sort] ?? 0
      if (Number.isNaN(d)) return -Infinity
      return reverse.has(sort) ? -d : d
    }
    return out.sort((a, b) => key(b) - key(a))
  }, [season, split, pickedIds, columns, zContext, faOnly, sort, reverse])

  const togglePick = (id: number) => {
    setPickedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= MAX_PICKS ? prev : [...prev, id]))
    setOpenId(null)
  }

  const pickTeam = (id: number) => {
    setSavedTeam(id)
    setPickedIds([])
    setOpenId(null)
  }

  const toggleRow = (id: number) => {
    setOpenId(prev => (prev === id ? null : id))
    setRowView('none')
  }

  const playersById = useMemo(() => {
    const map = new Map<number, Player>()
    for (const p of playersQuery.data?.players ?? []) if (p.player_id != null) map.set(p.player_id, p)
    return map
  }, [playersQuery.data])

  /** Trade Analyzer with him filled in, opened the way the player page does. */
  const openTrade = (player: WithWithoutPlayer) => {
    const known = playersById.get(player.player_id)
    const asPlayer: Player = known ?? {
      player_name: player.name,
      player_id: player.player_id,
      pro_team: season?.abbr ?? '',
      positions: player.pos ? [player.pos] : [],
      team_id: player.owner?.team_id ?? 0,
      status: player.owner ? 'ONTEAM' : 'FREEAGENT',
      fantasy_team_name: player.owner?.name ?? null,
      stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0 },
    }
    const link = tradeLinkForPlayer(asPlayer, fantasyTeams, myTeamId)
    navigate(link.path, { state: link.state })
  }

  const error = teamsQuery.error
    ? getErrorMessage(teamsQuery.error, 'Could not load NBA teams.')
    : seasonQuery.error ? getErrorMessage(seasonQuery.error, 'Could not load this team’s games.') : null

  return {
    loading: teamsQuery.isLoading || (teamId != null && seasonQuery.isFetching && !season),
    error,
    myTeamId,
    nbaTeams: teamOptions,
    teamId,
    pickTeam,
    injOnly,
    setInjOnly,
    season,
    columns,
    reverse,
    pickOptions,
    picked,
    togglePick,
    mode: effectiveMode,
    setMode,
    split,
    rows,
    zReady: zContext !== null,
    faOnly,
    setFaOnly,
    cellMode,
    setCellMode,
    sort,
    setSort,
    openId,
    toggleRow,
    rowView,
    setRowView,
    openTrade,
  }
}

export type WithWithoutState = ReturnType<typeof useWithWithout>
