import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useGetAdpIndexQuery, useGetAdpQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useDebounce } from '../../hooks/useDebounce'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import PlayerDetailSheet from '../../components/draft/PlayerDetailSheet'
import MoveToModal from '../../components/draft/MoveToModal'
import { formatAdp, formatLastYearStat, hydrateAdpPlayer, nextShortSeasonLabel, shortSeasonLabel } from '../../utils/adp'
import { downloadCsv, parseRankingsCsvImport, RANKINGS_CSV_HEADERS, rankingsCsvFileError, toCsv, type RankingsCsvImportResult } from '../../utils/draftCsv'
import {
  EMPTY_RANKINGS,
  mergeIdsIntoRankings,
  moveId,
  orderedPlayers,
  rankingsEqual,
  stablePlayerIds,
  type DraftRankingsState,
} from '../../utils/draftRankings'
import type { AdpPlayer, LastYearStats } from '../../types/api'

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
const LAST_YEAR_COLS: { key: keyof LastYearStats; label: string; pct?: boolean }[] = [
  { key: 'fg_pct', label: 'FG%', pct: true },
  { key: 'ft_pct', label: 'FT%', pct: true },
  { key: 'ppg', label: 'PPG' },
  { key: 'rpg', label: 'RPG' },
  { key: 'apg', label: 'APG' },
  { key: 'spg', label: 'SPG' },
  { key: 'bpg', label: 'BPG' },
  { key: 'three_pm', label: '3PM' },
]
const PAGE_SIZES = [25, 50, 100] as const
type PageSize = (typeof PAGE_SIZES)[number]
type StatsFrom = 'actual' | 'projection'

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function useIsBelowLg() {
  const [below, setBelow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const sync = () => setBelow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return below
}

function pageItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = new Set([1, total, current - 1, current, current + 1, current - 2, current + 2])
  const nums = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const out: (number | 'ellipsis')[] = []
  for (const n of nums) {
    const prev = out[out.length - 1]
    if (typeof prev === 'number' && n - prev > 1) out.push('ellipsis')
    out.push(n)
  }
  return out
}

function DeltaBadge({ rank, compareRank }: { rank: number; compareRank: number | null }) {
  if (compareRank == null) return <span className="text-gray-400">—</span>
  const delta = rank - compareRank
  const cls =
    delta < 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : delta > 0
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-gray-400'
  return <span className={`tabular-nums font-medium ${cls}`}>{delta > 0 ? `+${delta}` : delta}</span>
}

function LastYearCells({ stats }: { stats?: LastYearStats | null }) {
  return (
    <div className="hidden lg:flex items-center shrink-0">
      {LAST_YEAR_COLS.map((col) => (
        <div key={col.key} className="w-11 text-right tabular-nums text-xs text-gray-600 dark:text-gray-300">
          {stats ? formatLastYearStat(stats[col.key], col.pct) : '—'}
        </div>
      ))}
    </div>
  )
}

function FooterStat({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">{label}</div>
      <div className="mt-0.5 tabular-nums text-xs text-gray-700 dark:text-gray-200 leading-tight">{children}</div>
    </div>
  )
}

function RankRowFooter({
  player,
  rank,
  lastRank,
  stats,
}: {
  player: AdpPlayer
  rank: number
  lastRank: number | null
  stats?: LastYearStats | null
}) {
  return (
    <div className="lg:hidden mt-2 w-full space-y-1.5">
      <div className="grid grid-cols-4 gap-x-1 rounded-md bg-blue-50 dark:bg-blue-950/50 ring-1 ring-inset ring-blue-200/80 dark:ring-blue-800 py-1.5 px-0.5">
        <FooterStat label="Blend rank">{player.blend_rank ?? '—'}</FooterStat>
        <FooterStat label="Blend ADP">{formatAdp(player.blend)}</FooterStat>
        <FooterStat label="Δ Blend">
          <DeltaBadge rank={rank} compareRank={player.blend_rank} />
        </FooterStat>
        <FooterStat label="Δ Last">
          <DeltaBadge rank={rank} compareRank={lastRank} />
        </FooterStat>
      </div>
      <div className="grid grid-cols-4 gap-x-1 gap-y-1.5">
        {LAST_YEAR_COLS.map((col) => (
          <FooterStat key={col.key} label={col.label}>
            {stats ? formatLastYearStat(stats[col.key], col.pct) : '—'}
          </FooterStat>
        ))}
      </div>
    </div>
  )
}

function RankRowBody({
  player,
  rank,
  lastRank,
  stats,
}: {
  player: AdpPlayer
  rank: number
  lastRank: number | null
  stats?: LastYearStats | null
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-6 lg:w-10 shrink-0 text-right tabular-nums text-sm font-semibold text-gray-700 dark:text-gray-200">
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <PlayerIdentityCell
            name={player.name}
            playerId={player.espn_id}
            photoUrl={player.photo_url}
            teamAbbr={player.team_abbr}
            positions={player.positions}
            rowSelectOnMobile
            splitMetaOnMobile
          />
        </div>
        <LastYearCells stats={stats} />
        <div
          className="hidden lg:block w-24 shrink-0 text-right text-sm tabular-nums text-gray-500"
          title="Pick order if the board were sorted by Blend ADP"
        >
          {player.blend_rank ?? '—'}
        </div>
        <div className="hidden lg:block w-16 shrink-0 text-right text-sm tabular-nums text-gray-500">
          {formatAdp(player.blend)}
        </div>
        <div className="hidden lg:block w-14 shrink-0 text-right text-sm">
          <DeltaBadge rank={rank} compareRank={player.blend_rank} />
        </div>
        <div className="hidden lg:block w-24 shrink-0 text-right text-sm">
          <DeltaBadge rank={rank} compareRank={lastRank} />
        </div>
      </div>
    </div>
  )
}

function SortableRankRow({
  player,
  rank,
  lastRank,
  stats,
  selected,
  onSelect,
  onMoveTo,
}: {
  player: AdpPlayer
  rank: number
  lastRank: number | null
  stats?: LastYearStats | null
  selected: boolean
  onSelect: () => void
  onMoveTo: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex flex-col gap-0 px-3 py-2.5 sm:py-2 border-b border-gray-100 dark:border-gray-800 select-none ${
        isDragging ? 'opacity-30' : ''
      } ${
        selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/70'
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-3">
        <button
          type="button"
          className="shrink-0 w-7 h-10 lg:w-8 lg:h-10 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab active:cursor-grabbing touch-none touch-manipulation"
          aria-label={`Drag ${player.name} to reorder`}
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="3" r="1.4" />
            <circle cx="11" cy="3" r="1.4" />
            <circle cx="5" cy="8" r="1.4" />
            <circle cx="11" cy="8" r="1.4" />
            <circle cx="5" cy="13" r="1.4" />
            <circle cx="11" cy="13" r="1.4" />
          </svg>
        </button>
        <RankRowBody player={player} rank={rank} lastRank={lastRank} stats={stats} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveTo()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="hidden sm:inline-flex shrink-0 w-[4.5rem] px-2 py-1 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Move to
        </button>
      </div>
      <RankRowFooter player={player} rank={rank} lastRank={lastRank} stats={stats} />
    </div>
  )
}

export default function PreDraftRankingsPage() {
  const { data: index, isLoading, error } = useGetAdpIndexQuery()
  const [saved, setSaved] = usePersistedState<DraftRankingsState>('draft.rankings', EMPTY_RANKINGS())
  const [working, setWorking] = useState<DraftRankingsState>(saved)
  const undoRef = useRef<DraftRankingsState[]>([])
  const redoRef = useRef<DraftRankingsState[]>([])
  const dragOriginRef = useRef<DraftRankingsState | null>(null)
  const didReorderRef = useRef(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState<string[]>([])
  const [teamFilter, setTeamFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [movePlayerId, setMovePlayerId] = useState<string | null>(null)
  const [movePreviewIds, setMovePreviewIds] = useState<string[]>([])
  const [detailsById, setDetailsById] = useState<Map<string, AdpPlayer>>(() => new Map())
  const [detailsSeason, setDetailsSeason] = useState<{ last?: string; proj?: string }>({})
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<Extract<RankingsCsvImportResult, { ok: true }> | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [statsFrom, setStatsFrom] = usePersistedState<StatsFrom>('draft.rankings.statsFrom', 'actual')
  const [pageSize, setPageSize] = usePersistedState<PageSize>('draft.rankings.pageSize', 50)
  const [page, setPage] = useState(1)
  const resetMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const isBelowLg = useIsBelowLg()
  const debouncedSearch = useDebounce(search, 200)
  const posKey = posFilter.join(',')

  const players = useMemo(() => index?.players ?? [], [index])
  const season = index?.season_label || '2025-26'
  const playerIds = useMemo(() => players.map((p) => p.id), [players])
  const board = useMemo(() => mergeIdsIntoRankings(working, playerIds, season), [working, playerIds, season])
  const savedBoard = useMemo(() => mergeIdsIntoRankings(saved, playerIds, season), [saved, playerIds, season])
  const dirty = !rankingsEqual(board, savedBoard)
  const savedRankById = useMemo(() => {
    if (!saved.order.length) return null
    return new Map(saved.order.map((id, i) => [id, i + 1]))
  }, [saved.order])

  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  useEffect(() => {
    if (!resetOpen && !moreOpen) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (resetMenuRef.current && !resetMenuRef.current.contains(target)) setResetOpen(false)
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [resetOpen, moreOpen])

  const commit = useCallback(
    (next: DraftRankingsState) => {
      undoRef.current = [...undoRef.current, board].slice(-50)
      redoRef.current = []
      setWorking(next)
    },
    [board],
  )

  const saveRankings = useCallback(() => {
    setSaved(board)
    undoRef.current = []
    redoRef.current = []
  }, [board, setSaved])

  const restoreSaved = () => {
    if (!dirty) return
    commit(savedBoard)
    setResetOpen(false)
  }

  const resetToBlend = () => {
    commit({ ...board, order: playerIds })
    setResetOpen(false)
  }

  const ordered = useMemo(() => orderedPlayers(players, board.order), [players, board.order])
  const teams = index?.teams ?? []

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    return ordered.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.team_abbr || '').toLowerCase().includes(q)) return false
      if (teamFilter && p.team_abbr !== teamFilter) return false
      if (posFilter.length && !posFilter.some((pos) => p.positions.includes(pos))) return false
      return true
    })
  }, [ordered, debouncedSearch, teamFilter, posFilter])

  const resolvedPageSize: PageSize = PAGE_SIZES.includes(pageSize) ? pageSize : 50
  const totalPages = Math.max(1, Math.ceil(visible.length / resolvedPageSize))
  const safePage = Math.min(page, totalPages)
  const paged = useMemo(() => {
    const start = (safePage - 1) * resolvedPageSize
    return visible.slice(start, start + resolvedPageSize)
  }, [visible, safePage, resolvedPageSize])
  const from = visible.length === 0 ? 0 : (safePage - 1) * resolvedPageSize + 1
  const to = Math.min(safePage * resolvedPageSize, visible.length)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, teamFilter, posKey, resolvedPageSize])

  const neededDetailIds = useMemo(() => {
    const ids = paged.map((p) => p.id)
    ids.push(...movePreviewIds)
    if (movePlayerId) ids.push(movePlayerId)
    if (activeId) ids.push(activeId)
    if (selectedId) ids.push(selectedId)
    return stablePlayerIds(ids)
  }, [paged, movePreviewIds, movePlayerId, activeId, selectedId])
  const missingDetailIds = useMemo(
    () => neededDetailIds.filter((id) => !detailsById.has(id)),
    [neededDetailIds, detailsById],
  )
  const { data: details } = useGetAdpQuery(
    { ids: missingDetailIds.join(',') },
    { skip: missingDetailIds.length === 0 },
  )
  useEffect(() => {
    if (!details) return
    if (details.last_year_season || details.projection_season) {
      setDetailsSeason({ last: details.last_year_season ?? undefined, proj: details.projection_season ?? undefined })
    }
    if (!details.players.length) return
    setDetailsById((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const p of details.players) {
        if (next.get(p.id) !== p) {
          next.set(p.id, p)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [details])
  const onMoveNeedIds = useCallback((ids: string[]) => {
    setMovePreviewIds((prev) => {
      const next = stablePlayerIds(ids)
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev
      return next
    })
  }, [])
  const closeMoveTo = useCallback(() => {
    setMovePlayerId(null)
    setMovePreviewIds([])
  }, [])
  const playersById = useMemo(() => {
    const next = new Map<string, AdpPlayer>()
    for (const p of ordered) next.set(p.id, hydrateAdpPlayer(p, detailsById.get(p.id)))
    return next
  }, [ordered, detailsById])
  const pagedFull = useMemo(
    () => paged.map((p) => hydrateAdpPlayer(p, detailsById.get(p.id))),
    [paged, detailsById],
  )
  const resolvedStatsFrom: StatsFrom = statsFrom === 'projection' ? 'projection' : 'actual'
  const actualSeasonShort = shortSeasonLabel(details?.last_year_season || detailsSeason.last) || '25/26'
  const projectionSeasonShort = nextShortSeasonLabel(details?.last_year_season || detailsSeason.last)
  const statsTitle =
    resolvedStatsFrom === 'projection'
      ? `ESPN per-game projections for ${details?.projection_season || detailsSeason.proj || projectionSeasonShort}`
      : `Per-game averages from ${details?.last_year_season || detailsSeason.last || 'last season'}. Blank if they did not play.`
  const playerStats = (p: AdpPlayer) => (resolvedStatsFrom === 'projection' ? p.projection : p.last_year)

  const selectedPlayer = selectedId ? playersById.get(selectedId) ?? null : null
  const selectedRank = selectedId ? board.order.indexOf(selectedId) + 1 : 0
  const movePlayer = movePlayerId ? playersById.get(movePlayerId) ?? null : null
  const moveRank = movePlayerId ? board.order.indexOf(movePlayerId) + 1 : 0
  const activePlayer = activeId ? playersById.get(activeId) ?? null : null
  const activeRank = activeId ? board.order.indexOf(activeId) + 1 : 0

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = (event: DragStartEvent) => {
    dragOriginRef.current = board
    didReorderRef.current = false
    setActiveId(String(event.active.id))
    setSelectedId(String(event.active.id))
  }

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setWorking((prev) => {
      const merged = mergeIdsIntoRankings(prev, playerIds, season)
      const oldIndex = merged.order.indexOf(String(active.id))
      const newIndex = merged.order.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev
      didReorderRef.current = true
      return { ...merged, order: arrayMove(merged.order, oldIndex, newIndex) }
    })
  }

  const finishDrag = (cancelled: boolean) => {
    const origin = dragOriginRef.current
    dragOriginRef.current = null
    setActiveId(null)
    if (cancelled) {
      if (origin) setWorking(origin)
      didReorderRef.current = false
      return
    }
    if (didReorderRef.current && origin) {
      undoRef.current = [...undoRef.current, origin].slice(-50)
      redoRef.current = []
    }
    didReorderRef.current = false
  }

  const onDragEnd = (_event: DragEndEvent) => finishDrag(false)
  const onDragCancel = () => finishDrag(true)

  const revealRank = useCallback(
    (index: number) => {
      const nextPage = Math.floor(Math.max(0, index) / resolvedPageSize) + 1
      setPage(nextPage)
    },
    [resolvedPageSize],
  )

  const moveSelected = useCallback(
    (delta: number) => {
      if (!selectedId) return
      const fromIdx = board.order.indexOf(selectedId)
      if (fromIdx < 0) return
      const nextIndex = Math.max(0, Math.min(board.order.length - 1, fromIdx + delta))
      if (nextIndex === fromIdx) return
      commit({ ...board, order: moveId(board.order, selectedId, nextIndex) })
      revealRank(nextIndex)
    },
    [board, commit, revealRank, selectedId],
  )

  const confirmMoveTo = (id: string, rank: number) => {
    const nextOrder = moveId(board.order, id, rank - 1)
    const same = nextOrder.length === board.order.length && nextOrder.every((x, i) => x === board.order[i])
    if (!same) commit({ ...board, order: nextOrder })
    closeMoveTo()
    setSelectedId(id)
    revealRank(rank - 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) saveRankings()
        return
      }
      if (typing) return
      if (movePlayerId || pendingImport) return
      if (e.key === 'Escape') {
        setSelectedId(null)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          const next = redoRef.current.pop()
          if (!next) return
          undoRef.current.push(board)
          setWorking(next)
        } else {
          const prev = undoRef.current.pop()
          if (!prev) return
          redoRef.current.push(board)
          setWorking(prev)
        }
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveSelected(-1)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelected(1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [board, dirty, movePlayerId, pendingImport, moveSelected, saveRankings])

  const exportCsv = () => {
    const header = [...RANKINGS_CSV_HEADERS]
    const rows = ordered.map((p, i) => [
      String(i + 1),
      p.id,
      p.name,
      p.team_abbr ?? '',
      p.positions.join('/'),
    ])
    downloadCsv('pre-draft-rankings.csv', toCsv([header, ...rows]))
  }

  const importCsv = (file: File) => {
    const fileError = rankingsCsvFileError(file)
    if (fileError) {
      setImportMsg(fileError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = parseRankingsCsvImport(
        String(reader.result || ''),
        players.map((p) => ({ id: p.id, name: p.name })),
      )
      if (!result.ok) {
        setImportMsg(result.error)
        return
      }
      setPendingImport(result)
    }
    reader.readAsText(file)
  }

  useEffect(() => {
    if (!pendingImport) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingImport(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [pendingImport])

  const confirmPendingImport = () => {
    if (!pendingImport) return
    commit({ ...board, order: pendingImport.order })
    setImportMsg(
      pendingImport.unknown.length
        ? `Imported ${pendingImport.matched} players. Unmatched: ${pendingImport.unknown.slice(0, 8).join(', ')}${pendingImport.unknown.length > 8 ? '…' : ''}`
        : `Imported ${pendingImport.matched} players.`,
    )
    setPendingImport(null)
  }

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages))
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const btnGhost =
    'px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
  const pagerBtn = (active: boolean, disabled?: boolean) => {
    if (disabled) return 'px-2 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed'
    if (active) return 'px-2 py-1 rounded text-xs font-semibold border bg-blue-600 text-white border-blue-600'
    return 'px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load ADP')} />

  const undo = () => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(board)
    setWorking(prev)
  }
  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(board)
    setWorking(next)
  }

  const menuItem =
    'w-full text-left px-3 py-2.5 sm:py-2 text-sm sm:text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed'
  const saveClass = dirty
    ? 'btn-primary text-xs py-2 sm:py-1.5 px-3 ring-2 ring-blue-300 dark:ring-blue-500 shadow-md'
    : 'px-3 py-2 sm:py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-400 cursor-not-allowed'

  return (
    <div className={`max-w-screen-2xl mx-auto px-4 sm:px-6 ${dirty ? 'pb-24 lg:pb-0' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Pre-Draft Rankings</h1>
          <p className="hidden sm:block text-sm text-gray-500 dark:text-gray-400 mt-1">
            Drag the handle to reorder. Starts in Blend ADP order. Edits stay on this page until you save.
          </p>
          <p className="sm:hidden text-sm text-gray-500 dark:text-gray-400 mt-1">
            Drag to reorder. Tap a player for stats and actions.
          </p>
          {dirty ? (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mt-1">Unsaved changes</p>
          ) : null}
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <Link to="/draft/adp" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
            ADP table
          </Link>
          <Link to="/draft/board" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
            Open draft board
          </Link>
        </div>
      </div>

      <div className="card p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player…"
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 sm:py-1.5 text-base sm:text-sm w-full sm:w-48"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 sm:py-1.5 text-base sm:text-sm"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setPosFilter((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]))}
                className={`min-w-[2.5rem] px-2 py-1.5 sm:py-1 rounded text-xs font-semibold border ${
                  posFilter.includes(pos)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Show stats from</span>
            {([
              ['actual', actualSeasonShort],
              ['projection', `${projectionSeasonShort} proj`],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setStatsFrom(mode)}
                className={`px-2 py-1.5 sm:py-1 rounded text-xs font-semibold border ${
                  resolvedStatsFrom === mode
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={saveRankings} disabled={!dirty} className={saveClass}>
            Save rankings
          </button>
          <div className="hidden sm:flex flex-wrap items-center gap-2">
            <div ref={resetMenuRef} className="relative">
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setMoreOpen(false)
                  setResetOpen((o) => !o)
                }}
                aria-expanded={resetOpen}
                aria-haspopup="menu"
              >
                Reset ▾
              </button>
              {resetOpen && (
                <div
                  role="menu"
                  className="absolute left-0 mt-1 z-20 min-w-[13rem] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1"
                >
                  <button type="button" role="menuitem" disabled={!dirty} onClick={restoreSaved} className={menuItem}>
                    Restore saved board
                  </button>
                  <button type="button" role="menuitem" onClick={resetToBlend} className={menuItem}>
                    Reset to Blend ADP
                  </button>
                </div>
              )}
            </div>
            <button type="button" className={btnGhost} onClick={undo}>
              Undo
            </button>
            <button type="button" className={btnGhost} onClick={redo}>
              Redo
            </button>
            <button type="button" className={btnGhost} onClick={exportCsv}>
              Export CSV
            </button>
            <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
              Import CSV
            </button>
          </div>
          <div ref={moreMenuRef} className="relative sm:hidden ml-auto">
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setResetOpen(false)
                setMoreOpen((o) => !o)
              }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              More
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1 z-20 min-w-[13rem] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!dirty}
                  onClick={() => {
                    restoreSaved()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Restore saved board
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    resetToBlend()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Reset to Blend ADP
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    undo()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Undo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    redo()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Redo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    exportCsv()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    fileRef.current?.click()
                    setMoreOpen(false)
                  }}
                  className={menuItem}
                >
                  Import CSV
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importCsv(file)
              e.target.value = ''
            }}
          />
        </div>
        {selectedPlayer ? (
          <div className="hidden lg:flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
            <span className="text-xs text-gray-500">Selected</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{selectedPlayer.name}</span>
            <span className="text-xs text-gray-400">#{selectedRank > 0 ? selectedRank : '—'}</span>
            <button type="button" className={btnGhost} onClick={() => moveSelected(-1)} aria-label="Move up">
              ↑ Up
            </button>
            <button type="button" className={btnGhost} onClick={() => moveSelected(1)} aria-label="Move down">
              ↓ Down
            </button>
            <button type="button" className={btnGhost} onClick={() => setMovePlayerId(selectedPlayer.id)}>
              Move to…
            </button>
          </div>
        ) : (
          <p className="hidden lg:block text-xs text-gray-400">Click a player to select, then use ↑/↓ or drag the handle.</p>
        )}
        {importMsg ? (
          <p
            className={`text-sm ${
              importMsg.startsWith('Imported ')
                ? 'text-gray-600 dark:text-gray-300'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {importMsg}
          </p>
        ) : null}
      </div>

      <div ref={listRef} className="card overflow-x-hidden">
        <div className="lg:hidden flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <div className="w-7 shrink-0" />
          <div className="w-6 shrink-0 text-right">Rank</div>
          <div className="min-w-0 flex-1">Player</div>
        </div>
        <div className="hidden lg:flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <div className="w-8 shrink-0" />
          <div className="w-10 shrink-0 text-right">Rank</div>
          <div className="min-w-0 flex-1">Player</div>
          <div className="flex items-center shrink-0" title={statsTitle}>
            {LAST_YEAR_COLS.map((col) => (
              <div key={col.key} className="w-11 text-right">
                {col.label}
              </div>
            ))}
          </div>
          <div className="w-24 shrink-0 text-right" title="Pick order if the board were sorted by Blend ADP.">
            Blend ranking
          </div>
          <div className="w-16 shrink-0 text-right" title="Average ADP across all sites that list this player.">
            Blend ADP
          </div>
          <div className="w-14 shrink-0 text-right" title="Your rank minus Blend rank. Negative means you are higher on them.">
            Δ vs Blend
          </div>
          <div
            className="w-24 shrink-0 text-right leading-tight"
            title="Your rank minus last saved rank. Negative means you moved them up since the last save. Dash if you have not saved yet."
          >
            Δ vs Last Rankings
          </div>
          <div className="w-[4.25rem] shrink-0" />
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext items={pagedFull.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {pagedFull.map((p) => {
              const rank = board.order.indexOf(p.id) + 1
              return (
                <SortableRankRow
                  key={p.id}
                  player={p}
                  rank={rank > 0 ? rank : 0}
                  lastRank={savedRankById?.get(p.id) ?? null}
                  stats={playerStats(p)}
                  selected={selectedId === p.id}
                  onSelect={() => setSelectedId((id) => (id === p.id ? null : p.id))}
                  onMoveTo={() => {
                    setSelectedId(p.id)
                    setMovePlayerId(p.id)
                  }}
                />
              )
            })}
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
            {activePlayer ? (
              <div className="flex flex-col px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-900 shadow-xl w-[calc(100vw-1.5rem)] max-w-lg">
                <div className="flex items-start lg:items-center gap-3">
                  <div className="w-8 shrink-0 flex items-center justify-center text-gray-400">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="3" r="1.4" />
                      <circle cx="11" cy="3" r="1.4" />
                      <circle cx="5" cy="8" r="1.4" />
                      <circle cx="11" cy="8" r="1.4" />
                      <circle cx="5" cy="13" r="1.4" />
                      <circle cx="11" cy="13" r="1.4" />
                    </svg>
                  </div>
                  <RankRowBody
                    player={activePlayer}
                    rank={activeRank > 0 ? activeRank : 0}
                    lastRank={savedRankById?.get(activePlayer.id) ?? null}
                    stats={playerStats(activePlayer)}
                  />
                </div>
                <RankRowFooter
                  player={activePlayer}
                  rank={activeRank > 0 ? activeRank : 0}
                  lastRank={savedRankById?.get(activePlayer.id) ?? null}
                  stats={playerStats(activePlayer)}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        {visible.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">No players match these filters.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <span className="sm:hidden">
                {from}–{to} of {visible.length}
              </span>
              <span className="hidden sm:inline">
                Showing {from}–{to} of {visible.length}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                Per page
                <select
                  value={resolvedPageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                  className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 sm:py-1 text-sm"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={pagerBtn(false, safePage <= 1)} disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)}>
                Prev
              </button>
              <span className="sm:hidden text-xs tabular-nums text-gray-500">
                {safePage}/{totalPages}
              </span>
              <div className="hidden sm:flex flex-wrap items-center gap-2">
                {pageItems(safePage, totalPages).map((item, i) =>
                  item === 'ellipsis' ? (
                    <span key={`e${i}`} className="px-1 text-xs text-gray-400">
                      …
                    </span>
                  ) : (
                    <button key={item} type="button" className={pagerBtn(item === safePage)} onClick={() => goToPage(item)}>
                      {item}
                    </button>
                  ),
                )}
              </div>
              <button
                type="button"
                className={pagerBtn(false, safePage >= totalPages)}
                disabled={safePage >= totalPages}
                onClick={() => goToPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {isBelowLg && selectedPlayer && !movePlayer && !activeId ? (
        <PlayerDetailSheet
          player={selectedPlayer}
          rank={selectedRank > 0 ? selectedRank : 0}
          lastRank={savedRankById?.get(selectedPlayer.id) ?? null}
          stats={playerStats(selectedPlayer)}
          statsLabel={
            resolvedStatsFrom === 'projection'
              ? `${projectionSeasonShort} projections`
              : actualSeasonShort
          }
          dirty={dirty}
          onClose={() => setSelectedId(null)}
          onMoveUp={() => moveSelected(-1)}
          onMoveDown={() => moveSelected(1)}
          onMoveTo={() => setMovePlayerId(selectedPlayer.id)}
          onSave={saveRankings}
        />
      ) : null}
      {movePlayer ? (
        <MoveToModal
          player={movePlayer}
          currentRank={moveRank > 0 ? moveRank : 1}
          order={board.order}
          playersById={playersById}
          onConfirm={(rank) => confirmMoveTo(movePlayer.id, rank)}
          onClose={closeMoveTo}
          onNeedIds={onMoveNeedIds}
        />
      ) : null}
      {pendingImport ? (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={() => setPendingImport(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-confirm-title"
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-confirm-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Replace current order?
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              This will replace your current order with {pendingImport.matched} players from this CSV. The change
              stays unsaved until you click Save.
            </p>
            {pendingImport.unknown.length ? (
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                {pendingImport.unknown.length} id{pendingImport.unknown.length === 1 ? '' : 's'} in the file are not on
                the current board and will be skipped.
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button type="button" onClick={confirmPendingImport} className="btn-primary flex-1 sm:flex-none text-sm py-2.5 sm:py-1.5 px-4">
                Replace order
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dirty && !selectedId ? (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={saveRankings} className="btn-primary w-full py-2.5 text-sm">
            Save rankings
          </button>
        </div>
      ) : null}
    </div>
  )
}
