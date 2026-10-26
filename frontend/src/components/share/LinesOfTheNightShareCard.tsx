import type { SlatePlayerValue, SlateValues } from '../../types/boxScore'
import { toListHeadshotUrl } from '../../utils/adp'
import { lineSummary, signedZ, zExplainer } from '../boxScores/linesOfTheNightFormat'
import type { ShareCardTheme } from './ShareCard'

interface LinesOfTheNightShareCardProps extends ShareCardTheme {
  /** "Sunday, Oct 25" */
  dateLabel: string
  games: number
  players: SlatePlayerValue[]
  basis: SlateValues['basis']
}

export const CARD_WIDTH = 560

/**
 * Lines of the night as one image: the five best lines of a finished slate,
 * with headshot, NBA team, the fantasy team that had him, the line and its Z.
 * Rendered in the page's document so Tailwind (and `dark`) apply.
 */
export const LinesOfTheNightShareCard = ({ dateLabel, games, players, basis }: LinesOfTheNightShareCardProps) => (
  <div
    className="overflow-hidden rounded-2xl bg-gray-50 font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100"
    style={{ width: CARD_WIDTH }}
  >
    <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 px-5 py-4 text-white">
      <div className="flex items-center justify-between whitespace-nowrap text-xs font-semibold opacity-90">
        <span>🏀 Fantasy League</span>
        <span>Box scores</span>
      </div>
      <div className="mt-1 whitespace-nowrap text-2xl font-extrabold tracking-tight">🔥 Lines of the night</div>
      <div className="mt-0.5 whitespace-nowrap text-sm text-amber-50">
        {dateLabel} · {games} game{games === 1 ? '' : 's'}
      </div>
    </div>
    <ol className="m-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-900">
      {players.map((player, index) => (
        <li key={`${player.game_id}-${player.player_id}`} className="flex items-center gap-3 px-4 py-3">
          <span className="w-5 shrink-0 text-center text-lg font-extrabold tabular-nums text-amber-500">{index + 1}</span>
          <div className="relative h-11 w-11 shrink-0">
            <div className="h-11 w-11 overflow-hidden rounded-full border border-gray-200 bg-gray-200 dark:border-gray-600 dark:bg-gray-700">
              <img
                src={toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${player.player_id}.png`) ?? undefined}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            {player.team_logo && (
              <img src={player.team_logo} alt="" className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white object-contain p-px dark:bg-gray-900" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="truncate text-[15px] font-bold">{player.name}</span>
              <span
                className={player.fantasy_team
                  ? 'rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                  : 'text-[10px] font-semibold uppercase text-gray-400'}
              >
                {player.fantasy_team_name ?? player.fantasy_team ?? 'FA'}
              </span>
            </div>
            <div className="mt-0.5 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">{lineSummary(player)}</div>
            <div className="whitespace-nowrap text-[11px] text-gray-400">
              {player.team_abbr} {player.is_home ? 'vs' : '@'} {player.opponent_abbr} · {player.min} min · {player.fg} FG · {player.ft} FT
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Z</div>
            <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{signedZ(player.z)}</div>
          </div>
        </li>
      ))}
    </ol>
    <p className="px-5 pb-4 text-[11px] text-gray-500 dark:text-gray-400">
      Z = {zExplainer(basis)}
    </p>
  </div>
)
