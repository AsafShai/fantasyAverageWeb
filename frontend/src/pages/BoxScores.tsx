import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import BoxScorePanel from '../components/boxScores/BoxScorePanel'
import SlateDatePicker from '../components/boxScores/SlateDatePicker'
import LinesOfTheNight from '../components/boxScores/LinesOfTheNight'
import MyPlayers from '../components/boxScores/MyPlayers'
import FantasyLineupLegend from '../components/boxScores/FantasyLineupLegend'
import NoSpoilersSwitch from '../components/boxScores/NoSpoilersSwitch'
import { filterMineAppearances, groupAppearances, minePlayersFromRosterDay, myAppearances } from '../components/boxScores/myPlayerGroups'
import { mineCount, outPlayerIds, rosterSide } from '../components/boxScores/pregameRoster'
import { nbaTeamId } from '../components/boxScores/proTeam'
import { slatePlayerValues } from '../components/boxScores/slateValues'
import { gameClockLabel } from '../components/boxScores/tipTime'
import ErrorMessage from '../components/ErrorMessage'
import LoadingSpinner from '../components/LoadingSpinner'
import { useMyTeam } from '../context/useMyTeam'
import { usePersistedState } from '../hooks/usePersistedState'
import { fantasyApi, useGetAllPlayersQuery, useGetBoxScoreboardQuery, useGetBoxSlateValuesQuery, useGetGameBoxScoreQuery, useGetNbaSeasonWindowQuery, useGetNbaTeamDepthChartQuery, useGetTeamRosterDayQuery, useGetTeamsListQuery } from '../store/api/fantasyApi'
import { useAppSelector } from '../store/hooks'
import type { BoxScoreGame, BoxTeamSide, SlatePlayerValue } from '../types/boxScore'
import { getErrorMessage } from '../utils/errorMessage'
import { useMobileRedesign } from '../mobile/flag'
import MobileBoxScores from '../mobile/nba/MobileBoxScores'
import { nbaSlateToday } from '../utils/slateWindow'

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
  if (games.some(game => game.status === 'live')) return 60_000
  if (date === nbaSlateToday() && games.some(game => game.status === 'scheduled')) return 60_000
  return 0
}

// Z-scores and lines of the night read every started box. Refresh them much
// more slowly than the open game so a live slate is not fetched in full.
function valuesPoll(games: BoxScoreGame[] | undefined, date: string): number {
  if (!games || !games.some(game => game.status !== 'scheduled')) return 0
  if (games.some(game => game.status === 'live')) return 120_000
  if (date === nbaSlateToday() && games.some(game => game.status === 'scheduled')) return 120_000
  return 0
}

function teamColor(color: string): string | undefined {
  return /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined
}

function GameCard({
  game,
  selected,
  hideScores,
  mineCount,
  onSelect,
}: {
  game: BoxScoreGame
  selected: boolean
  hideScores: boolean
  mineCount: number | null
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
        {gameClockLabel(game.status, game.status_detail, game.start_time, hide)}
      </p>
      <SideRow team={game.away} hide={hide} />
      <SideRow team={game.home} hide={hide} />
      {mineCount != null && mineCount > 0 && (
        <span className="mt-2 flex items-center gap-2 text-[11px] font-semibold normal-case tracking-normal text-blue-700 dark:text-blue-300">
          <span aria-hidden="true" className="h-3 w-1 shrink-0 rounded-full bg-blue-600" />
          {mineCount} from your team
        </span>
      )}
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

function ScheduledDepthCharts({ teamIds }: { teamIds: string[] }) {
  return teamIds.map(teamId => <DepthChartRequest key={teamId} teamId={teamId} />)
}

function DepthChartRequest({ teamId }: { teamId: string }) {
  useGetNbaTeamDepthChartQuery(teamId)
  return null
}

export default function BoxScores() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { myTeamId } = useMyTeam()
  const date = searchParams.get('date') || nbaSlateToday()
  const gameId = searchParams.get('game') ?? ''
  const [noSpoilers, setNoSpoilers] = usePersistedState('boxScores.noSpoilers', false)
  const [revealed, setRevealed] = usePersistedState<string[]>('boxScores.revealedGames', [])
  const today = nbaSlateToday()
  const mobileRedesign = useMobileRedesign()
  const season = useGetNbaSeasonWindowQuery()
  const seasonStart = season.data?.start
  const seasonEnd = season.data?.end

  const [boardPoll, setBoardPoll] = useState(0)
  const [boxPoll, setBoxPoll] = useState(0)
  const [slateValuesPoll, setSlateValuesPoll] = useState(0)
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
  const nextBoxPoll = boxReady?.status === 'live' ? 60_000 : 0
  if (nextBoxPoll !== boxPoll) setBoxPoll(nextBoxPoll)
  const nextValuesPoll = valuesPoll(games, date)
  if (nextValuesPoll !== slateValuesPoll) setSlateValuesPoll(nextValuesPoll)
  const slateValues = useGetBoxSlateValuesQuery(date, { skip: !games?.length, pollingInterval: slateValuesPoll })
  const values = slateValues.data?.date === date ? slateValues.data : undefined
  const fantasyPlayers = values?.fantasy_players
  // Z comes from the Player Rankings page's own code, so the two never disagree.
  const ranked = useMemo(() => (values?.categories != null ? slatePlayerValues(values) : []), [values])
  const valueMap = useMemo(() => {
    const map = new Map<string, SlatePlayerValue>()
    for (const player of ranked) map.set(player.player_id, player)
    return map
  }, [ranked])
  const selected = games?.find(game => game.game_id === selectedId)
  const awaitingRoster = selected?.status === 'scheduled'
  const awayTeamId = awaitingRoster && selected ? nbaTeamId(selected.away.abbreviation) : ''
  const homeTeamId = awaitingRoster && selected ? nbaTeamId(selected.home.abbreviation) : ''
  const awayChart = useGetNbaTeamDepthChartQuery(awayTeamId, { skip: !awayTeamId })
  const homeChart = useGetNbaTeamDepthChartQuery(homeTeamId, { skip: !homeTeamId })
  const rosterDay = useGetTeamRosterDayQuery(
    { teamId: myTeamId ?? 0, date },
    { skip: myTeamId == null },
  )
  const slateRoster = useMemo(() => {
    if (rosterDay.data?.date !== date) return undefined
    return minePlayersFromRosterDay(rosterDay.data.players)
  }, [rosterDay.data, date])
  const mineIds = useMemo(() => {
    const ids = new Set<string>()
    for (const player of slateRoster ?? []) {
      if (player.player_id != null) ids.add(String(player.player_id))
    }
    return ids
  }, [slateRoster])
  const scheduledTeamIds = useMemo(() => {
    if (myTeamId == null || !games) return []
    const ids = new Set<string>()
    for (const game of games) {
      if (game.status !== 'scheduled') continue
      for (const abbreviation of [game.away.abbreviation, game.home.abbreviation]) {
        const id = nbaTeamId(abbreviation)
        if (id) ids.add(id)
      }
    }
    return [...ids].sort()
  }, [games, myTeamId])
  const outKey = useAppSelector(state => {
    const charts = scheduledTeamIds.map(teamId => fantasyApi.endpoints.getNbaTeamDepthChart.select(teamId)(state).data)
    return [...outPlayerIds(charts)].sort().join(',')
  })
  const outIds = useMemo(() => new Set(outKey ? outKey.split(',') : []), [outKey])
  const mineSlate = useMemo(() => {
    if (myTeamId == null || !slateRoster || !games) return null
    const rows = filterMineAppearances(myAppearances(slateRoster, games), outIds)
    return groupAppearances(rows)
  }, [myTeamId, slateRoster, games, outIds])
  const pool = useGetAllPlayersQuery({ limit: 1200, time_period: 'season' }, { skip: !awaitingRoster })
  const teams = useGetTeamsListQuery(undefined, { skip: !awaitingRoster })
  const pregame = useMemo(() => {
    if (!awaitingRoster || !pool.data || !awayChart.data || !homeChart.data) return null
    const abbrev = new Map<number, string>()
    const names = new Map<number, string>()
    for (const team of teams.data ?? []) {
      names.set(team.team_id, team.team_name)
      if (team.abbrev) abbrev.set(team.team_id, team.abbrev)
    }
    return {
      away: rosterSide(awayChart.data, pool.data.players, abbrev, names),
      home: rosterSide(homeChart.data, pool.data.players, abbrev, names),
    }
  }, [awaitingRoster, pool.data, teams.data, awayChart.data, homeChart.data])
  const rosterLoading = pool.isLoading || awayChart.isLoading || homeChart.isLoading
  const rosterError = pool.isError || awayChart.isError || homeChart.isError

  function toggleReveal(id: string) {
    setRevealed(current => current.includes(id)
      ? current.filter(item => item !== id)
      : [...current, id].slice(-MAX_REVEALED))
  }

  function inSeason(next: string) {
    if (seasonStart && next < seasonStart) return false
    if (seasonEnd && next > seasonEnd) return false
    return true
  }

  function goTo(next: string) {
    if (!inSeason(next)) return
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

  function toggleGame(id: string) {
    if (id === selectedId) {
      const params = new URLSearchParams()
      params.set('date', date)
      setSearchParams(params, { replace: true })
      return
    }
    selectGame(id)
  }

  if (mobileRedesign) {
    const openFromMyPlayers = (id: string) => {
      selectGame(id)
      requestAnimationFrame(() => document.getElementById('mr-nba-box-panel')?.scrollIntoView({ block: 'start' }))
    }
    return (
      <MobileBoxScores
        noSpoilers={noSpoilers}
        onNoSpoilers={setNoSpoilers}
        date={date}
        dateLabel={formatSlateLabel(date)}
        min={seasonStart}
        max={seasonEnd}
        prevDate={inSeason(shiftDate(date, -1)) ? shiftDate(date, -1) : null}
        nextDate={inSeason(shiftDate(date, 1)) ? shiftDate(date, 1) : null}
        showToday={date !== today && inSeason(today)}
        onGoTo={goTo}
        onGoToday={() => goTo(today)}
        status={
          <>
            {board.isLoading && <LoadingSpinner />}
            {board.isError && <ErrorMessage message={getErrorMessage(board.error, 'Could not load this slate')} />}
            {games && games.length === 0 && (
              <div className="mr-card mr-nba-empty">No NBA games on {formatSlateLabel(date)}.</div>
            )}
            {games && games.length > 0 && (
              <>
                <FantasyLineupLegend className="mb-2 px-1" />
                <ScheduledDepthCharts teamIds={scheduledTeamIds} />
              </>
            )}
          </>
        }
        cards={games ? games.map(game => ({
          game,
          selected: game.game_id === selectedId,
          hideScores: noSpoilers && !revealed.includes(game.game_id),
          mineCount: myTeamId != null && slateRoster ? mineCount(game, slateRoster, outIds) : null,
        })) : null}
        onToggleGame={toggleGame}
        panel={
          <div id="mr-nba-box-panel" className="mr-nba-panel">
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
                fantasyPlayers={fantasyPlayers}
                pregame={awaitingRoster ? pregame : undefined}
                pregameLoading={Boolean(awaitingRoster && !pregame && rosterLoading)}
                pregameError={Boolean(awaitingRoster && rosterError)}
                mineIds={myTeamId != null ? mineIds : undefined}
              />
            )}
          </div>
        }
        extras={
          <>
            {games && ranked.length > 0 && (
              <LinesOfTheNight
                key={`${date}-${noSpoilers}`}
                players={ranked}
                spoilerGuard={noSpoilers}
                inProgress={!values?.complete}
                dateLabel={formatSlateLabel(date)}
                games={games.length}
              />
            )}
            {mineSlate && (
              <MyPlayers
                key={`my-players-${date}-${noSpoilers}`}
                groups={mineSlate}
                spoilerGuard={noSpoilers}
                fantasyPlayers={fantasyPlayers}
                playerValues={valueMap}
                leagueCategories={values?.categories}
                slateComplete={values?.complete}
                onOpenGame={openFromMyPlayers}
              />
            )}
          </>
        }
      />
    )
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
          {games && games.length > 0 && <FantasyLineupLegend className="mt-2 max-w-2xl" />}
        </div>
        <NoSpoilersSwitch on={noSpoilers} onChange={setNoSpoilers} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Previous day"
          disabled={!inSeason(shiftDate(date, -1))}
          onClick={() => goTo(shiftDate(date, -1))}
          className="grid h-10 w-10 place-items-center rounded-lg border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:disabled:text-gray-600 dark:disabled:hover:bg-gray-900"
        >
          ‹
        </button>
        <SlateDatePicker
          date={date}
          label={formatSlateLabel(date)}
          min={seasonStart}
          max={seasonEnd}
          onChange={goTo}
        />
        <button
          type="button"
          aria-label="Next day"
          disabled={!inSeason(shiftDate(date, 1))}
          onClick={() => goTo(shiftDate(date, 1))}
          className="grid h-10 w-10 place-items-center rounded-lg border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:disabled:text-gray-600 dark:disabled:hover:bg-gray-900"
        >
          ›
        </button>
        {date !== today && inSeason(today) && (
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
          <ScheduledDepthCharts teamIds={scheduledTeamIds} />
          {ranked.length > 0 && (
            <LinesOfTheNight
              key={`${date}-${noSpoilers}`}
              players={ranked}
              spoilerGuard={noSpoilers}
              inProgress={!values?.complete}
              dateLabel={formatSlateLabel(date)}
              games={games.length}
            />
          )}
          {mineSlate && (
            <MyPlayers
              key={`my-players-${date}-${noSpoilers}`}
              groups={mineSlate}
              spoilerGuard={noSpoilers}
              fantasyPlayers={fantasyPlayers}
              playerValues={valueMap}
              leagueCategories={values?.categories}
              slateComplete={values?.complete}
              onOpenGame={selectGame}
            />
          )}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 snap-x sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 xl:grid-cols-4">
            {games.map(game => (
              <GameCard
                key={game.game_id}
                game={game}
                selected={game.game_id === selectedId}
                hideScores={noSpoilers && !revealed.includes(game.game_id)}
                mineCount={myTeamId != null && slateRoster ? mineCount(game, slateRoster, outIds) : null}
                onSelect={() => toggleGame(game.game_id)}
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
                fantasyPlayers={fantasyPlayers}
                pregame={awaitingRoster ? pregame : undefined}
                pregameLoading={Boolean(awaitingRoster && !pregame && rosterLoading)}
                pregameError={Boolean(awaitingRoster && rosterError)}
                mineIds={myTeamId != null ? mineIds : undefined}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
