import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useMyTeam } from '../../context/useMyTeam'
import { timePeriodLabel } from '../../hooks/usePlayerProfileData'
import { useGetAllPlayersQuery, useGetNbaPlayerQuery, useGetTeamPlayersQuery } from '../../store/api/fantasyApi'
import type { CustomDateRange, Player, TimePeriod } from '../../types/api'
import { DEFAULT_CATEGORIES, getPlayerRankSummary } from '../../utils/playerRankings'
import { orderCategories } from '../../utils/statOrder'
import { BottomSheet, PeriodChips } from '../ui'
import { usePlayerSheet } from './usePlayerSheet'
import { tradeLinkForPlayer } from './tradePreset'

/*
 * Player sheet (step 3): a quick look at a player from any player name on a
 * phone, over the page it was opened on. Only data the site already shows:
 * per-game stats from the Players list for the shared period chips (Season,
 * Last 7 / 15 / 30 days, Custom range),
 * the fantasy owner and lineup slot, and the player's overall / position rank and
 * z-score for the selected period (ranked the same way as the full profile).
 * No projection here (kept on the full profile). Full profile and Trade
 * Analyzer lead to the full pages.
 */

const f1 = (v: number) => v.toFixed(1)
/** .485 style, as in the design. */
const f3 = (v: number) => v.toFixed(3).replace(/^0/, '')

function slotLabel(slot: string | null | undefined): string | null {
  if (!slot) return null
  return slot === 'BE' ? 'Bench' : slot
}



/** Same green / red band as the profile's Fantasy Value card. */
function zTone(z: number): string {
  if (z >= 0.25) return 'mr-ps-up'
  if (z <= -0.25) return 'mr-ps-down'
  return ''
}

const HEADINGS: Partial<Record<TimePeriod, string>> = {
  season: 'SEASON',
  last_7: 'LAST 7 DAYS',
  last_15: 'LAST 15 DAYS',
  last_30: 'LAST 30 DAYS',
}

function statTiles(p: Player): { k: string; v: string }[] {
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

export default function PlayerSheet() {
  const sheet = usePlayerSheet()
  const { playerId } = sheet
  if (!playerId) return null
  // Keyed so nothing carries over between players.
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
  const { teams, myTeamId } = useMyTeam()
  const [period, setPeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  const isCustom = period === 'custom' && !!customRange
  // The same per-period list Players / Player Rankings use; Season is the query above.
  const { currentData: periodList, isFetching: periodFetching } = useGetAllPlayersQuery(
    { page: 1, limit: 1200, time_period: period, ...(isCustom ? { start: customRange.start, end: customRange.end } : {}) },
    { skip: period === 'season' || (period === 'custom' && !customRange) },
  )
  const periodPlayer =
    period === 'season'
      ? player
      : periodList?.players.find((p) => p.player_id != null && String(p.player_id) === playerId && p.has_data !== false) ?? null
  // Rank for the selected period, computed exactly like the full profile's
  // Fantasy Value card (per game, equal weights, league categories).
  const apiCategories = all?.categories
  const rankList = period === 'season' ? all : periodList
  const rankSummary = useMemo(() => {
    if (!rankList) return null
    const categories = orderCategories(apiCategories?.length ? apiCategories : DEFAULT_CATEGORIES)
    return getPlayerRankSummary(rankList.players, Number(playerId), categories, new Set(rankList.reverse_categories ?? []))
  }, [rankList, apiCategories, playerId])
  const heading = isCustom
    ? timePeriodLabel('custom', customRange).toUpperCase()
    : HEADINGS[period] ?? 'SEASON'

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
    <BottomSheet open onClose={sheet.close} title={name} hideTitle className="mr-ps-sheet">
      <div className="mr-card-head mr-ps-head">
        <div className="mr-ps-who">
          <h2 className="mr-h1">{name}</h2>
          {sub && <span className="mr-meta">{sub}</span>}
        </div>
        {player && <OwnerBadge player={player} onGo={(path) => sheet.leaveTo(path)} />}
      </div>

      {player && (
        <>
          {/* block wrapper: the chip row is a flex item that would grow in the sheet's column */}
          <div className="mr-ps-periods">
            <PeriodChips value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
          </div>
          <span className="mr-meta mr-ps-label">
            {heading} · PER GAME
            {periodPlayer && period !== 'season' ? ` · ${periodPlayer.stats.gp} GP` : ''}
          </span>
          {periodPlayer ? (
            <>
            {rankSummary && (
              <div className="mr-ps-value" aria-label="Fantasy value" data-testid="sheet-rank" aria-busy={periodFetching || undefined}>
                <span className="mr-ps-tl">Rank</span>
                {rankSummary.rank != null ? (
                  <span className="mr-ps-tv">
                    #{rankSummary.rank} <span className="mr-meta">of {rankSummary.poolSize}</span>
                  </span>
                ) : (
                  <span className="mr-ps-tv mr-ps-rank-out">Outside top {rankSummary.poolSize}</span>
                )}
                <span className="mr-ps-tl mr-ps-zl">Z</span>
                <span className={`mr-ps-tv ${zTone(rankSummary.totalZ)}`} data-testid="sheet-z">
                  {rankSummary.totalZ >= 0 ? '+' : ''}
                  {rankSummary.totalZ.toFixed(2)}
                </span>
                {rankSummary.positionRanks.length > 0 && (
                  <span className="mr-meta mr-ps-pos">
                    {rankSummary.positionRanks.map(({ position, rank }) => `#${rank} ${position}`).join(' · ')}
                  </span>
                )}
              </div>
            )}
            <div className="mr-ps-grid" role="list" aria-label="Per game" aria-busy={periodFetching || undefined}>
              {statTiles(periodPlayer).map((t) => (
                <div key={t.k} className="mr-ps-tile" role="listitem">
                  <span className="mr-ps-tl">{t.k}</span>
                  <span className="mr-ps-tv">{t.v}</span>
                </div>
              ))}
            </div>
            </>
          ) : (
            <p className="mr-meta mr-ps-empty">{periodFetching || !periodList ? 'Loading…' : 'No games in this period.'}</p>
          )}
        </>
      )}

      <div className="mr-ps-actions">
        <button type="button" className="mr-btn mr-pri mr-grow" onClick={() => sheet.leaveTo(`/player/${playerId}`, profileState)}>
          Full profile
        </button>
        <button
          type="button"
          className="mr-btn mr-grow"
          onClick={() => {
            if (!player) return sheet.leaveTo('/trade')
            const link = tradeLinkForPlayer(player, teams, myTeamId)
            sheet.leaveTo(link.path, link.state)
          }}
        >
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
