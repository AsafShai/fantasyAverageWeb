import type { ReactNode } from 'react'
import type { Team } from '../../types/api'
import type { DailyRecap, RecapMove, RecapPlayer, RecapStat, RecapSurprise, RecapSurpriseSide, RecapTeam } from '../../utils/dailyRecap'
import { placesMoved, signedPoints } from '../../utils/dailyRecap'
import { signedZ } from '../boxScores/linesOfTheNightFormat'
import { formatPoints } from './shareCardFormat'
import './ShareCard.css'
import './DailyRecapShareCard.css'

interface DailyRecapShareCardProps {
  /** Site theme when the menu opened. The poster has one look and ignores it. */
  dark: boolean
  subtitle: string
  recap: DailyRecap
  /** Mark the viewer's team wherever it shows up. */
  highlight: boolean
  myTeam: Team | null
  /** `@font-face` rules for the poster's typefaces (recapFonts.ts). Without
   * them the card falls back to the system's condensed faces. */
  fontCss?: string
}

function mine(on: boolean, my: Team | null, teamId: number | null, fantasy: string | null, fantasyName: string | null): boolean {
  if (!on || !my) return false
  if (teamId != null && teamId === my.team_id) return true
  if (fantasy && my.abbrev && fantasy === my.abbrev) return true
  return fantasyName != null && (fantasyName === my.team_name || fantasyName === my.abbrev)
}

/** ESPN's resizer, at twice the largest tile (120px) for the 2x export. */
function headshot(id: string): string {
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=240&h=174`
}

function toneClass(value: number): string | undefined {
  if (value > 0) return 'drc-up'
  if (value < 0) return 'drc-down'
  return undefined
}

function signedValue(value: string): number {
  const parsed = Number(value.replace('−', '-'))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Night Z with a true minus, like every other negative on the poster. */
function signedNight(z: number): string {
  return signedZ(z).replace('-', '−')
}

const ICONS = {
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />,
  frost: <path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 3 3-3M9 20l3-3 3 3" />,
  rise: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  fall: <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />,
  flame: <path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-9 0 4-4 7-4 13 0 4 3 7 7 7z" />,
  tag: <><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  down: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8 13l4 4 4-4" /></>,
  bench: <path d="M3 10h18M3 14h18M5 14v6M19 14v6M6 10V5M18 10V5" />,
  boom: <path d="M12 2l2.2 5.6L20 5l-2.6 5.8L23 13l-5.6 1.6L19 21l-5.4-3.2L12 23l-1.6-5.2L5 21l1.6-6.4L1 13l5.6-2.2L4 5l5.8 2.6L12 2z" />,
  bust: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M13 3l-3 6 4 3-3 5 2 4" /></>,
} satisfies Record<string, ReactNode>

type IconName = keyof typeof ICONS

/** Drawn marks, not emoji: an emoji paints differently on every phone and
 * wider in the export than the DOM measured it. */
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg className="drc-icon" data-icon={name} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  )
}

function Kicker({ icon, children, iconLast = false }: { icon: IconName; children: string; iconLast?: boolean }) {
  return (
    <div className="drc-kicker">
      {!iconLast && <Icon name={icon} />}
      <span>{children}</span>
      {iconLast && <Icon name={icon} />}
    </div>
  )
}

const MineTag = () => <span className="drc-mine">My team</span>

function Strip({ stats, variant, signed = false }: { stats: RecapStat[]; variant: string; signed?: boolean }) {
  if (stats.length === 0) return null
  return (
    <div className={`drc-strip ${variant}`}>
      {stats.map(stat => (
        <div key={stat.label}>
          <b>{stat.label}</b>
          <span className={signed ? toneClass(signedValue(stat.value)) : undefined}>{stat.value}</span>
        </div>
      ))}
    </div>
  )
}

function TeamHalf({ side, team, highlight }: { side: 'best' | 'worst'; team: RecapTeam | null; highlight: boolean }) {
  const best = side === 'best'
  const id = (
    <div className="drc-half-id">
      <Kicker icon={best ? 'trophy' : 'frost'} iconLast={!best}>{best ? 'Best team of the night' : 'Worst team of the night'}</Kicker>
      {team ? (
        <>
          <div className="drc-team">{team.name}</div>
          <div className="drc-place">#{team.rank}</div>
          {highlight && <MineTag />}
        </>
      ) : <p className="drc-empty">No standings for this night</p>}
    </div>
  )
  const figure = team && (
    <div className="drc-figure">
      <div className="drc-total">{formatPoints(team.total)}</div>
      <div className="drc-units"><span>Total</span><span>{team.gp} GP</span></div>
    </div>
  )
  return (
    <div className={`drc-half drc-half--${side}`}>
      <div className="drc-half-top">
        {best ? <>{id}{figure}</> : <>{figure}{id}</>}
      </div>
      {team && (
        <Strip
          variant="drc-strip--cats"
          stats={team.categories.map(category => ({ label: category.category, value: formatPoints(category.points) }))}
        />
      )}
    </div>
  )
}

function MoveCard({ dir, move, empty, highlight }: { dir: 'up' | 'down'; move: RecapMove | null; empty: string; highlight: boolean }) {
  const places = move ? placesMoved(move.rankDelta) : ''
  return (
    <div className={`drc-move drc-move--${dir}`}>
      <div className="drc-move-id">
        <Kicker icon={dir === 'up' ? 'rise' : 'fall'}>{dir === 'up' ? 'Biggest rise' : 'Biggest fall'}</Kicker>
        {move ? (
          <>
            <div className="drc-team">{move.name}</div>
            {places && <div className="drc-places">{places}</div>}
            {highlight && <MineTag />}
            <Strip
              signed
              variant="drc-strip--deltas"
              stats={move.categories.map(category => ({ label: category.category, value: signedPoints(category.delta) }))}
            />
          </>
        ) : <p className="drc-empty">{empty}</p>}
      </div>
      {move && (
        <div className="drc-delta">
          <strong>{signedPoints(move.totalDelta)}</strong>
          <span>PTS</span>
        </div>
      )}
    </div>
  )
}

const LINEUP: Record<'started' | 'bench' | 'ir', { tone: string; label: string }> = {
  started: { tone: 'drc-pill--start', label: 'Started' },
  bench: { tone: 'drc-pill--bench', label: 'Bench' },
  ir: { tone: 'drc-pill--ir', label: 'IR' },
}

/** The lineup light: a dot and the word, so it does not rest on color alone.
 * Always on its own line under the team, the same place on every row. */
function Tags({ lineup, mineRow }: { lineup: RecapPlayer['lineup']; mineRow: boolean }) {
  if (!lineup && !mineRow) return null
  return (
    <div className="drc-tags">
      {lineup && <span className={`drc-pill ${LINEUP[lineup].tone}`}><i />{LINEUP[lineup].label}</span>}
      {mineRow && <MineTag />}
    </div>
  )
}

function Who({ name, meta, lineup, mineRow, display = false }: {
  name: string
  meta: string
  lineup: RecapPlayer['lineup']
  mineRow: boolean
  display?: boolean
}) {
  return (
    <div className="drc-who">
      <div className={`drc-name${display ? ' drc-name--display' : ''}`}>{name}</div>
      <div className="drc-meta">{meta}</div>
      <Tags lineup={lineup} mineRow={mineRow} />
    </div>
  )
}

/** Two scales share the poster, so every score carries its label. */
function Score({ label, value, text }: { label: 'Night Z' | 'Surprise'; value: number; text: string }) {
  return (
    <div className="drc-score">
      <b>{label}</b>
      <span className={toneClass(value)}>{text}</span>
    </div>
  )
}

function playerMeta(player: RecapPlayer): string {
  return `${player.nbaTeam} ${player.home ? 'vs' : '@'} ${player.opponent} · ${player.fantasyTeamName ?? player.fantasyTeam ?? 'FA'}`
}

function LinesPanel({ title, icon, players, empty, mineOf, paper = false, markLineup = false }: {
  title: string
  icon: IconName
  players: RecapPlayer[]
  empty: string
  mineOf: (player: RecapPlayer) => boolean
  paper?: boolean
  markLineup?: boolean
}) {
  const [first, ...rest] = players
  return (
    <div className={`drc-panel${paper ? ' drc-panel--paper' : ''}`}>
      <div className="drc-panel-head">
        <Icon name={icon} size={32} />
        <div className="drc-panel-title">{title}</div>
        <div className="drc-panel-rule" />
      </div>
      {!first ? <p className="drc-empty">{empty}</p> : (
        <>
          <div className="drc-hero">
            <div className="drc-hero-face">
              <img src={headshot(first.id)} alt="" />
              <div className="drc-hero-n">1</div>
            </div>
            <Who display name={first.name} meta={playerMeta(first)} lineup={markLineup ? first.lineup : null} mineRow={mineOf(first)} />
            <Score label="Night Z" value={first.z} text={signedNight(first.z)} />
          </div>
          <Strip variant="drc-strip--line drc-strip--hero" stats={first.stats} />
          {rest.map((player, index) => (
            <div key={player.id} className="drc-row">
              <div className="drc-row-top">
                <div className="drc-n">{index + 2}</div>
                <img className="drc-avatar" src={headshot(player.id)} alt="" />
                <Who name={player.name} meta={playerMeta(player)} lineup={markLineup ? player.lineup : null} mineRow={mineOf(player)} />
                <Score label="Night Z" value={player.z} text={signedNight(player.z)} />
              </div>
              <Strip variant="drc-strip--line" stats={player.stats} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function SoloCard({ dir, title, icon, player, empty, mineRow }: {
  dir: 'up' | 'down'
  title: string
  icon: IconName
  player: RecapPlayer | null
  empty: string
  mineRow: boolean
}) {
  return (
    <div className={`drc-solo drc-solo--${dir}`}>
      <div className="drc-solo-head"><Kicker icon={icon}>{title}</Kicker></div>
      <div className="drc-solo-body">
        {player ? (
          <>
            <div className="drc-solo-top">
              <img className="drc-solo-face" src={headshot(player.id)} alt="" />
              <Who display name={player.name} meta={playerMeta(player)} lineup={null} mineRow={mineRow} />
              <Score label="Night Z" value={player.z} text={signedNight(player.z)} />
            </div>
            <Strip variant="drc-strip--line drc-strip--solo" stats={player.stats} />
          </>
        ) : <p className="drc-empty">{empty}</p>}
      </div>
    </div>
  )
}

function SurprisePanel({ dir, side, mineOf }: { dir: 'up' | 'down'; side: RecapSurpriseSide; mineOf: (row: RecapSurprise) => boolean }) {
  const capped = side.total > side.shown.length
  return (
    <div className={`drc-boom drc-boom--${dir}`}>
      <div className="drc-band">
        <Icon name={dir === 'up' ? 'boom' : 'bust'} size={42} />
        <div className="drc-band-word">{dir === 'up' ? 'Boom' : 'Bust'}</div>
        <div className="drc-band-lines" aria-hidden="true" />
        {capped && <div className="drc-band-cap">top {side.shown.length} of</div>}
        <div className="drc-band-count">{side.total}</div>
      </div>
      {side.shown.length === 0 ? <p className="drc-empty">None cleared the bar</p> : side.shown.map(row => (
        <div key={row.id} className="drc-brow">
          <div className="drc-brow-top">
            <div className="drc-face"><img src={headshot(String(row.id))} alt="" /></div>
            <Who
              display
              name={row.name}
              meta={`${row.home ? 'vs' : '@'} ${row.opponent} · ${row.fantasyTeamName ?? row.fantasyTeam ?? 'FA'}`}
              lineup={row.lineup}
              mineRow={mineOf(row)}
            />
            <Score label="Surprise" value={row.score} text={signedPoints(row.score)} />
          </div>
          <Strip variant="drc-strip--line" stats={row.stats} />
        </div>
      ))}
      <div className="drc-fill" aria-hidden="true" />
    </div>
  )
}

function ReportHead({ subtitle }: { subtitle: string }) {
  return (
    <header className="drc-head">
      <div className="drc-headline">
        <div className="drc-title">Fantasy Daily <span>Recap</span></div>
        <div className="drc-brandbox">
          <div className="drc-brand">Fantasy League</div>
          <div className={`drc-date${subtitle.length > 14 ? ' drc-date--long' : ''}`}>{subtitle}</div>
        </div>
      </div>
      <div className="drc-hazard" aria-hidden="true" />
    </header>
  )
}

/** One poster: five rows, two sections each. */
export const DailyRecapShareCard = ({ subtitle, recap, highlight, myTeam, fontCss }: DailyRecapShareCardProps) => {
  const teamMine = (teamId: number | null) => mine(highlight, myTeam, teamId, null, null)
  const playerMine = (player: { fantasyTeam: string | null; fantasyTeamName: string | null } | null) =>
    player != null && mine(highlight, myTeam, null, player.fantasyTeam, player.fantasyTeamName)

  return (
    <div className="share-card share-card--recap">
      {fontCss && <style>{fontCss}</style>}
      <ReportHead subtitle={subtitle} />
      <section className="drc-duel">
        <TeamHalf side="best" team={recap.best} highlight={teamMine(recap.best?.teamId ?? null)} />
        <TeamHalf side="worst" team={recap.worst} highlight={teamMine(recap.worst?.teamId ?? null)} />
      </section>
      <section className="drc-pair">
        <MoveCard dir="up" move={recap.rise} empty="No team gained points" highlight={teamMine(recap.rise?.teamId ?? null)} />
        <MoveCard dir="down" move={recap.fall} empty="No team lost points" highlight={teamMine(recap.fall?.teamId ?? null)} />
      </section>
      <section className="drc-pair">
        <LinesPanel title="Lines of the night" icon="flame" players={recap.lines} empty="No lines yet" mineOf={playerMine} markLineup />
        <LinesPanel title="FA of the night" icon="tag" players={recap.freeAgents} empty="No free agents" mineOf={playerMine} paper />
      </section>
      <section className="drc-pair">
        <SoloCard dir="down" title="Worst starter performance" icon="down" player={recap.started} empty="No starter with a line" mineRow={playerMine(recap.started)} />
        <SoloCard dir="up" title="Best bench performance" icon="bench" player={recap.benched} empty="No bench player with a line" mineRow={playerMine(recap.benched)} />
      </section>
      <section className="drc-pair">
        <SurprisePanel dir="up" side={recap.boom} mineOf={playerMine} />
        <SurprisePanel dir="down" side={recap.bust} mineOf={playerMine} />
      </section>
      <footer className="drc-foot">
        <span>Averages, rankings, last 1 day</span>
        <span>Lines, boom and bust from last night</span>
      </footer>
    </div>
  )
}

export const DailyRecapLoadingCard = ({ fontCss }: { dark: boolean; fontCss?: string }) => (
  <div className="share-card share-card--recap">
    {fontCss && <style>{fontCss}</style>}
    <ReportHead subtitle="Last night" />
    <div className="drc-loading">Loading last night</div>
  </div>
)
