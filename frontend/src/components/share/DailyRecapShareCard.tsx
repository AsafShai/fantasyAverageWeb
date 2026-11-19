import type { ReactNode } from 'react'
import type { Team } from '../../types/api'
import type { DailyRecap, RecapMove, RecapPlayer, RecapStat, RecapSurprise, RecapSurpriseSide, RecapTeam } from '../../utils/dailyRecap'
import { placesMoved, signedPoints, surpriseCount } from '../../utils/dailyRecap'
import { signedZ } from '../boxScores/linesOfTheNightFormat'
import { toListHeadshotUrl } from '../../utils/adp'
import { formatPoints } from './shareCardFormat'
import './ShareCard.css'
import './DailyRecapShareCard.css'

interface DailyRecapShareCardProps {
  dark: boolean
  subtitle: string
  recap: DailyRecap
  /** Mark the viewer's team wherever it shows up. */
  highlight: boolean
  myTeam: Team | null
}

function mine(on: boolean, my: Team | null, teamId: number | null, fantasy: string | null, fantasyName: string | null): boolean {
  if (!on || !my) return false
  if (teamId != null && teamId === my.team_id) return true
  if (fantasy && my.abbrev && fantasy === my.abbrev) return true
  return fantasyName != null && (fantasyName === my.team_name || fantasyName === my.abbrev)
}

function headshot(id: string): string | undefined {
  return toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`) ?? undefined
}

function toneClass(value: number): string {
  if (value > 0) return 'drc-z--up'
  if (value < 0) return 'drc-z--down'
  return ''
}

function signedValue(value: string): number {
  const parsed = Number(value.replace('−', '-'))
  return Number.isFinite(parsed) ? parsed : 0
}

function StatGrid({ stats, signed = false }: { stats: RecapStat[]; signed?: boolean }) {
  if (stats.length === 0) return null
  return (
    <div className="drc-stats">
      {stats.map(stat => (
        <div key={stat.label} className="drc-stat">
          <b>{stat.label}</b>
          <span className={signed ? toneClass(signedValue(stat.value)) : undefined}>{stat.value}</span>
        </div>
      ))}
    </div>
  )
}

function Tile({ kicker, mark, extra, highlight, children }: {
  kicker: string
  mark: string
  extra?: string
  highlight?: boolean
  children: ReactNode
}) {
  return (
    <section className={`drc-tile${highlight ? ' drc-tile--mine' : ''}`}>
      <div className="drc-kickerline">
        <div className="drc-kicker">
          <span className="drc-mark" aria-hidden="true">{mark}</span>
          <span>{kicker}</span>
        </div>
        {extra && <div className="drc-count">{extra}</div>}
      </div>
      {children}
    </section>
  )
}

function TeamTile({ kicker, mark, team, highlight }: { kicker: string; mark: string; team: RecapTeam | null; highlight: boolean }) {
  return (
    <Tile kicker={kicker} mark={mark} highlight={highlight}>
      {team ? (
        <>
          <div className="drc-teamline">
            <div className="drc-team">{team.name}</div>
            <div className="drc-place">#{team.rank}</div>
          </div>
          <div className="drc-figure">
            <div className="drc-total">{formatPoints(team.total)}</div>
            <span className="drc-unit">total</span>
            <span className="drc-unit">{team.gp} GP</span>
          </div>
          <StatGrid stats={team.categories.map(category => ({ label: category.category, value: formatPoints(category.points) }))} />
        </>
      ) : <p className="drc-empty">No standings for this night</p>}
    </Tile>
  )
}

function MoveTile({ kicker, mark, move, empty, highlight }: {
  kicker: string
  mark: string
  move: RecapMove | null
  empty: string
  highlight: boolean
}) {
  const places = move ? placesMoved(move.rankDelta) : ''
  return (
    <Tile kicker={kicker} mark={mark} highlight={highlight}>
      {move ? (
        <>
          <div className="drc-teamline">
            <div className="drc-team">{move.name}</div>
            <div className="drc-figure drc-figure--end">
              <div className={`drc-delta ${toneClass(move.totalDelta).replace('drc-z', 'drc-delta')}`}>{signedPoints(move.totalDelta)}</div>
              <span className="drc-unit">pts</span>
              {places && <span className="drc-places">{places}</span>}
            </div>
          </div>
          <StatGrid
            signed
            stats={move.categories.map(category => ({
              label: category.category,
              value: signedPoints(category.delta),
            }))}
          />
        </>
      ) : <p className="drc-empty">{empty}</p>}
    </Tile>
  )
}

function PlayerBlock({ player, rank, mineRow }: { player: RecapPlayer; rank?: number; mineRow: boolean }) {
  return (
    <li className={`drc-player${mineRow ? ' drc-player--mine' : ''}`}>
      <div className="drc-top">
        {rank != null && <span className="drc-n">{rank}</span>}
        <img className="drc-avatar" src={headshot(player.id)} alt="" />
        <span className="drc-who">
          <span className="drc-name">{player.name}</span>
          <span className="drc-meta">
            {player.nbaTeam} {player.home ? 'vs' : '@'} {player.opponent}
            {' · '}
            {player.fantasyTeamName ?? player.fantasyTeam ?? 'FA'}
          </span>
        </span>
        <span className={`drc-z ${toneClass(player.z)}`}>{signedZ(player.z)}</span>
      </div>
      <StatGrid stats={player.stats} />
    </li>
  )
}

function PlayerRows({ players, mineOf, empty }: { players: RecapPlayer[]; mineOf: (player: RecapPlayer) => boolean; empty: string }) {
  if (players.length === 0) return <p className="drc-empty">{empty}</p>
  return (
    <ol className="drc-players">
      {players.map((player, index) => (
        <PlayerBlock key={player.id} player={player} rank={index + 1} mineRow={mineOf(player)} />
      ))}
    </ol>
  )
}

function SurpriseTile({ kicker, mark, side, rule, mineOf }: {
  kicker: string
  mark: string
  side: RecapSurpriseSide
  rule: string
  mineOf: (row: RecapSurprise) => boolean
}) {
  return (
    <Tile kicker={kicker} mark={mark} extra={surpriseCount(side)}>
      <div className="drc-rule">{rule}</div>
      {side.shown.length === 0 ? <p className="drc-empty">None cleared the bar</p> : (
        <ul className="drc-booms">
          {side.shown.map(row => (
            <li key={row.id} className={`drc-boom${mineOf(row) ? ' drc-boom--mine' : ''}`}>
              <div className="drc-top">
                <img className="drc-avatar" src={headshot(String(row.id))} alt="" />
                <span className="drc-who">
                  <span className="drc-name">{row.name}</span>
                  <span className="drc-meta">
                    {row.home ? 'vs' : '@'} {row.opponent}
                    {row.fantasyTeamName || row.fantasyTeam ? ` · ${row.fantasyTeamName ?? row.fantasyTeam}` : ' · FA'}
                  </span>
                </span>
                <span className={`drc-score ${toneClass(row.score)}`}>{signedPoints(row.score)}</span>
              </div>
              <StatGrid stats={row.stats} />
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

function ReportHead({ subtitle }: { subtitle: string }) {
  return (
    <header className="drc-head">
      <div className="drc-brand">
        <span>Fantasy League</span>
        <span>{subtitle}</span>
      </div>
      <div className="drc-title">Fantasy Daily Recap</div>
    </header>
  )
}

/** One poster: five rows, two sections each. */
export const DailyRecapShareCard = ({ dark, subtitle, recap, highlight, myTeam }: DailyRecapShareCardProps) => {
  const teamMine = (teamId: number | null) => mine(highlight, myTeam, teamId, null, null)
  const playerMine = (player: { fantasyTeam: string | null; fantasyTeamName: string | null }) =>
    mine(highlight, myTeam, null, player.fantasyTeam, player.fantasyTeamName)
  const bar = (side: RecapSurpriseSide, sign: '≥ ' | '≤ −') => `score ${sign}${side.threshold.toFixed(1)}`

  return (
    <div className={`share-card share-card--recap${dark ? ' share-card--dark' : ''}`}>
      <ReportHead subtitle={subtitle} />
      <div className="drc-grid">
        <TeamTile kicker="Best team of the night" mark="🏆" team={recap.best} highlight={teamMine(recap.best?.teamId ?? null)} />
        <TeamTile kicker="Worst team of the night" mark="🥶" team={recap.worst} highlight={teamMine(recap.worst?.teamId ?? null)} />
        <MoveTile kicker="Biggest rise" mark="📈" move={recap.rise} empty="No team gained points" highlight={teamMine(recap.rise?.teamId ?? null)} />
        <MoveTile kicker="Biggest fall" mark="📉" move={recap.fall} empty="No team lost points" highlight={teamMine(recap.fall?.teamId ?? null)} />
        <Tile kicker="Lines of the night" mark="🔥">
          <PlayerRows players={recap.lines} mineOf={playerMine} empty="No lines yet" />
        </Tile>
        <Tile kicker="FA of the night" mark="🆓">
          <PlayerRows players={recap.freeAgents} mineOf={playerMine} empty="No free agents" />
        </Tile>
        <Tile kicker="Worst starter performance" mark="😬" highlight={playerMine(recap.started ?? { fantasyTeam: null, fantasyTeamName: null })}>
          {recap.started
            ? <ol className="drc-players"><PlayerBlock player={recap.started} mineRow={false} /></ol>
            : <p className="drc-empty">No starter with a line</p>}
        </Tile>
        <Tile kicker="Best bench performance" mark="🪑" highlight={playerMine(recap.benched ?? { fantasyTeam: null, fantasyTeamName: null })}>
          {recap.benched
            ? <ol className="drc-players"><PlayerBlock player={recap.benched} mineRow={false} /></ol>
            : <p className="drc-empty">No bench player with a line</p>}
        </Tile>
        <SurpriseTile kicker="Boom" mark="💥" side={recap.boom} rule={bar(recap.boom, '≥ ')} mineOf={playerMine} />
        <SurpriseTile kicker="Bust" mark="💩" side={recap.bust} rule={bar(recap.bust, '≤ −')} mineOf={playerMine} />
      </div>
      <div className="share-card__foot">
        <span>Averages, rankings, last 1 day</span>
        <span>Lines, boom and bust from last night</span>
      </div>
    </div>
  )
}

export const DailyRecapLoadingCard = ({ dark }: { dark: boolean }) => (
  <div className={`share-card share-card--recap${dark ? ' share-card--dark' : ''}`}>
    <ReportHead subtitle="Last night" />
    <div className="drc-loading">Loading last night</div>
  </div>
)
