import { Link } from 'react-router'
import { useGetAllPlayersQuery, useGetNbaPlayerQuery, useGetTeamPlayersQuery } from '../../store/api/fantasyApi'
import type { Player, ProjectionStats } from '../../types/api'
import { BottomSheet, MinutesStepper } from '../ui'
import { usePlayerSheet } from './usePlayerSheet'
import { useSheetProjection, type SheetProjection } from './useSheetProjection'

/*
 * Player sheet (step 3): a quick look at a player from any player name on a
 * phone, over the page it was opened on. Only data the site already shows:
 * the season line from the Players list, the fantasy owner and lineup slot,
 * and the profile's next-game projection with its minutes control. Full
 * profile and Trade Analyzer lead to the full pages.
 */

const f1 = (v: number) => v.toFixed(1)
/** .485 style, as in the design. */
const f3 = (v: number) => v.toFixed(3).replace(/^0/, '')

function slotLabel(slot: string | null | undefined): string | null {
  if (!slot) return null
  return slot === 'BE' ? 'Bench' : slot
}

function seasonTiles(p: Player): { k: string; v: string }[] {
  const s = p.stats
  const gp = s.gp
  const per = (v: number) => (gp > 0 ? f1(v / gp) : '—')
  const pct = (v: number, att: number) => (att > 0 ? f3(v) : '—')
  return [
    { k: 'MPG', v: per(s.minutes) },
    { k: 'PTS', v: per(s.pts) },
    { k: 'REB', v: per(s.reb) },
    { k: 'AST', v: per(s.ast) },
    { k: 'STL', v: per(s.stl) },
    { k: 'BLK', v: per(s.blk) },
    { k: '3PM', v: per(s.three_pm) },
    { k: 'FG%', v: pct(s.fg_percentage, s.fga) },
    { k: 'FT%', v: pct(s.ft_percentage, s.fta) },
  ]
}

function projTiles(s: ProjectionStats): { k: string; v: string }[] {
  return [
    { k: 'PTS', v: f1(s.pts) },
    { k: 'REB', v: f1(s.reb) },
    { k: 'AST', v: f1(s.ast) },
    { k: '3PM', v: f1(s.three_pm) },
    { k: 'STL', v: f1(s.stl) },
    { k: 'BLK', v: f1(s.blk) },
    { k: 'FG%', v: s.fga > 0 ? f3(s.fg_pct) : '—' },
    { k: 'FT%', v: s.fta > 0 ? f3(s.ft_pct) : '—' },
  ]
}

function gameDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function PlayerSheet() {
  const sheet = usePlayerSheet()
  const { playerId } = sheet
  if (!playerId) return null
  // Keyed so minutes and fetched lines never carry over between players.
  return <PlayerSheetBody key={playerId} playerId={playerId} sheet={sheet} />
}

function PlayerSheetBody({ playerId, sheet }: { playerId: string; sheet: ReturnType<typeof usePlayerSheet> }) {
  // Same request the Players page and the profile make, so usually cached.
  const { data: all, isLoading: listLoading } = useGetAllPlayersQuery({ page: 1, limit: 1200 })
  const player = all?.players.find((p) => p.player_id != null && String(p.player_id) === playerId) ?? null
  const onTeam = player?.status === 'ONTEAM' && player.team_id > 0
  // Lineup slot only comes with a team's roster.
  const { data: roster } = useGetTeamPlayersQuery(player?.team_id ?? 0, { skip: !onTeam })
  const slot = slotLabel(roster?.players.find((p) => p.player_id === player?.player_id)?.lineup_slot)
  // Not in the league's player list (e.g. no games yet): name and team from the bio.
  const { data: bio } = useGetNbaPlayerQuery(playerId, { skip: listLoading || !!player })
  const { loading: projLoading, projection } = useSheetProjection(playerId)

  const name = player?.player_name ?? bio?.display_name ?? (listLoading ? 'Loading…' : 'Player')
  const sub = player
    ? [player.pro_team, player.positions.join('/'), slot, `${player.stats.gp} GP`].filter(Boolean).join(' · ')
    : bio
      ? `${bio.team_abbr} · ${bio.position} · No season stats yet`
      : listLoading
        ? ''
        : 'No season stats yet'

  const profileState = { from: sheet.behind }

  return (
    <BottomSheet open onClose={sheet.close} title={name} hideTitle>
      <div className="mr-card-head mr-ps-head">
        <div className="mr-ps-who">
          <h2 className="mr-h1">{name}</h2>
          {sub && <span className="mr-meta">{sub}</span>}
        </div>
        {player && <OwnerBadge player={player} onGo={(path) => sheet.leaveTo(path)} />}
      </div>

      {player && (
        <>
          <span className="mr-meta mr-ps-label">SEASON · PER GAME</span>
          <div className="mr-ps-grid" role="list" aria-label="Season per game">
            {seasonTiles(player).map((t) => (
              <div key={t.k} className="mr-ps-tile" role="listitem">
                <span className="mr-ps-tl">{t.k}</span>
                <span className="mr-ps-tv">{t.v}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {projLoading && <div className="mr-ps-proj mr-ps-skel" aria-hidden="true" />}
      {projection && <ProjectionBox projection={projection} playerName={name} />}

      <div className="mr-ps-actions">
        <button type="button" className="mr-btn mr-pri mr-grow" onClick={() => sheet.leaveTo(`/player/${playerId}`, profileState)}>
          Full profile
        </button>
        <button type="button" className="mr-btn mr-grow" onClick={() => sheet.leaveTo('/trade')}>
          Trade Analyzer
        </button>
      </div>
    </BottomSheet>
  )
}

function OwnerBadge({ player, onGo }: { player: Player; onGo: (path: string) => void }) {
  if (player.status === 'ONTEAM' && player.fantasy_team_name) {
    const to = `/team/${player.team_id}`
    return (
      <Link
        to={to}
        className="mr-ps-badge mr-ps-owner"
        onClick={(e) => {
          e.preventDefault()
          onGo(to)
        }}
      >
        {player.fantasy_team_name}
      </Link>
    )
  }
  return <span className="mr-ps-badge mr-ps-free">{player.status === 'WAIVERS' ? 'Waivers' : 'Free Agent'}</span>
}

function ProjectionBox({ projection, playerName }: { projection: SheetProjection; playerName: string }) {
  const { data, minutes, defaultMinutes, stats, setMinutes } = projection
  const date = gameDate(data.game_date)
  const vs = `${data.is_home ? 'vs' : '@'} ${data.opponent}`
  const title = data.scheduled ? `Next: ${vs}${date ? ` · ${date}` : ''}` : `Last played: ${vs}${date ? ` · ${date}` : ''} (debug)`
  const adjusted = minutes !== defaultMinutes
  return (
    <section className="mr-ps-proj" aria-label="Next game projection">
      <div className="mr-ps-proj-head">
        <span className="mr-meta mr-ps-next">
          <b>{title}</b> · projected
        </span>
        <MinutesStepper value={minutes} defaultValue={defaultMinutes} onChange={setMinutes} playerName={playerName} />
      </div>
      <div className="mr-ps-line">
        {projTiles(stats).map((t) => (
          <span key={t.k}>
            <i>{t.k}</i>
            <b className="mr-num">{t.v}</b>
          </span>
        ))}
      </div>
      <span className="mr-meta">
        {adjusted ? `Projected for ${minutes} min · default ${defaultMinutes} min` : 'Default minutes from the projection model'}
      </span>
    </section>
  )
}
