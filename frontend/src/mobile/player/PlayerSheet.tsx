import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMyTeam } from '../../context/MyTeamContext'
import DateRangePicker from '../../components/DateRangePicker'
import { timePeriodLabel } from '../../hooks/usePlayerProfileData'
import { useGetAllPlayersQuery, useGetLeagueSummaryQuery, useGetNbaPlayerQuery, useGetTeamPlayersQuery } from '../../store/api/fantasyApi'
import type { CustomDateRange, Player, TimePeriod } from '../../types/api'
import { BottomSheet, Chip, ChipRow, useSheetHistory } from '../ui'
import { usePlayerSheet } from './usePlayerSheet'
import { tradeLinkForPlayer } from './tradePreset'

/*
 * Player sheet (step 3): a quick look at a player from any player name on a
 * phone, over the page it was opened on. Only data the site already shows:
 * per-game stats from the Players list for Season / Last 7 / 15 / 30 days,
 * the fantasy owner and lineup slot.
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

type SheetPeriod = Exclude<TimePeriod, 'last_night'>
type PresetPeriod = Exclude<SheetPeriod, 'custom'>

/** Same periods as the profile's time frame, plus Custom (From/To picker). */
const PERIODS: { value: PresetPeriod; label: string; heading: string }[] = [
  { value: 'season', label: 'Season', heading: 'SEASON' },
  { value: 'last_7', label: 'Last 7', heading: 'LAST 7 DAYS' },
  { value: 'last_15', label: 'Last 15', heading: 'LAST 15 DAYS' },
  { value: 'last_30', label: 'Last 30', heading: 'LAST 30 DAYS' },
]

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
  const [period, setPeriod] = useState<SheetPeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  // where clearing a custom range goes back to
  const prevPeriod = useRef<PresetPeriod>('season')
  const rangeSheet = useSheetHistory('player-range')
  const { data: summary } = useGetLeagueSummaryQuery(undefined, { skip: !rangeSheet.open })
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
  const heading = isCustom
    ? timePeriodLabel('custom', customRange).toUpperCase()
    : PERIODS.find((p) => p.value === period)?.heading ?? 'SEASON'

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
          <ChipRow label="Period" wrap className="mr-ps-periods">
            {PERIODS.map((p) => (
              <Chip
                key={p.value}
                selected={period === p.value}
                onClick={() => {
                  prevPeriod.current = p.value
                  setPeriod(p.value)
                }}
              >
                {p.label}
              </Chip>
            ))}
            <Chip selected={isCustom} onClick={rangeSheet.show} aria-haspopup="dialog">
              {isCustom ? timePeriodLabel('custom', customRange) : 'Custom'}
            </Chip>
            {isCustom && (
              <Chip
                aria-label="Clear custom range"
                onClick={() => {
                  setCustomRange(null)
                  setPeriod(prevPeriod.current)
                }}
              >
                ✕
              </Chip>
            )}
          </ChipRow>
          <span className="mr-meta mr-ps-label">
            {heading} · PER GAME
            {periodPlayer && period !== 'season' ? ` · ${periodPlayer.stats.gp} GP` : ''}
          </span>
          {periodPlayer ? (
            <div className="mr-ps-grid" role="list" aria-label="Per game" aria-busy={periodFetching || undefined}>
              {statTiles(periodPlayer).map((t) => (
                <div key={t.k} className="mr-ps-tile" role="listitem">
                  <span className="mr-ps-tl">{t.k}</span>
                  <span className="mr-ps-tv">{t.v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mr-meta mr-ps-empty">{periodFetching || !periodList ? 'Loading…' : 'No games in this period.'}</p>
          )}
        </>
      )}

      <BottomSheet open={rangeSheet.open} onClose={rangeSheet.hide} title="Custom range">
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={(range) => {
            setCustomRange(range)
            setPeriod('custom')
            rangeSheet.hide()
          }}
        />
      </BottomSheet>

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
