import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import BoxScorePanel from '../components/boxScores/BoxScorePanel'
import LinesOfTheNight from '../components/boxScores/LinesOfTheNight'
import { gameClockLabel } from '../components/boxScores/tipTime'
import ErrorMessage from '../components/ErrorMessage'
import LoadingSpinner from '../components/LoadingSpinner'
import { usePersistedState } from '../hooks/usePersistedState'
import { useGetBoxScoreboardQuery, useGetBoxSlateValuesQuery, useGetGameBoxScoreQuery } from '../store/api/fantasyApi'
import type { BoxScoreGame, BoxTeamSide, SlatePlayerValue } from '../types/boxScore'
import { getErrorMessage } from '../utils/errorMessage'

function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day))
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function formatSlateLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

// Games revealed one at a time while No spoilers is on. Only the most recent
// few are kept: a game id is never reused, so old ones are dead weight.
const MAX_REVEALED = 60

function slatePoll(games: BoxScoreGame[] | undefined, date: string): number {
  if (!games) return 0
  if (games.some(game => game.status === 'live')) return 20_000
  if (date === easternToday() && games.some(game => game.status === 'scheduled')) return 60_000
  return 0
}

function teamColor(color: string): string | undefined {
  return /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined
}

function GameCard({
  game,
  selected,
  hideScores,
  onSelect,
}: {
  game: BoxScoreGame
  selected: boolean
  hideScores: boolean
  onSelect: () => void
}) {
  const hide = hideScores && game.status !== 'scheduled'
  const live = game.status === 'live'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-44 shrink-0 snap-start rounded-xl border bg-white p-3 text-left shadow-sm transition-colors sm:w-auto ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-500/30 dark:bg-gray-900'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-500'
      }`}
    >
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${live ? 'text-rose-600' : 'text-gray-400'}`}>
        {gameClockLabel(game.status, game.status_detail, game.start_time)}
      </p>
      <SideRow team={game.away} hide={hide} />
      <SideRow team={game.home} hide={hide} />
    </button>
  )
}

function SideRow({ team, hide }: { team: BoxTeamSide; hide: boolean }) {
  const accent = teamColor(team.color)
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent ?? '#d1d5db' }} />
      {team.logo
        ? <img src={team.logo} alt="" className="h-5 w-5 object-contain" />
        : <span className="h-5 w-5" />}
      <span className={`min-w-0 flex-1 truncate text-sm ${team.winner && !hide ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>
        {team.abbreviation}
      </span>
      <span className={`w-8 text-right text-sm tabular-nums ${team.winner && !hide ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-500'}`}>
        {hide ? (
          <span aria-label="Score hidden" title="Hidden while No spoilers is on">–</span>
        ) : team.score == null ? (
          <span className="text-gray-300 dark:text-gray-600">–</span>
        ) : team.score}
      </span>
    </span>
  )
}

function EyeOffIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 002.83 2.83" />
      <path d="M9.88 5.09A10.94 10.94 0 0112 4.9c5.05 0 9.27 3.11 10.5 7.1a11.8 11.8 0 01-3.17 4.87" />
      <path d="M6.11 6.11A11.8 11.8 0 001.5 12c1.23 3.99 5.45 7.1 10.5 7.1 1.18 0 2.31-.19 3.36-.54" />
    </svg>
  )
}

function NoSpoilersSwitch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  const idle = 'rounded-full px-3 py-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-gray-400 dark:hover:text-gray-100'
  return (
    <div
      role="group"
      aria-label="Spoiler visibility"
      className={`inline-flex w-fit max-w-full self-center rounded-full p-1 ring-1 transition-colors sm:self-auto ${
        on
          ? 'bg-indigo-50 ring-indigo-200 dark:bg-indigo-950/70 dark:ring-indigo-500/40'
          : 'bg-gray-100 ring-gray-200 dark:bg-gray-800/80 dark:ring-gray-700'
      }`}
    >
      <button
        type="button"
        aria-pressed={!on}
        onClick={() => onChange(false)}
        className={!on
          ? 'rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:bg-gray-700 dark:text-white'
          : idle}
      >
        Full box
      </button>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(true)}
        className={on
          ? 'inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'
          : `inline-flex items-center gap-1.5 ${idle}`}
      >
        <EyeOffIcon />
        No spoilers
      </button>
    </div>
  )
}

export default function BoxScores() {
  const [searchParams, setSearchParams] = useSearchParams()
  const date = searchParams.get('date') || easternToday()
  const gameId = searchParams.get('game') ?? ''
  const [noSpoilers, setNoSpoilers] = usePersistedState('boxScores.noSpoilers', false)
  const [revealed, setRevealed] = usePersistedState<string[]>('boxScores.revealedGames', [])
  const today = easternToday()

  const [boardPoll, setBoardPoll] = useState(0)
  const [boxPoll, setBoxPoll] = useState(0)
  const board = useGetBoxScoreboardQuery(date, { pollingInterval: boardPoll })
  const games = board.data?.date === date ? board.data.games : undefined
  const nextBoardPoll = slatePoll(games, date)
  if (nextBoardPoll !== boardPoll) setBoardPoll(nextBoardPoll)
  const selectedId = games?.some(game => game.game_id === gameId) ? gameId : ''
  const boxScore = useGetGameBoxScoreQuery(selectedId, {
    skip: !selectedId,
    pollingInterval: boxPoll,
  })
  const boxReady = boxScore.data?.game_id === selectedId ? boxScore.data : undefined
  const nextBoxPoll = boxReady?.status === 'live' ? 15_000 : 0
  if (nextBoxPoll !== boxPoll) setBoxPoll(nextBoxPoll)
  const anyStarted = games?.some(game => game.status !== 'scheduled') ?? false
  const slateValues = useGetBoxSlateValuesQuery(date, { skip: !anyStarted, pollingInterval: boardPoll })
  const values = slateValues.data?.date === date ? slateValues.data : undefined
  const valueMap = useMemo(() => {
    const map = new Map<string, SlatePlayerValue>()
    for (const player of values?.players ?? []) map.set(player.player_id, player)
    return map
  }, [values])

  function toggleReveal(id: string) {
    setRevealed(current => current.includes(id)
      ? current.filter(item => item !== id)
      : [...current, id].slice(-MAX_REVEALED))
  }

  useEffect(() => {
    if (!games) return
    if (gameId && games.some(game => game.game_id === gameId)) return
    const pick = games.find(game => game.status === 'live') ?? games[0]
    const params = new URLSearchParams()
    params.set('date', date)
    if (pick) params.set('game', pick.game_id)
    setSearchParams(params, { replace: true })
  }, [games, date, gameId, setSearchParams])

  function goTo(next: string) {
    const params = new URLSearchParams()
    params.set('date', next)
    setSearchParams(params, { replace: true })
  }

  function selectGame(id: string) {
    const params = new URLSearchParams()
    params.set('date', date)
    params.set('game', id)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Box Scores
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {noSpoilers ? 'Names only. Scores and stats stay hidden.' : 'Every NBA game on the slate, with the full box.'}
          </p>
        </div>
        <NoSpoilersSwitch on={noSpoilers} onChange={setNoSpoilers} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => goTo(shiftDate(date, -1))}
          className="grid h-10 w-10 place-items-center rounded-lg border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          ‹
        </button>
        <label className="relative">
          <span className="block min-w-[12rem] rounded-lg border border-gray-200 bg-white px-4 py-2 text-center text-sm font-semibold text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            {formatSlateLabel(date)}
          </span>
          <input
            type="date"
            value={date}
            aria-label="Choose a date"
            onChange={event => { if (event.target.value) goTo(event.target.value) }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => goTo(shiftDate(date, 1))}
          className="grid h-10 w-10 place-items-center rounded-lg border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          ›
        </button>
        {date !== today && (
          <button
            type="button"
            onClick={() => goTo(today)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-gray-800"
          >
            Today
          </button>
        )}
      </div>

      {board.isLoading && <LoadingSpinner />}
      {board.isError && <ErrorMessage message={getErrorMessage(board.error, 'Could not load this slate')} />}

      {games && games.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-16 text-center text-sm text-gray-500 dark:border-gray-600">
          No NBA games on {formatSlateLabel(date)}.
        </div>
      )}

      {games && games.length > 0 && (
        <>
          {values?.complete && values.players.length > 0 && (
            <LinesOfTheNight
              key={`${date}-${noSpoilers}`}
              players={values.players.slice(0, 5)}
              spoilerGuard={noSpoilers}
              dateLabel={formatSlateLabel(date)}
              games={games.length}
            />
          )}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 snap-x sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-4">
            {games.map(game => (
              <GameCard
                key={game.game_id}
                game={game}
                selected={game.game_id === selectedId}
                hideScores={noSpoilers && !revealed.includes(game.game_id)}
                onSelect={() => selectGame(game.game_id)}
              />
            ))}
          </div>

          <div className="mt-4">
            {selectedId && !boxReady && (boxScore.isLoading || boxScore.isFetching) && <LoadingSpinner />}
            {boxScore.isError && <ErrorMessage message={getErrorMessage(boxScore.error, 'Could not load this box score')} />}
            {boxReady && (
              <BoxScorePanel
                key={boxReady.game_id}
                game={boxReady}
                hideScores={noSpoilers}
                revealed={revealed.includes(boxReady.game_id)}
                onToggleReveal={() => toggleReveal(boxReady.game_id)}
                values={values ? valueMap : undefined}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
