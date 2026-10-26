import { useState } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import { gameClockLabel, localClock } from './tipTime'
import { signedZ } from './linesOfTheNightFormat'
import type { BoxPlayerLine, BoxTeamBox, BoxTeamTotals, GameBoxScore, SlatePlayerValue } from '../../types/boxScore'

export type PlayerValues = Map<string, SlatePlayerValue>

const COLUMNS: { key: keyof BoxTeamTotals; label: string }[] = [
  { key: 'min', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'fg', label: 'FG' },
  { key: 'fg3', label: '3PT' },
  { key: 'ft', label: 'FT' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'tov', label: 'TO' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'oreb', label: 'OREB' },
  { key: 'dreb', label: 'DREB' },
  { key: 'pf', label: 'PF' },
  { key: 'plus_minus', label: '+/−' },
]

function Hidden({ label = 'Score hidden' }: { label?: string }) {
  return (
    <span className="text-gray-300 dark:text-gray-600" aria-label={label} title="Hidden while No spoilers is on">
      –
    </span>
  )
}

function StatCell({ value, hide, emphasize = false }: { value: string; hide: boolean; emphasize?: boolean }) {
  if (hide) return <Hidden />
  if (!value) return <span className="text-gray-300 dark:text-gray-600">—</span>
  const margin = emphasize && value.startsWith('+') && value !== '+0'
    ? 'text-emerald-600 dark:text-emerald-400'
    : emphasize && value.startsWith('-')
      ? 'text-rose-600 dark:text-rose-400'
      : ''
  return <span className={margin}>{value}</span>
}

function TeamMark({ team, size = 'md' }: { team: { logo: string; abbreviation: string; color: string }; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  if (!team.logo) {
    return (
      <span
        className={`grid ${box} shrink-0 place-items-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-200`}
      >
        {team.abbreviation.slice(0, 3)}
      </span>
    )
  }
  return <img src={team.logo} alt="" className={`${box} shrink-0 object-contain`} />
}

function ScoreFigure({ score, hide, winner }: { score: number | null; hide: boolean; winner: boolean }) {
  const tone = hide || score == null
    ? 'text-gray-300 dark:text-gray-600'
    : winner
      ? 'text-gray-900 dark:text-white'
      : 'text-gray-400 dark:text-gray-500'
  return (
    <span className={`text-3xl font-bold tabular-nums leading-none sm:text-4xl ${tone}`}>
      {hide ? <Hidden /> : score == null ? '–' : score}
    </span>
  )
}

function Linescore({ game, hideScores }: { game: GameBoxScore; hideScores: boolean }) {
  if (game.periods.length === 0 || hideScores) return null
  const row = (team: BoxTeamBox) => (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <th className="px-2 py-1.5 text-left font-semibold text-gray-700 dark:text-gray-200">{team.abbreviation}</th>
      {game.periods.map((_, index) => (
        <td key={index} className="px-2 py-1.5 text-center tabular-nums text-gray-600 dark:text-gray-300">
          <StatCell value={team.linescores[index] ?? ''} hide={false} />
        </td>
      ))}
      <td className={`px-2 py-1.5 text-center font-bold tabular-nums ${team.winner ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
        <StatCell value={team.score == null ? '' : String(team.score)} hide={false} />
      </td>
    </tr>
  )
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto text-xs">
        <caption className="sr-only">Score by period</caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-400">
            <th className="px-2 py-1" />
            {game.periods.map(period => (
              <th key={period} className="px-2 py-1 text-center font-medium">{period}</th>
            ))}
            <th className="px-2 py-1 text-center font-semibold text-gray-500">T</th>
          </tr>
        </thead>
        <tbody>
          {row(game.away)}
          {row(game.home)}
        </tbody>
      </table>
    </div>
  )
}

export function ZValue({ z }: { z: number }) {
  const tone = z >= 0.5
    ? 'font-semibold text-emerald-600 dark:text-emerald-400'
    : z <= -0.5
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-gray-700 dark:text-gray-200'
  return <span className={tone}>{signedZ(z)}</span>
}

const TAG_CLASS = 'inline-block rounded bg-indigo-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'

/**
 * The fantasy team that had the player that night. `full` shows the team's
 * name (roomy places like Lines of the night); otherwise the abbreviation,
 * which a tap swaps for the full name (phones have no hover title).
 */
export function FantasyTeamTag({ value, full = false }: { value: SlatePlayerValue | undefined; full?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return <span className="text-gray-300 dark:text-gray-600">—</span>
  if (!value.fantasy_team) {
    return <span className="text-[10px] font-semibold uppercase text-gray-400" title="Free agent that night">FA</span>
  }
  const name = value.fantasy_team_name ?? value.fantasy_team
  if (full) return <span className={`${TAG_CLASS} min-w-0 max-w-full truncate`}>{name}</span>
  if (name === value.fantasy_team) return <span className={TAG_CLASS}>{name}</span>
  return (
    <button
      type="button"
      onClick={() => setExpanded(current => !current)}
      aria-expanded={expanded}
      aria-label={expanded ? `${name}, show abbreviation` : `${value.fantasy_team}: ${name}`}
      title={name}
      className={`${TAG_CLASS} cursor-pointer whitespace-nowrap hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:hover:bg-indigo-900`}
    >
      {expanded ? name : value.fantasy_team}
    </button>
  )
}

function PlayerTable({ team, hideScores, values }: { team: BoxTeamBox; hideScores: boolean; values?: PlayerValues }) {
  const groups = [
    { label: 'Starters', players: team.starters },
    { label: 'Bench', players: team.bench },
  ].filter(group => group.players.length > 0)
  const accent = team.color ? `#${team.color}` : undefined
  const extra = values ? 2 : 0

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2" style={accent ? { borderTop: `3px solid ${accent}`, paddingTop: '0.75rem' } : undefined}>
        <TeamMark team={team} />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{team.name}</h3>
          {team.record && !hideScores && (
            <p className="text-[11px] text-gray-400">{team.record}</p>
          )}
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="py-6 text-sm text-gray-400">The box score is not available yet.</p>
      ) : hideScores ? (
        <NameList groups={groups} teamName={team.name} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-xs">
            <caption className="sr-only">{team.name} box score</caption>
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 px-3 py-2 text-left font-semibold dark:bg-gray-800">Player</th>
                {values && (
                  <>
                    <th className="px-2 py-2 text-left font-semibold" title="Fantasy team that rostered him on the night of the game">Fantasy</th>
                    <th className="px-2 py-2 text-right font-semibold" title="Z-score of this line against every player line on the slate: every player who played that night, over the league's categories, scored like Player Rankings (0 = an average line)">Z</th>
                  </>
                )}
                {COLUMNS.map(column => (
                  <th key={column.key} className="px-2 py-2 text-right font-semibold">{column.label}</th>
                ))}
              </tr>
            </thead>
            {groups.map(group => (
              <tbody key={group.label}>
                <tr>
                  <th
                    colSpan={COLUMNS.length + 1 + extra}
                    className="bg-gray-50 px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:bg-gray-800"
                  >
                    <span className="sticky left-3">{group.label}</span>
                  </th>
                </tr>
                {group.players.map(player => (
                  <PlayerRow key={player.player_id || player.name} player={player} values={values} />
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t-2 border-gray-200 font-semibold dark:border-gray-600">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-gray-800 dark:bg-gray-900 dark:text-gray-100">Total</th>
                {values && <td colSpan={2} />}
                {COLUMNS.map(column => (
                  <td key={column.key} className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100">
                    <StatCell value={team.totals[column.key]} hide={false} />
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!hideScores && <Shooting team={team} />}
      {team.did_not_play.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          <span className="font-semibold uppercase tracking-wide">Did not play </span>
          {team.did_not_play.map(player => (
            hideScores || !player.reason ? player.name : `${player.name} (${player.reason})`
          )).join(', ')}
        </p>
      )}
    </div>
  )
}

function PlayerName({ player, nameOnly = false }: { player: BoxPlayerLine; nameOnly?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <PlayerNameLink
        name={player.name}
        playerId={player.player_id}
        className="min-w-0 truncate text-gray-800 hover:underline dark:text-gray-100"
      />
      {!nameOnly && player.position && <span className="shrink-0 text-[10px] font-normal text-gray-400">{player.position}</span>}
      {!nameOnly && player.ejected && <span className="shrink-0 text-[10px] font-semibold text-rose-600">EJ</span>}
    </span>
  )
}

function NameList({ groups, teamName }: { groups: { label: string; players: BoxPlayerLine[] }[]; teamName: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      {groups.map(group => (
        <div key={group.label}>
          <p className="bg-gray-50/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:bg-gray-800/80">
            {group.label}
          </p>
          <ul>
            {group.players.map(player => (
              <li key={player.player_id || player.name} className="border-t border-gray-100 px-3 py-1.5 text-xs font-medium dark:border-gray-800">
                <PlayerName player={player} nameOnly />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="sr-only">{teamName} players. Stats are hidden.</p>
    </div>
  )
}

function PlayerRow({ player, values }: { player: BoxPlayerLine; values?: PlayerValues }) {
  const value = values?.get(player.player_id)
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <th className="sticky left-0 z-10 max-w-[10rem] bg-white px-3 py-1.5 text-left font-medium dark:bg-gray-900">
        <PlayerName player={player} />
      </th>
      {values && (
        <>
          <td className="whitespace-nowrap px-2 py-1.5 text-left">
            <FantasyTeamTag value={value} />
          </td>
          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
            {value ? <ZValue z={value.z} /> : <span className="text-gray-300 dark:text-gray-600">—</span>}
          </td>
        </>
      )}
      {COLUMNS.map(column => (
        <td key={column.key} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-200">
          <StatCell value={player[column.key]} hide={false} emphasize={column.key === 'plus_minus'} />
        </td>
      ))}
    </tr>
  )
}

function Shooting({ team }: { team: BoxTeamBox }) {
  const items = [
    { label: 'FG%', value: team.shooting.fg_pct },
    { label: '3P%', value: team.shooting.fg3_pct },
    { label: 'FT%', value: team.shooting.ft_pct },
    { label: 'Paint', value: team.shooting.points_in_paint },
    { label: 'Fast break', value: team.shooting.fast_break_points },
    { label: 'Off turnovers', value: team.shooting.turnover_points },
    { label: 'Biggest lead', value: team.shooting.largest_lead },
  ].filter(item => item.value)
  if (items.length === 0) return null
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
      {items.map(item => (
        <div key={item.label} className="flex gap-1">
          <dt>{item.label}</dt>
          <dd className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function BoxScorePanel({
  game,
  hideScores,
  revealed = false,
  onToggleReveal,
  values,
}: {
  game: GameBoxScore
  hideScores: boolean
  revealed?: boolean
  onToggleReveal?: () => void
  values?: PlayerValues
}) {
  const [side, setSide] = useState<'away' | 'home'>('away')
  const spoilable = hideScores && game.status !== 'scheduled'
  const hide = spoilable && !revealed
  const shown = side === 'away' ? game.away : game.home
  const attendance = game.attendance ? `Attendance ${game.attendance.toLocaleString()}` : ''
  const when = gameClockLabel(game.status, game.status_detail, game.start_time)
  const center = game.status === 'scheduled'
    ? (localClock(game.start_time) || 'Upcoming')
    : when
  const meta = [when, game.venue, attendance].filter(Boolean).join(' · ')

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 sm:p-6">
      <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <TeamHeader team={game.away} hide={hide} align="left" />
        <div className="hidden max-w-[9rem] text-center sm:block">
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${game.status === 'live' ? 'text-rose-600' : 'text-gray-500 dark:text-gray-400'}`}>
            {center}
          </p>
        </div>
        <TeamHeader team={game.home} hide={hide} align="right" />
      </div>
      {meta && <p className="mt-3 text-center text-[11px] text-gray-400">{meta}</p>}
      {spoilable && onToggleReveal && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onToggleReveal}
            className={revealed
              ? 'rounded-full px-3 py-1.5 text-xs font-semibold text-gray-500 ring-1 ring-gray-200 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-gray-400 dark:ring-gray-700 dark:hover:text-gray-100'
              : 'rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'}
          >
            {revealed ? 'Hide this game again' : 'Show this game'}
          </button>
        </div>
      )}
      <div className="mt-4">
        <Linescore game={game} hideScores={hide} />
      </div>

      <div role="tablist" aria-label="Team" className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {(['away', 'home'] as const).map(key => {
          const team = game[key]
          const selected = side === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSide(key)}
              className={`rounded-md px-2 py-2 text-sm font-semibold transition-colors ${selected ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              {team.abbreviation}
            </button>
          )
        })}
      </div>
      <div className="mt-4">
        <PlayerTable team={shown} hideScores={hide} values={hide ? undefined : values} />
      </div>
    </section>
  )
}

function TeamHeader({ team, hide, align }: { team: BoxTeamBox; hide: boolean; align: 'left' | 'right' }) {
  const end = align === 'right'
  return (
    <div className={`flex min-w-0 items-center gap-2 sm:gap-3 ${end ? 'flex-row-reverse text-right' : ''}`}>
      <TeamMark team={team} size="lg" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100 sm:text-base">{team.short_name || team.name}</p>
        {team.record && !hide && <p className="text-[11px] text-gray-400">{team.record}</p>}
        <div className={`mt-1 ${end ? 'flex justify-end' : ''}`}>
          <ScoreFigure score={team.score} hide={hide} winner={team.winner && !hide} />
        </div>
      </div>
    </div>
  )
}
