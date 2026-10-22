import type { SurpriseRow } from '../../types/api';
import PlayerNameLink from '../PlayerNameLink';
import { toListHeadshotUrl } from '../../utils/adp';
import { nameCellWrapClass, wrapFriendlyName } from '../../utils/wrapName';
import { driverColumns } from '../share/boomOrBustMessage';
import { markClass } from './marks';
import { scoreBarClass, scoreTextClass } from './scoreBands';

function fmtScore(score: number): string {
  const s = Math.abs(score).toFixed(1);
  if (s === '0.0') return '0.0';   // no "−0.0" for a score that rounds to nothing
  return score < 0 ? `−${s}` : `+${s}`;
}

function fmtStat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "57%" with the makes over attempts beneath it, as the Projections table shows shooting. */
function ShootingCell({ made, att, mark }: { made: number; att: number; mark?: string }) {
  if (!(att > 0)) return <span className="text-gray-400">—</span>;
  return (
    <span className={`tabular-nums${mark ? ` ${mark}` : ''}`}>
      {Math.round((made / att) * 100)}%
      <span className={`inline-flex flex-col items-center leading-[0.9] text-xs align-middle ml-1 ${mark?.includes('text-white') ? 'text-white/85' : 'text-gray-500 dark:text-gray-400'}`}>
        <span className="border-b border-current px-0.5">{fmtStat(made)}</span>
        <span>{fmtStat(att)}</span>
      </span>
    </span>
  );
}

const STAT_COLS: [keyof SurpriseRow, string][] = [
  ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['stl', 'STL'], ['blk', 'BLK'],
];

/** "· DOR ● started", "· AAT ○ bench", "· FA": where he was in the league that night. */
function FantasyBullet({ row }: { row: SurpriseRow }) {
  if (row.fantasy_team === undefined) return null;
  if (row.fantasy_team === null) return <span className="text-gray-400 dark:text-gray-500">· FA</span>;
  const state = row.started === null ? null : row.started ? 'started' : row.lineup_slot === 'IR' ? 'IR' : 'bench';
  const dot = state === 'started' ? 'bg-emerald-500' : state === 'IR' ? 'bg-amber-400' : 'bg-gray-400';
  // The team's full name, capped so a long one ("Amihai's Awesome Team 🏆")
  // ends in "…" instead of widening the player column (and the share image);
  // the whole name is on hover.
  const name = row.fantasy_team_name || row.fantasy_team;
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className="shrink-0">·</span>
      <span className="truncate max-w-[8.5rem]" title={name}>{name}</span>
      {state && (
        <span className="inline-flex items-center gap-1 font-normal shrink-0">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
          {state}
        </span>
      )}
    </span>
  );
}

/** Headshot + name link + team abbr, without the position pills PlayerIdentityCell always renders.
 * On a narrow screen the headshot is left out so the pinned cell is only the name and the line under it. */
function PlayerCell({ row, eager = false, badge, share = false }: { row: SurpriseRow; eager?: boolean; badge?: 'boom' | 'bust'; share?: boolean }) {
  const src = toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${row.player_id}.png`);
  return (
    <div className="flex items-center gap-2 min-w-0 w-full">
      <div className={`shrink-0 w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 ${share ? '' : 'hidden sm:block'}`}>
        {src ? (
          <>
            <img
              src={src}
              alt=""
              width={32}
              height={32}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              className="w-full h-full object-cover object-top"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling;
                if (fallback instanceof HTMLElement) fallback.hidden = false;
              }}
            />
            <div hidden className="w-full h-full flex items-center justify-center text-sm">🏀</div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm">🏀</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          {badge && (
            <span aria-label={badge === 'boom' ? 'Boom' : 'Bust'} className="shrink-0">
              {badge === 'boom' ? '💥' : '💩'}
            </span>
          )}
          <PlayerNameLink name={wrapFriendlyName(row.player_name)} playerId={row.player_id} />
        </div>
        <div className={`mt-0.5 flex items-center gap-x-1 gap-y-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 ${share ? 'whitespace-nowrap' : 'flex-wrap sm:flex-nowrap sm:whitespace-nowrap'}`}>
          <span>{row.team_abbr}</span>
          <FantasyBullet row={row} />
        </div>
      </div>
    </div>
  );
}

/** "Oct 21" for a row's night. */
const fmtNight = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** `share` renders the table for the share image: headshots load at once (the
 * card sits off-screen, where a lazy image may never load before the PNG is
 * taken), no scroll box (a scrollbar would be painted into the image) and no
 * pinned columns. `startRank` numbers the rows on a later page. `showDate`
 * adds each row's night, for a period of several nights. `perGame` is a
 * player's form over a span: games played instead of the matchup and the line
 * per game. `badges` marks players who are also in the boom or bust list. */
export function SurpriseTable({
  rows, share = false, startRank = 1, showDate = false, perGame = false, emptyText, badges,
}: {
  rows: SurpriseRow[]
  kind: 'good' | 'bad'
  share?: boolean
  startRank?: number
  showDate?: boolean
  perGame?: boolean
  emptyText?: string
  badges?: ReadonlyMap<number, 'boom' | 'bust'>
}) {
  const eager = share;
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
        {emptyText ?? (showDate || perGame ? 'Nobody crossed the bar in this period.' : 'Nobody crossed the bar tonight.')}
      </p>
    );
  }
  // The stats that made the night, marked in the row in their own colour:
  // green above the player's norm, red below, whichever table this is, and
  // deeper the further the stat sits from his norm (see markClass).
  const th = 'px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';
  const td = 'px-2 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300 text-center';
  // From `sm` up, the rank stays pinned (exactly 2.25rem, rem so it scales with
  // the OS font) and the player cell, photo included, sits just after it. On a
  // narrow screen only the name and the line under it stay pinned, at the left
  // edge, and a long name wraps the way the other player tables do. The
  // divider is an inset shadow, which travels with a sticky cell (a collapsed
  // table border does not).
  const stickyRank = share ? '' : 'sm:sticky sm:left-0 sm:z-10 w-9 min-w-[2.25rem] max-w-[2.25rem]';
  const stickyPlayer = share
    ? ''
    : 'sticky left-0 z-10 sm:left-9 shadow-[inset_-1px_0_0_rgb(229_231_235)] dark:shadow-[inset_-1px_0_0_rgb(55_65_81)]';
  const stickyHead = share ? '' : 'bg-gray-50 dark:bg-gray-800';
  const stickyCell = share ? '' : 'bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800';
  return (
    // Each table scrolls on its own: overscroll-x-contain stops a fast swipe
    // past its edge from spilling into the page (or the browser's back
    // gesture). On a phone the name stays pinned while the rank scrolls away.
    <div className={share ? 'overflow-visible' : 'overflow-x-auto overscroll-x-contain'}>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className={`${th} text-right ${stickyRank} ${stickyHead}`}>#</th>
            <th className={`${th} text-left ${stickyPlayer} ${stickyHead}`}>Player</th>
            {showDate && <th className={`${th} text-left`}>Date</th>}
            <th className={`${th} ${perGame ? '' : 'text-left'}`}>{perGame ? 'GP' : 'Matchup'}</th>
            <th className={th}>MIN</th>
            {STAT_COLS.map(([, label]) => <th key={label} className={th}>{label}</th>)}
            <th className={th}>FG%</th>
            <th className={th}>FT%</th>
            <th className={`${th} text-left`}>Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map((row, i) => {
            const drivers = driverColumns(row);
            const markOf = (col: string) => {
              const d = drivers.get(col);
              return d ? markClass(d.sign, d.z) : undefined;
            };
            return (
            // One player can have two rows over a period (two big nights): the key is the player-night.
            <tr key={`${row.player_id}-${row.game_date}`} className="group hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className={`${td} text-right text-gray-400 dark:text-gray-500 ${stickyRank} ${stickyCell}`}>{startRank + i}</td>
              <td className={`px-1.5 py-2 sm:px-2 sm:min-w-[12rem] ${share ? 'min-w-[12rem]' : nameCellWrapClass(row.player_name)} ${stickyPlayer} ${stickyCell}`}>
                <PlayerCell row={row} eager={eager} badge={badges?.get(row.player_id)} share={share} />
              </td>
              {showDate && <td className={`${td} text-left tabular-nums`}>{fmtNight(row.game_date)}</td>}
              <td className={`${td} ${perGame ? '' : 'text-left'}`}>{perGame ? row.games : (row.is_home ? `vs ${row.opponent_abbr}` : `@ ${row.opponent_abbr}`)}</td>
              <td className={td}>{perGame ? fmtStat(row.minutes) : Math.round(row.minutes)}</td>
              {STAT_COLS.map(([key, label]) => {
                const value = perGame ? fmtStat(row[key] as number) : (row[key] as number);
                const mark = markOf(key);
                return (
                  <td key={label} className={td}>
                    {mark ? <span className={mark}>{value}</span> : value}
                  </td>
                );
              })}
              <td className={td}><ShootingCell made={row.fgm} att={row.fga} mark={markOf('fg')} /></td>
              <td className={td}><ShootingCell made={row.ftm} att={row.fta} mark={markOf('ft')} /></td>
              <td className="px-2 py-2 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold tabular-nums w-10 ${scoreTextClass(row.score)}`}>{fmtScore(row.score)}</span>
                  <div className="w-16 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div className={`h-full ${scoreBarClass(row.score)}`} style={{ width: `${Math.min(Math.abs(row.score) / 4, 1) * 100}%` }} />
                  </div>
                  {perGame && row.avg_score != null && (row.games ?? 0) > 1 && (
                    <span className="text-[10px] tabular-nums text-gray-400" title="His plain average per game; the score combines his games so it stays on the night's scale">
                      avg {fmtScore(row.avg_score)}
                    </span>
                  )}
                  {!row.has_estimate && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-gray-400"
                      title="No model estimate yet (fewer than 10 games this season) — scored on his own history only"
                    >
                      history only
                    </span>
                  )}
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
