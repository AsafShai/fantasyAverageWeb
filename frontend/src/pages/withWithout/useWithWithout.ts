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
import type { WithWithoutGame, WithWithoutPlayer, WithWithoutTeam } from '../../types/withWithout'
import {
  MAX_PICKS, SMALL_SAMPLE, buildZContext, gameLogCell, joinNames, missedGames, nbaAbbr, splitGames, teammateRows,
  type GameKind, type MatchMode, type TeammateRow,
} from '../../utils/withWithout'

/** What the category cells show (desktop). */
export type CellMode = 'delta' | 'with' | 'without'
/** 'zw' / 'zwo' / 'zd' (Z with, without, change) or a column (MIN / a category). */
export type SortKey = string
export type LogFilter = 'all' | 'with' | 'without'

export const Z_SORTS: { key: SortKey; label: string; tip: string }[] = [
  { key: 'zw', label: 'Z with', tip: 'Fantasy value in games with them' },
  { key: 'zwo', label: 'Z without', tip: 'Fantasy value in games without them' },
  { key: 'zd', label: 'Z change', tip: 'Z without minus Z with' },
]

export interface TeamOption extends WithWithoutTeam {
  /** Players from your fantasy roster on this NBA team. */
  mine: number
}

export interface PickOption {
  player: WithWithoutPlayer
  missed: number
  onTeam: number
}

export interface GameSplit {
  kinds: GameKind[]
  counts: { with: number; without: number; unused: number }
  /** "Haliburton & Siakam" — who the comparison is without. */
  names: string
}

export interface LogGame {
  game: WithWithoutGame
  kind: GameKind
  /** He was on the team but didn't play. */
  dnp: boolean
  cells: string[]
}

export interface GameLog {
  tabs: { key: LogFilter; label: string; count: number }[]
  games: LogGame[]
}

const ZERO_STATS = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0 }

/** The page's state and everything derived from it; the desktop and phone
 * layouts only render it. */
export function useWithWithout() {
  const navigate = useNavigate()
  const { myTeamId } = useMyTeam()
  const teamsQuery = useGetWithWithoutTeamsQuery()
  const [savedTeam, setSavedTeam] = usePersistedState<number | null>('withWithout.team', null)
  const [pickedIds, setPickedIds] = useState<number[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mode, setMode] = useState<MatchMode>('all')
  const [faOnly, setFaOnlyState] = useState(false)
  const [mineOnly, setMineOnlyState] = useState(false)
  const [minGames, setMinGames] = useState(true)
  const [cellMode, setCellMode] = useState<CellMode>('delta')
  const [sort, setSort] = useState<SortKey>('zwo')
  const [showGames, setShowGames] = useState(false)
  const [openIds, setOpenIds] = useState<number[]>([])
  const [logIds, setLogIds] = useState<number[]>([])
  const [logFilters, setLogFilters] = useState<Record<number, LogFilter>>({})

  // Z is scored against the Player Rankings pool at its defaults (same request
  // as that page, so the cache is shared). The same list says which NBA teams
  // your fantasy players are on.
  const playersQuery = useGetAllPlayersQuery({ limit: 1200, time_period: 'season' })
  const { data: fantasyTeams = [] } = useGetTeamsListQuery()

  const nbaTeams: TeamOption[] = useMemo(() => {
    const mine = new Map<string, number>()
    for (const p of playersQuery.data?.players ?? []) {
      if (myTeamId != null && p.team_id === myTeamId && p.pro_team) {
        const abbr = nbaAbbr(p.pro_team)
        mine.set(abbr, (mine.get(abbr) ?? 0) + 1)
      }
    }
    return (teamsQuery.data?.teams ?? [])
      .map(t => ({ ...t, mine: mine.get(t.abbr) ?? 0 }))
      .sort((a, b) => Number(b.mine > 0) - Number(a.mine > 0) || Number(b.has_out_today) - Number(a.has_out_today) || a.name.localeCompare(b.name))
  }, [teamsQuery.data, playersQuery.data, myTeamId])

  // No team until one is picked: a remembered team only if it still exists.
  const teamId = savedTeam != null && (teamsQuery.data?.teams ?? []).some(t => t.team_id === savedTeam) ? savedTeam : null
  const team = nbaTeams.find(t => t.team_id === teamId) ?? null

  const seasonQuery = useGetWithWithoutTeamQuery(teamId ?? 0, { skip: teamId == null })
  const season = seasonQuery.data && seasonQuery.data.team_id === teamId ? seasonQuery.data : undefined

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

  /** Who can be added: players who missed games, out today first, then most missed. */
  const pickOptions: PickOption[] = useMemo(() => {
    if (!season) return []
    return season.players
      .filter(p => !pickedIds.includes(p.player_id))
      .map(player => ({ player, ...missedGames(player) }))
      .filter(o => o.missed > 0)
      .sort((a, b) => Number(!!b.player.out_today) - Number(!!a.player.out_today) || b.missed - a.missed || a.player.name.localeCompare(b.player.name))
  }, [season, pickedIds])

  const split: GameSplit | null = useMemo(() => {
    if (!season || picked.length === 0) return null
    const kinds = splitGames(season, picked, effectiveMode)
    return {
      kinds,
      counts: {
        with: kinds.filter(k => k === 'with').length,
        without: kinds.filter(k => k === 'without').length,
        unused: kinds.filter(k => k === 'unused').length,
      },
      names: joinNames(picked.map(p => p.name), effectiveMode === 'all' ? '&' : 'or'),
    }
  }, [season, picked, effectiveMode])

  const allRows: TeammateRow[] = useMemo(() => {
    if (!season || !split) return []
    return teammateRows(season, pickedIds, split.kinds, columns, zContext)
  }, [season, split, pickedIds, columns, zContext])

  const { rows, hiddenSmall } = useMemo(() => {
    let out = allRows
    if (faOnly) out = out.filter(r => r.player.owner === null)
    if (mineOnly) out = out.filter(r => myTeamId != null && r.player.owner?.team_id === myTeamId)
    const small = out.filter(r => r.small).length
    if (minGames) out = out.filter(r => !r.small)
    const key = (r: TeammateRow): number => {
      const z = sort === 'zw' ? r.zWith : sort === 'zwo' ? r.zWithout : sort === 'zd' ? r.zDelta : undefined
      if (z !== undefined) return z ?? -Infinity
      const v = cellMode === 'with' ? r.withVals[sort] : cellMode === 'without' ? r.withoutVals[sort] : r.deltas[sort]
      if (v === undefined || Number.isNaN(v)) return -Infinity
      return reverse.has(sort) ? -v : v
    }
    return { rows: [...out].sort((a, b) => key(b) - key(a)), hiddenSmall: minGames ? small : 0 }
  }, [allRows, faOnly, mineOnly, minGames, sort, cellMode, reverse, myTeamId])

  const toggleIn = (list: number[], id: number) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  const resetRows = () => { setOpenIds([]); setLogIds([]) }

  const addPick = (id: number) => {
    setPickedIds(prev => (prev.includes(id) || prev.length >= MAX_PICKS ? prev : [...prev, id]))
    setPickerOpen(false)
    resetRows()
  }
  const removePick = (id: number) => {
    setPickedIds(prev => prev.filter(x => x !== id))
    resetRows()
  }

  const pickTeam = (id: number | null) => {
    setSavedTeam(id)
    setPickedIds([])
    setPickerOpen(false)
    resetRows()
  }

  /** The row's game-by-game log: every game he was on the team for. */
  const gameLog = (row: TeammateRow): GameLog => {
    const filter = logFilters[row.player.player_id] ?? 'all'
    const games: LogGame[] = []
    if (season && split) {
      row.player.lines.forEach((e, i) => {
        if (e === null) return
        games.push({
          game: season.games[i],
          kind: split.kinds[i],
          dnp: e === 0,
          cells: columns.map(c => (Array.isArray(e) ? gameLogCell(e, season.line_fields, c) : '—')),
        })
      })
    }
    const countOf = (k: LogFilter) => games.filter(g => k === 'all' || (!g.dnp && g.kind === k)).length
    return {
      tabs: (['all', 'without', 'with'] as LogFilter[]).map(key => ({
        key, count: countOf(key), label: key === 'all' ? 'All games' : key === 'with' ? 'With' : 'Without',
      })),
      games: games.filter(g => filter === 'all' || (!g.dnp && g.kind === filter)),
    }
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
      stats: ZERO_STATS,
    }
    const link = tradeLinkForPlayer(asPlayer, fantasyTeams, myTeamId)
    navigate(link.path, { state: link.state })
  }

  const error = teamsQuery.error
    ? getErrorMessage(teamsQuery.error, 'Could not load NBA teams.')
    : seasonQuery.error ? getErrorMessage(seasonQuery.error, 'Could not load this team’s games.') : null

  return {
    teamsLoading: teamsQuery.isLoading,
    loading: teamId != null && seasonQuery.isFetching && !season,
    error,
    myTeamId,
    nbaTeams,
    team,
    teamId,
    pickTeam,
    season,
    columns,
    reverse,
    picked,
    pickOptions,
    canAdd: picked.length < MAX_PICKS && pickOptions.length > 0,
    pickerOpen,
    setPickerOpen,
    addPick,
    removePick,
    mode: effectiveMode,
    setMode,
    split,
    showGames,
    setShowGames,
    rows,
    hiddenSmall,
    smallSample: SMALL_SAMPLE,
    zReady: zContext !== null,
    faOnly,
    setFaOnly: (on: boolean) => { setFaOnlyState(on); if (on) setMineOnlyState(false) },
    mineOnly,
    setMineOnly: (on: boolean) => { setMineOnlyState(on); if (on) setFaOnlyState(false) },
    minGames,
    setMinGames,
    cellMode,
    setCellMode,
    sort,
    setSort,
    isOpen: (id: number) => openIds.includes(id),
    toggleRow: (id: number) => setOpenIds(prev => toggleIn(prev, id)),
    isLogOpen: (id: number) => logIds.includes(id),
    toggleLog: (id: number) => setLogIds(prev => toggleIn(prev, id)),
    logFilter: (id: number): LogFilter => logFilters[id] ?? 'all',
    setLogFilter: (id: number, f: LogFilter) => setLogFilters(prev => ({ ...prev, [id]: f })),
    gameLog,
    openTrade,
  }
}

export type WithWithoutState = ReturnType<typeof useWithWithout>
