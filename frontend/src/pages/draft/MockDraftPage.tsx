import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useGetAdpIndexQuery, useGetAdpQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useBlendSites } from '../../hooks/useBlendSites'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import LeagueSettingsFields, { Stepper } from '../../components/draft/LeagueSettingsFields'
import { parseRankingsCsvImport, rankingsCsvFileError } from '../../utils/draftCsv'
import { EMPTY_RANKINGS, stablePlayerIds, type DraftRankingsState } from '../../utils/draftRankings'
import { DEFAULT_DRAFT_METRIC } from '../../utils/adp'
import {
  clearMockClock,
  clearMockPaused,
  clearMockQueue,
  clearMockSession,
  readMockClock,
  readMockPaused,
  readMockSession,
  shouldRestorePaused,
  writeMockClock,
  writeMockPaused,
  writeMockSession,
} from '../../utils/mockDraftPersistence'

const MockDraftRoom = lazy(() => import('./MockDraftRoom'))
import {
  applyBotPick,
  applyDraftPick,
  autoUserPick,
  buildUserOrder,
  clampMockSettings,
  csvHasEnoughPlayers,
  createMockSession,
  DEFAULT_MOCK_SETTINGS,
  isMockComplete,
  isUserOnTheClock,
  moveUserRosterPlayer,
  pickCount,
  runBotsUntilUser,
  type MockDraftSettings,
  type MockSession,
  type RankingSource,
} from '../../utils/mockDraft'

const SOURCE_LABEL: Record<RankingSource, string> = {
  saved: 'Saved rankings',
  default: 'Default',
  csv: 'Import CSV',
}

function Choice<T extends string | number>({
  value,
  selected,
  onClick,
  children,
  disabled,
}: {
  value: T
  selected: boolean
  onClick: (value: T) => void
  children: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(value)}
      className={`min-h-11 px-3 py-1.5 text-xs font-semibold rounded-md border disabled:opacity-40 ${
        selected
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

export default function MockDraftPage() {
  const [settingsRaw, setSettingsRaw] = usePersistedState<MockDraftSettings>('draft.mock.settings', DEFAULT_MOCK_SETTINGS)
  const settings = useMemo(() => clampMockSettings(settingsRaw), [settingsRaw])
  const [saved] = usePersistedState<DraftRankingsState>('draft.rankings', EMPTY_RANKINGS())
  const hasSaved = saved.order.length > 0
  const [csvOrder, setCsvOrder] = useState<string[] | null>(null)
  const [csvMatched, setCsvMatched] = useState(0)
  const [csvName, setCsvName] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [restored] = useState(readMockSession)
  const [session, setSession] = useState<MockSession | null>(restored)
  const [clockDeadlineMs, setClockDeadlineMs] = useState<number | null>(null)
  const [clockFrozenSec, setClockFrozenSec] = useState<number | null>(null)
  const [paused, setPaused] = useState(() =>
    restored ? readMockPaused() || shouldRestorePaused(restored) : false,
  )
  const [carriedClock] = useState(() => (restored ? readMockClock() : null))
  const carriedClockPicks = useRef(restored ? restored.picks.length : -1)
  const remainingRef = useRef<number | null>(null)
  const deadlineRef = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { sitesParam, rankSitesParam } = useBlendSites(DEFAULT_DRAFT_METRIC)
  const { data, isLoading, error } = useGetAdpIndexQuery({
    metric: DEFAULT_DRAFT_METRIC,
    sites: sitesParam,
    rank_sites: rankSitesParam,
  })
  const indexPlayers = data?.players ?? []
  const prefetchIds = useMemo(
    () => stablePlayerIds(indexPlayers.slice(0, 25).map((p) => p.id)).join(','),
    [indexPlayers],
  )
  useGetAdpQuery(
    { ids: prefetchIds, include_stats: true, ranked_only: false },
    { skip: prefetchIds.length === 0 },
  )
  const defaultOrder = useMemo(() => indexPlayers.map((p) => p.id), [indexPlayers])
  const needed = pickCount(settings.teams, settings.rounds)

  const patch = (partial: Partial<MockDraftSettings>) => {
    setSettingsRaw((prev) => clampMockSettings({ ...clampMockSettings(prev), ...partial }))
  }

  useEffect(() => {
    if (!hasSaved && settings.rankingSource === 'saved') patch({ rankingSource: 'default' })
  }, [hasSaved, settings.rankingSource])

  useEffect(() => {
    writeMockPaused(paused)
  }, [paused])

  useEffect(() => {
    if (session) writeMockSession(session)
    else clearMockSession()
    // only a clock saved by the pagehide handler below is ever fresh enough to restore
    clearMockClock()
  }, [session])

  useEffect(() => {
    if (!session || isMockComplete(session)) return
    // ticked, not just written on the way out: a tab killed outright never gets
    // pagehide, and the value is one number, so writing it often is free
    const save = () => {
      const left =
        deadlineRef.current != null
          ? Math.max(0, (deadlineRef.current - Date.now()) / 1000)
          : remainingRef.current
      if (left != null && left > 0) writeMockClock(left)
    }
    const ticker = window.setInterval(save, 2000)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.clearInterval(ticker)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
    }
  }, [session])

  const importCsv = (file: File) => {
    setSetupError(null)
    const fileError = rankingsCsvFileError(file)
    if (fileError) {
      setSetupError(fileError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = parseRankingsCsvImport(
        String(reader.result || ''),
        indexPlayers.map((p) => ({ id: p.id, name: p.name })),
        { minMatched: needed },
      )
      if (!result.ok) {
        setCsvOrder(null)
        setCsvMatched(0)
        setCsvName(null)
        setSetupError(result.error)
        return
      }
      if (!csvHasEnoughPlayers(result.matched, settings.teams, settings.rounds)) {
        setCsvOrder(null)
        setCsvMatched(result.matched)
        setCsvName(file.name)
        setSetupError(
          `That CSV matched ${result.matched} players; this mock needs at least ${needed} (league size × rounds).`,
        )
        return
      }
      setCsvOrder(result.order)
      setCsvMatched(result.matched)
      setCsvName(file.name)
      patch({ rankingSource: 'csv' })
    }
    reader.readAsText(file)
  }

  const startMock = () => {
    setSetupError(null)
    const next = clampMockSettings(settings)
    if (indexPlayers.length < needed) {
      setSetupError(`Need at least ${needed} ranked players to start this mock.`)
      return
    }
    if (next.rankingSource === 'saved' && !hasSaved) {
      setSetupError('Save a board on Pre-Draft Rankings first, or choose Default.')
      return
    }
    if (next.rankingSource === 'csv') {
      if (!csvOrder) {
        setSetupError('Import a Pre-Draft Rankings CSV first.')
        return
      }
      if (!csvHasEnoughPlayers(csvMatched, next.teams, next.rounds)) {
        setSetupError(`That CSV matched ${csvMatched} players; this mock needs at least ${needed}.`)
        return
      }
    }
    const userOrder = buildUserOrder(defaultOrder, next.rankingSource, saved.order, csvOrder ?? [])
    let live = createMockSession({
      settings: next,
      defaultOrder,
      userOrder,
      players: indexPlayers,
    })
    if (next.botDelaySec === 0) live = runBotsUntilUser(live)
    carriedClockPicks.current = -1
    clearMockQueue()
    clearMockClock()
    clearMockPaused()
    setPaused(false)
    remainingRef.current = null
    deadlineRef.current = null
    setClockDeadlineMs(null)
    setClockFrozenSec(null)
    setSession(live)
  }

  const leaveRoom = () => {
    if (session && !isMockComplete(session) && session.picks.length > 0) {
      if (!window.confirm('Leave this mock draft? Picks will not be saved.')) return
    }
    carriedClockPicks.current = -1
    clearMockQueue()
    clearMockClock()
    clearMockPaused()
    setSession(null)
    setClockDeadlineMs(null)
    setClockFrozenSec(null)
    setPaused(false)
    remainingRef.current = null
    deadlineRef.current = null
  }

  const freezeClock = () => {
    const left =
      deadlineRef.current != null ? Math.max(0, (deadlineRef.current - Date.now()) / 1000) : remainingRef.current
    remainingRef.current = left
    deadlineRef.current = null
    setClockFrozenSec(left)
    setClockDeadlineMs(null)
  }

  const onDraft = (playerId: string) => {
    setSession((cur) => {
      if (paused || !cur || !isUserOnTheClock(cur)) return cur
      let next = applyDraftPick(cur, playerId)
      if (cur.botDelaySec === 0) next = runBotsUntilUser(next)
      return next
    })
  }

  const onMoveRoster = (fromIndex: number, toIndex: number) => {
    setSession((cur) => (cur ? moveUserRosterPlayer(cur, fromIndex, toIndex) : cur))
  }

  const onSimToPick = () => {
    setSession((cur) => {
      if (!cur || paused || isMockComplete(cur) || isUserOnTheClock(cur) || cur.botDelaySec === 0) return cur
      return runBotsUntilUser(cur)
    })
  }

  useEffect(() => {
    if (!session || isMockComplete(session)) {
      remainingRef.current = null
      deadlineRef.current = null
      setClockDeadlineMs(null)
      setClockFrozenSec(null)
      return
    }
    const user = isUserOnTheClock(session)
    const duration = user ? session.userClockSec : session.botDelaySec
    const carried = session.picks.length === carriedClockPicks.current ? carriedClock : null
    remainingRef.current = duration === 0 ? null : (carried ?? duration)
    setClockFrozenSec(null)
    if (duration === 0) {
      deadlineRef.current = null
      setClockDeadlineMs(null)
      return
    }
    // A restored draft holds its clock until the user resumes; re-running this
    // effect must not start one, so the check is on paused rather than a one-shot.
    if (paused) {
      const left = remainingRef.current ?? duration
      deadlineRef.current = null
      setClockFrozenSec(left)
      setClockDeadlineMs(null)
      return
    }
    const deadline = Date.now() + (remainingRef.current ?? duration) * 1000
    deadlineRef.current = deadline
    setClockDeadlineMs(deadline)
  }, [session?.picks.length, session && isUserOnTheClock(session), session && isMockComplete(session)])

  useEffect(() => {
    if (paused || !session || isMockComplete(session)) return
    const user = isUserOnTheClock(session)
    const duration = user ? session.userClockSec : session.botDelaySec
    if (duration === 0) return
    const remaining = remainingRef.current ?? duration
    const started = Date.now()
    const deadline = started + remaining * 1000
    deadlineRef.current = deadline
    setClockDeadlineMs(deadline)
    setClockFrozenSec(null)
    const timer = window.setTimeout(() => {
      setSession((cur) => {
        if (!cur || isMockComplete(cur)) return cur
        if (user) {
          if (!isUserOnTheClock(cur)) return cur
          let next = autoUserPick(cur)
          if (cur.botDelaySec === 0) next = runBotsUntilUser(next)
          return next
        }
        if (isUserOnTheClock(cur)) return cur
        return applyBotPick(cur)
      })
    }, remaining * 1000)
    return () => {
      window.clearTimeout(timer)
      remainingRef.current = Math.max(0, remaining - (Date.now() - started) / 1000)
    }
  }, [paused, session?.picks.length, session && isMockComplete(session), session && isUserOnTheClock(session)])

  if (isLoading && !data) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />

  if (session) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-8 min-w-0 overflow-x-hidden">
        <Suspense fallback={<LoadingSpinner />}>
          <MockDraftRoom
            session={session}
            clockDeadlineMs={clockDeadlineMs}
            clockFrozenSec={clockFrozenSec}
            paused={paused}
            onDraft={onDraft}
            onMoveRoster={onMoveRoster}
            onSimToPick={onSimToPick}
            onPause={() => {
              freezeClock()
              setPaused(true)
            }}
            onResume={() => setPaused(false)}
            onLeave={leaveRoom}
          />
        </Suspense>
      </div>
    )
  }

  const csvOk = csvOrder && csvHasEnoughPlayers(csvMatched, settings.teams, settings.rounds)

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 pb-10">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Mock Draft</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Practice a snake or 3RR draft against bots. Bots always pick from Blend Rank order. Your board is only for
        your list and auto-picks.
      </p>

      <div className="card p-5 mt-5 space-y-6">
        <LeagueSettingsFields
          value={settings}
          onChange={(league) => patch(league)}
        />

        <Stepper
          label="Your first-round pick"
          value={settings.userPick}
          min={1}
          max={settings.teams}
          onChange={(userPick) => patch({ userPick })}
        />

        <div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Bot pick time</div>
          <div className="text-xs text-gray-400 mt-0.5">Immediate jumps to your next pick after you draft.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Choice value={0} selected={settings.botDelaySec === 0} onClick={(botDelaySec) => patch({ botDelaySec })}>
              Immediate
            </Choice>
            <Choice
              value={settings.botDelaySec === 0 ? 3 : settings.botDelaySec}
              selected={settings.botDelaySec > 0}
              onClick={(botDelaySec) => patch({ botDelaySec })}
            >
              Timed
            </Choice>
          </div>
          {settings.botDelaySec > 0 ? (
            <div className="mt-3">
              <Stepper
                label="Seconds between bot picks"
                value={settings.botDelaySec}
                min={1}
                max={10}
                onChange={(botDelaySec) => patch({ botDelaySec })}
              />
            </div>
          ) : null}
        </div>

        <div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">User pick time</div>
          <div className="text-xs text-gray-400 mt-0.5">At 0:00 the best remaining player on your board is drafted.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Choice value={30} selected={settings.userClockSec === 30} onClick={(userClockSec) => patch({ userClockSec })}>
              30 seconds
            </Choice>
            <Choice value={60} selected={settings.userClockSec === 60} onClick={(userClockSec) => patch({ userClockSec })}>
              60 seconds
            </Choice>
            <Choice value={0} selected={settings.userClockSec === 0} onClick={(userClockSec) => patch({ userClockSec })}>
              Unlimited
            </Choice>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Draft rankings from</div>
          <div className="text-xs text-gray-400 mt-0.5">Bots ignore this and use Blend Rank order.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['saved', 'default', 'csv'] as RankingSource[]).map((source) => (
              <Choice
                key={source}
                value={source}
                selected={settings.rankingSource === source}
                disabled={source === 'saved' && !hasSaved}
                onClick={(rankingSource) => patch({ rankingSource })}
              >
                {source === 'saved' && !hasSaved ? 'Saved rankings (none)' : SOURCE_LABEL[source]}
              </Choice>
            ))}
          </div>
          {settings.rankingSource === 'csv' ? (
            <div className="mt-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) importCsv(file)
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="min-h-11 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md border border-gray-300 dark:border-gray-600"
              >
                Choose CSV
              </button>
              {csvName ? (
                <p className="mt-2 text-xs text-gray-500">
                  {csvName}
                  {csvOk ? ` · ${csvMatched} matched` : ` · ${csvMatched} matched (need ${needed})`}
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-400">Export CSV from Pre-Draft Rankings, then import it here.</p>
              )}
            </div>
          ) : null}
        </div>

        {setupError ? <p className="text-sm text-red-600 dark:text-red-400">{setupError}</p> : null}

        <button type="button" onClick={startMock} className="btn-primary w-full py-2.5 text-sm font-semibold">
          Start Mock Draft
        </button>
      </div>
    </div>
  )
}
