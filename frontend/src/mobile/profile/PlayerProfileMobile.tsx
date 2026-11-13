import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import type { CustomDateRange, PlayerStatKey, TimePeriod } from '../../types/api'
import { CoverageNotice } from '../../components/DateRangePicker'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { backLabel, usePlayerProfileData } from '../../hooks/usePlayerProfileData'
import { Card, DataTable, Segmented, type Column } from '../ui'
import TimeFrameChips from './TimeFrameChips'
import FantasyValueCard from './FantasyValueCard'
import TrendsCard from './TrendsCard'
import NextGameCard from './NextGameCard'
import GameLogCard from './GameLogCard'
import PastSeasonsCard from './PastSeasonsCard'
import LeagueHistoryCard from './LeagueHistoryCard'
import './profile.css'

/*
 * Player profile on a phone (step 4). Same sections and data as the desktop
 * page, top to bottom: header, Bio (folded), time frame, Fantasy Value,
 * Stats, Trends, next-game projection, game log.
 */

const STAT_COLS: { key: PlayerStatKey; label: string; isPct?: boolean }[] = [
  { key: 'minutes', label: 'MIN' },
  { key: 'fgm', label: 'FGM' },
  { key: 'fga', label: 'FGA' },
  { key: 'fg_percentage', label: 'FG%', isPct: true },
  { key: 'ftm', label: 'FTM' },
  { key: 'fta', label: 'FTA' },
  { key: 'ft_percentage', label: 'FT%', isPct: true },
  { key: 'three_pm', label: '3PM' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'pts', label: 'PTS' },
  { key: 'gp', label: 'GP' },
]

function formatStat(value: number, isPct?: boolean): string {
  if (isPct) return `${(value * 100).toFixed(1)}%`
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

type StatLine = Record<PlayerStatKey, number>

export default function PlayerProfileMobile() {
  const { playerId = '' } = useParams<{ playerId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  const [perGame, setPerGame] = useState<'pg' | 'tot'>('pg')

  const d = usePlayerProfileData(playerId, timePeriod, customRange)

  const handleBack = () => {
    if (from) navigate(from)
    else if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }

  if (!playerId) return <ErrorMessage message="Missing player id" />
  if (d.bioLoading) return <LoadingSpinner />
  if (d.bioError || !d.bio) return <ErrorMessage message={getErrorMessage(d.bioError, 'Failed to load player')} />

  const { bio, fantasyEntry, statsResponse } = d
  const stats = (perGame === 'pg' ? statsResponse?.averages : statsResponse?.totals) as StatLine | undefined
  const hasData = Boolean(statsResponse?.has_data && stats)

  const bioTiles = [
    { k: 'Conference', v: bio.conference },
    { k: 'Division', v: bio.division },
    { k: 'Height', v: bio.height ?? '—' },
    { k: 'Age', v: bio.age ?? '—' },
    { k: 'Nationality', v: bio.nationality ?? '—' },
  ]

  const statColumns: Column<StatLine>[] = STAT_COLS.map((c, i) => ({
    key: c.key,
    header: c.label,
    pinned: i === 0,
    align: 'center',
    cell: (row) => formatStat(row[c.key], c.isPct),
  }))

  return (
    <div className="mr-root mr-pp">
      <button type="button" className="mr-link mr-pp-back" onClick={handleBack}>
        {backLabel(from)}
      </button>

      <Card className="mr-pp-hero" aria-label="Player">
        <div className="mr-pp-photo">
          {bio.photo_url ? (
            <img src={bio.photo_url} alt={bio.display_name} />
          ) : (
            <span aria-hidden="true">🏀</span>
          )}
        </div>
        <div className="mr-pp-who">
          <h1 className="mr-h1 mr-pp-name">
            {bio.display_name}
            {bio.jersey_number ? <span className="mr-pp-num"> #{bio.jersey_number}</span> : null}
          </h1>
          <span className="mr-meta">
            {bio.team} ({bio.team_abbr}) · {bio.position}
          </span>
          {fantasyEntry &&
            (fantasyEntry.status === 'ONTEAM' && fantasyEntry.fantasy_team_name ? (
              <Link to={`/team/${fantasyEntry.team_id}`} className="mr-pp-badge mr-pp-owner">
                Rostered by {fantasyEntry.fantasy_team_name}
              </Link>
            ) : (
              <span className="mr-pp-badge mr-pp-free">{fantasyEntry.status === 'WAIVERS' ? 'Waivers' : 'Free Agent'}</span>
            ))}
        </div>
      </Card>

      <details className="mr-card mr-pp-bio">
        <summary className="mr-h2">Bio</summary>
        <dl className="mr-pp-tiles mr-c3">
          {bioTiles.map((t) => (
            <div key={t.k} className="mr-pp-tile">
              <dt className="mr-pp-tl">{t.k}</dt>
              <dd className="mr-pp-tv mr-pp-sm">{t.v}</dd>
            </div>
          ))}
        </dl>
      </details>

      <TimeFrameChips
        value={timePeriod}
        onChange={setTimePeriod}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
      />

      {(d.allPlayersLoading || fantasyEntry) && (
        <FantasyValueCard
          positions={fantasyEntry?.positions ?? []}
          summary={d.rankSummary}
          categories={d.rankCategories}
          loading={d.allPlayersLoading || d.periodPlayersFetching}
          periodLabel={d.periodLabel}
        />
      )}

      <Card title={`Stats · ${d.periodLabel}`} aria-label="Stats">
        <Segmented
          label="Stats"
          size="sm"
          value={perGame}
          onChange={setPerGame}
          options={[
            { value: 'pg', label: 'Per Game' },
            { value: 'tot', label: 'Totals' },
          ]}
        />
        {timePeriod === 'custom' && customRange && (
          <CoverageNotice
            requestedStart={customRange.start}
            requestedEnd={customRange.end}
            actualStart={statsResponse?.actual_start ?? undefined}
            actualEnd={statsResponse?.actual_end ?? undefined}
          />
        )}
        {d.statsLoading || d.statsFetching ? (
          <div className="mr-pp-loading">
            <LoadingSpinner />
          </div>
        ) : d.statsError ? (
          <ErrorMessage message={getErrorMessage(d.statsError, 'Failed to load player stats')} />
        ) : !hasData || !stats ? (
          <p className="mr-meta mr-pp-empty">No stats available for this time range.</p>
        ) : (
          <DataTable caption={`Stats, ${perGame === 'pg' ? 'per game' : 'totals'}`} columns={statColumns} rows={[stats]} rowKey={() => 'line'} />
        )}
      </Card>

      <LeagueHistoryCard playerId={playerId} />

      <PastSeasonsCard playerId={playerId} />

      <TrendsCard
        playerId={Number(playerId)}
        categories={d.apiCategories}
        reverseCategories={d.allPlayers?.reverse_categories}
        timePeriod={timePeriod}
        customRange={customRange}
      />

      <NextGameCard playerId={playerId} playerName={bio.display_name} />

      {/* the whole season game by game: the longest section, and not tied to the time frame */}
      <GameLogCard playerId={playerId} />
    </div>
  )
}
