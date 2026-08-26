import { useEffect, useMemo, useRef, useState } from 'react'
import { useGetAdpIndexQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import LeagueSettingsFields, { Stepper } from '../../components/draft/LeagueSettingsFields'
import MockDraftRoom from './MockDraftRoom'
import { parseRankingsCsvImport, rankingsCsvFileError } from '../../utils/draftCsv'
import { EMPTY_RANKINGS, type DraftRankingsState } from '../../utils/draftRankings'
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
      className={`px-3 py-1.5 text-xs font-semibold rounded-md border disabled:opacity-40 ${
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
  const [session, setSession] = useState<MockSession | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, error } = useGetAdpIndexQuery()
  const indexPlayers = data?.players ?? []
  const defaultOrder = useMemo(() => indexPlayers.map((p) => p.id), [indexPlayers])
  const needed = pickCount(settings.teams, settings.rounds)

  const patch = (partial: Partial<MockDraftSettings>) => {
    setSettingsRaw((prev) => clampMockSettings({ ...clampMockSettings(prev), ...partial }))
  }

  useEffect(() => {
    if (!hasSaved && settings.rankingSource === 'saved') patch({ rankingSource: 'default' })
  }, [hasSaved, settings.rankingSource])

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
    setSession(live)
  }

  const leaveRoom = () => {
    if (session && !isMockComplete(session) && session.picks.length > 0) {
      if (!window.confirm('Leave this mock draft? Picks will not be saved.')) return
    }
    setSession(null)
    setSecondsLeft(null)
  }

  const onDraft = (playerId: string) => {
    setSession((cur) => {
      if (!cur || !isUserOnTheClock(cur)) return cur
      let next = applyDraftPick(cur, playerId)
      if (cur.botDelaySec === 0) next = runBotsUntilUser(next)
      return next
    })
  }

  const onMoveRoster = (fromIndex: number, toIndex: number) => {
    setSession((cur) => (cur ? moveUserRosterPlayer(cur, fromIndex, toIndex) : cur))
  }

  useEffect(() => {
    if (!session || isMockComplete(session)) return
    if (isUserOnTheClock(session)) {
      if (session.userClockSec === 0) return
      const timer = window.setTimeout(() => {
        setSession((cur) => {
          if (!cur || isMockComplete(cur) || !isUserOnTheClock(cur)) return cur
          let next = autoUserPick(cur)
          if (cur.botDelaySec === 0) next = runBotsUntilUser(next)
          return next
        })
      }, session.userClockSec * 1000)
      return () => window.clearTimeout(timer)
    }
    if (session.botDelaySec === 0) return
    const timer = window.setTimeout(() => {
      setSession((cur) => {
        if (!cur || isMockComplete(cur) || isUserOnTheClock(cur)) return cur
        return applyBotPick(cur)
      })
    }, session.botDelaySec * 1000)
    return () => window.clearTimeout(timer)
  }, [session?.picks.length, session && isMockComplete(session), session && isUserOnTheClock(session)])

  useEffect(() => {
    if (!session || isMockComplete(session)) {
      setSecondsLeft(null)
      return
    }
    const user = isUserOnTheClock(session)
    const duration = user ? session.userClockSec : session.botDelaySec
    if (duration === 0) {
      setSecondsLeft(null)
      return
    }
    const started = Date.now()
    setSecondsLeft(duration)
    const id = window.setInterval(() => {
      setSecondsLeft(Math.max(0, duration - (Date.now() - started) / 1000))
    }, 200)
    return () => window.clearInterval(id)
  }, [session?.picks.length, session && isUserOnTheClock(session), session && isMockComplete(session)])

  if (isLoading && !data) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />

  if (session) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-8">
        <MockDraftRoom
          session={session}
          secondsLeft={secondsLeft}
          onDraft={onDraft}
          onMoveRoster={onMoveRoster}
          onLeave={leaveRoom}
        />
      </div>
    )
  }

  const csvOk = csvOrder && csvHasEnoughPlayers(csvMatched, settings.teams, settings.rounds)

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 pb-10">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Mock Draft</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Practice a snake or 3RR draft against bots. Bots always pick from default ADP order. Your board is only for
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
          <div className="text-xs text-gray-400 mt-0.5">Bots ignore this and use default ADP order.</div>
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
                className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600"
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
