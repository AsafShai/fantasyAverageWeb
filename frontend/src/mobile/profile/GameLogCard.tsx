import { useSectionOpen } from '../../hooks/useSectionOpen'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { useGetNbaPlayerGamesQuery } from '../../store/api/fantasyApi'
import type { PlayerGameLogGame } from '../../types/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { COUNT_COLS, SHOT_COLS, logDate, mean, record, shotLine, shotPct, signed, whole } from '../../utils/playerGameLog'
import { Card, DataTable, type Column } from '../ui'

type Row = { kind: 'avg' } | { kind: 'game'; game: PlayerGameLogGame }

function Result({ game }: { game: PlayerGameLogGame }) {
  if (game.team_pts == null || game.opp_pts == null) return <span className="mr-pp-sub">—</span>
  const win = game.team_pts > game.opp_pts
  const loss = game.team_pts < game.opp_pts
  return (
    <span className={`mr-pp-sub ${win ? 'mr-pp-win' : loss ? 'mr-pp-loss' : ''}`}>
      <b>{win ? 'W' : loss ? 'L' : 'T'}</b> {game.team_pts}–{game.opp_pts}
    </span>
  )
}

/**
 * Game log on a phone: this season newest first, an AVG row on top (W–L
 * record, averages, shooting %), date pinned while the columns scroll, every
 * column the desktop log has. Opponent opens the box score.
 */
export default function GameLogCard({ playerId }: { playerId: string }) {
  const [open, toggle] = useSectionOpen('game-log')
  const { data, error, isLoading } = useGetNbaPlayerGamesQuery(playerId, { skip: !playerId })
  const shown = useMemo(
    () => (data?.games ?? []).filter((game) => game.season === data?.current_season),
    [data],
  )
  const rows = useMemo<Row[]>(() => [{ kind: 'avg' }, ...shown.map((game) => ({ kind: 'game' as const, game }))], [shown])

  const columns = useMemo<Column<Row>[]>(() => {
    const count = (col: (typeof COUNT_COLS)[number]): Column<Row> => ({
      key: col.key,
      header: col.label,
      align: 'center',
      cell: (r) => {
        if (r.kind === 'avg') return <b>{mean(shown, col.key)}</b>
        const v = r.game[col.key]
        if (col.signed) return <span className={v > 0 ? 'mr-pp-win' : v < 0 ? 'mr-pp-loss' : ''}>{signed(v)}</span>
        return col.strong ? <b>{whole(v)}</b> : whole(v)
      },
    })
    const shot = (col: (typeof SHOT_COLS)[number]): Column<Row> => ({
      key: col.label,
      header: col.label,
      align: 'center',
      cell: (r) =>
        r.kind === 'avg' ? (
          <b>
            {shotPct(
              shown.reduce((sum, g) => sum + g[col.made], 0),
              shown.reduce((sum, g) => sum + g[col.att], 0),
            )}
          </b>
        ) : (
          <span title={shotPct(r.game[col.made], r.game[col.att])}>{shotLine(r.game[col.made], r.game[col.att])}</span>
        ),
    })
    return [
      {
        key: 'date',
        header: 'DATE',
        pinned: true,
        cell: (r) => {
          if (r.kind === 'avg') return <b>AVG</b>
          const d = logDate(r.game.game_date)
          return (
            <time dateTime={r.game.game_date} className="mr-pp-date">
              <span className="mr-pp-sub">{d.weekday}</span>
              {d.day}
            </time>
          )
        },
      },
      {
        key: 'opp',
        header: 'OPP',
        align: 'left',
        cell: (r) =>
          r.kind === 'avg' ? (
            <b title="Wins–losses">{record(shown)}</b>
          ) : (
            <Link
              to={`/box-scores?date=${r.game.game_date}&game=${r.game.game_id}`}
              state={{ from: `/player/${playerId}` }}
              className="mr-pp-opp"
              title="Box score"
            >
              <span>
                <span className="mr-pp-faint">{r.game.is_home ? 'vs' : '@'}</span> {r.game.opponent}
              </span>
              <Result game={r.game} />
            </Link>
          ),
      },
      ...COUNT_COLS.slice(0, 6).map(count),
      ...SHOT_COLS.map(shot),
      ...COUNT_COLS.slice(6).map(count),
    ]
  }, [shown, playerId])

  return (
    <Card title="Game log" aria-label="Game log" fold={{ open, onToggle: toggle }}>
      {data && (
        <span className="mr-meta">
          {data.current_season} · {shown.length} {shown.length === 1 ? 'game' : 'games'}
        </span>
      )}
      {isLoading ? (
        <div className="mr-pp-loading">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <ErrorMessage message={getErrorMessage(error, 'Failed to load game log')} />
      ) : shown.length === 0 ? (
        <p className="mr-meta mr-pp-empty">No games in the log yet.</p>
      ) : (
        <DataTable
          caption="Game log, newest first. Opponent opens the box score."
          columns={columns}
          rows={rows}
          rowKey={(r) => (r.kind === 'avg' ? 'avg' : String(r.game.game_id))}
          isHighlighted={(r) => r.kind === 'avg'}
          maxHeight={520}
        />
      )}
    </Card>
  )
}
